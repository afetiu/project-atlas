/**
 * The built-in agent loop: Atlas's own detect/chat/generate engine, usable with
 * any LlmClient provider and no external CLI.
 *
 * Mirrors ClaudeSdkAgent's semantics — same jobs, same events, same errors,
 * same watchdog ceilings — but the loop and every tool execution live in the
 * extension host, so workspace confinement is enforced here rather than
 * delegated to a subprocess.
 */

import {
  buildDetectionSchema,
  detectedToModel,
  type DetectedArchitecture,
} from '../../../shared/ai/detection';
import { parseChatReply, type ChatResponse, type ChatTurn } from '../../../shared/ai/chat';
import type { ModelDelta } from '../../../shared/model/diff';
import type { ArchitectureModel } from '../../../shared/model/types';
import {
  AiError,
  type AgentEventHandler,
  type ArchitectureAgent,
  type CodegenResult,
} from '../agent';
import { buildChatSystemPrompt, buildCodegenPrompt, buildDetectionPrompt } from '../prompts';
import { codegenTools, readOnlyTools } from '../tools/hostTools';
import type { HostTool } from '../tools/types';
import type { LlmClient, LlmMessage, LlmTurnResult } from './types';

export interface LoopTimeouts {
  detectMs: number;
  chatMs: number;
  codegenMs: number;
}

const DEFAULT_TIMEOUTS: LoopTimeouts = {
  detectMs: 5 * 60_000,
  chatMs: 5 * 60_000,
  codegenMs: 15 * 60_000,
};

/** Hard ceiling on model turns per job, so a looping model can't run forever. */
const MAX_ROUNDS = 50;

const CODEGEN_SYSTEM_PROMPT = [
  'You are the code-generation engine inside Atlas, a visual architecture workspace.',
  'You make precise, minimal changes to the repository using the provided tools.',
  'Read before you write: inspect the existing code with Read/Glob/Grep, follow',
  'the conventions you find, and use Edit for surgical changes to existing files.',
  'You have no shell. All file paths are workspace-relative.',
].join('\n');

export class BuiltinLoopAgent implements ArchitectureAgent {
  constructor(
    private readonly client: LlmClient,
    private readonly timeouts: LoopTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  async detect(
    cwd: string,
    onEvent: AgentEventHandler,
    abortController: AbortController,
    previous?: ArchitectureModel,
  ): Promise<ArchitectureModel> {
    const finalText = await this.runLoop({
      messages: [{ type: 'user', text: buildDetectionPrompt() }],
      tools: readOnlyTools(cwd),
      jsonSchema: buildDetectionSchema(),
      timeoutMs: this.timeouts.detectMs,
      abortController,
      onEvent,
    });

    const detected = parseJsonPayload(finalText);
    if (!detected) {
      throw new AiError('failed', 'Detection returned no architecture.');
    }
    const model = detectedToModel(detected as DetectedArchitecture, {
      preservePositionsFrom: previous,
    });
    if (model.nodes.length === 0) {
      // A zero-node result would silently overwrite a good architecture with an
      // empty one — treat it as a failure the caller can recover from.
      throw new AiError('failed', 'Detection found no components in this repository.');
    }
    return model;
  }

  async chat(
    cwd: string,
    model: ArchitectureModel,
    history: ChatTurn[],
    message: string,
    onToken: (text: string) => void,
    abortController: AbortController,
  ): Promise<ChatResponse> {
    const messages: LlmMessage[] = history.map((turn) =>
      turn.role === 'user'
        ? { type: 'user', text: turn.content }
        : { type: 'assistant', text: turn.content, toolCalls: [] },
    );
    messages.push({ type: 'user', text: message });

    const finalText = await this.runLoop({
      system: buildChatSystemPrompt(model),
      messages,
      tools: readOnlyTools(cwd),
      timeoutMs: this.timeouts.chatMs,
      abortController,
      onDelta: onToken,
    });
    return parseChatReply(finalText);
  }

  async generateCode(
    cwd: string,
    delta: ModelDelta,
    model: ArchitectureModel,
    instruction: string | undefined,
    onEvent: AgentEventHandler,
    abortController: AbortController,
  ): Promise<CodegenResult> {
    const touched = new Set<string>();
    const summary = await this.runLoop({
      system: CODEGEN_SYSTEM_PROMPT,
      messages: [{ type: 'user', text: buildCodegenPrompt(delta, model, instruction) }],
      tools: codegenTools(cwd, touched),
      timeoutMs: this.timeouts.codegenMs,
      abortController,
      onEvent,
    });
    return { summary, touchedFiles: [...touched] };
  }

  /**
   * Drive turn → tool execution → turn until the model stops calling tools.
   * Returns the final assistant text.
   */
  private async runLoop(options: {
    system?: string;
    messages: LlmMessage[];
    tools: HostTool[];
    jsonSchema?: Record<string, unknown>;
    timeoutMs: number;
    abortController: AbortController;
    onEvent?: AgentEventHandler;
    onDelta?: (text: string) => void;
  }): Promise<string> {
    const { abortController } = options;
    const watchdog = setTimeout(() => abortController.abort(), options.timeoutMs);
    const toolsByName = new Map(options.tools.map((tool) => [tool.definition.name, tool]));
    const definitions = options.tools.map((tool) => tool.definition);
    const messages = [...options.messages];

    try {
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        this.throwIfAborted(abortController);

        let result: LlmTurnResult;
        try {
          result = await this.client.turn(
            {
              system: options.system,
              messages,
              tools: definitions,
              jsonSchema: options.jsonSchema,
              stream: options.onDelta !== undefined,
            },
            options.onDelta ?? (() => undefined),
            abortController.signal,
          );
        } catch (error) {
          throw this.normalizeError(error, abortController);
        }
        this.throwIfAborted(abortController);

        if (result.text && options.onEvent) {
          options.onEvent({ kind: 'assistant', text: result.text });
        }

        if (result.toolCalls.length === 0) {
          if (result.stopReason === 'length') {
            throw new AiError(
              'failed',
              `${this.client.providerLabel} stopped early: the response hit its length limit.`,
            );
          }
          return result.text;
        }

        messages.push({ type: 'assistant', text: result.text, toolCalls: result.toolCalls });
        for (const call of result.toolCalls) {
          this.throwIfAborted(abortController);
          const tool = toolsByName.get(call.name);
          if (options.onEvent) {
            options.onEvent({ kind: 'tool', name: call.name, detail: describeToolInput(call.arguments) });
          }
          const outcome = tool
            ? await tool.execute(call.arguments)
            : { output: `Unknown tool "${call.name}". Available: ${[...toolsByName.keys()].join(', ')}.`, isError: true };
          messages.push({
            type: 'tool_result',
            toolCallId: call.id,
            toolName: call.name,
            output: outcome.output,
            isError: outcome.isError,
          });
        }
      }
      throw new AiError(
        'failed',
        `${this.client.providerLabel} run exceeded ${MAX_ROUNDS} tool rounds without finishing.`,
      );
    } finally {
      clearTimeout(watchdog);
    }
  }

  private throwIfAborted(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new AiError('cancelled', 'Cancelled.');
    }
  }

  /** Map an aborted/abort-like error to a clean cancellation; pass AiError through. */
  private normalizeError(error: unknown, controller: AbortController): Error {
    if (error instanceof AiError) {
      return error;
    }
    if (controller.signal.aborted || isAbortError(error)) {
      return new AiError('cancelled', 'Cancelled.');
    }
    const message = error instanceof Error ? error.message : String(error);
    return new AiError('failed', `${this.client.providerLabel} run failed: ${message}`);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /\babort(ed)?\b/i.test(error.message))
  );
}

function describeToolInput(input: Record<string, unknown>): string {
  const value = input.file_path ?? input.pattern ?? input.path;
  return typeof value === 'string' ? value : '';
}

/**
 * Parse the model's final JSON payload, tolerating a fenced code block —
 * providers without native structured output can only be prompted to emit one.
 */
function parseJsonPayload(text: string): unknown | undefined {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced) {
    candidates.unshift(fenced[1].trim());
  }
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}
