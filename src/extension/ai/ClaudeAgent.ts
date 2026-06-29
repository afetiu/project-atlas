/**
 * Thin, purpose-built wrapper over the Claude Agent SDK.
 *
 * Exposes the three jobs Atlas needs — detect, chat, generate — and hides the
 * SDK's streaming/message plumbing behind small typed methods. Each method
 * builds an options object, drives `query()`, and surfaces progress through a
 * callback so the panel can relay it to the webview.
 */

import { resolve, sep } from 'path';

import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import {
  buildDetectionSchema,
  detectedToModel,
  type DetectedArchitecture,
} from '../../shared/ai/detection';
import { buildChatSchema, type ChatResponse, type ChatTurn } from '../../shared/ai/chat';
import type { ModelDelta } from '../../shared/model/diff';
import type { ArchitectureModel } from '../../shared/model/types';
import type { AuthProvider } from './AuthProvider';
import { buildChatSystemPrompt, buildCodegenPrompt, buildDetectionPrompt } from './prompts';

/**
 * The Agent SDK is ESM-only and uses `import.meta.url`, so it cannot be bundled
 * into the CommonJS extension. We load it once, lazily, via dynamic import.
 */
type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk').query;
let queryFnPromise: Promise<QueryFn> | undefined;
function loadQuery(): Promise<QueryFn> {
  if (!queryFnPromise) {
    queryFnPromise = import('@anthropic-ai/claude-agent-sdk').then((mod) => mod.query);
  }
  return queryFnPromise;
}

export type AgentEvent =
  | { kind: 'status'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; detail: string };

export type AgentEventHandler = (event: AgentEvent) => void;

export type AiErrorCode = 'auth' | 'cancelled' | 'failed';

export class AiError extends Error {
  constructor(public readonly code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
  }
}

export interface CodegenResult {
  summary: string;
  sessionId?: string;
  /** Files the agent created or edited, for an optional revert. */
  touchedFiles: string[];
}

export class ClaudeAgent {
  constructor(private readonly auth: AuthProvider) {}

  /** Analyze a repository and return a normalized, laid-out architecture model. */
  async detect(
    cwd: string,
    onEvent: AgentEventHandler,
    abortController: AbortController,
    previous?: ArchitectureModel,
  ): Promise<ArchitectureModel> {
    const options = await this.baseOptions(cwd, abortController, {
      allowedTools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'default',
      outputFormat: { type: 'json_schema', schema: buildDetectionSchema() },
    });

    const query = await loadQuery();
    let structured: unknown;
    for await (const message of query({ prompt: buildDetectionPrompt(), options })) {
      this.relayProgress(message, onEvent);
      if (message.type === 'result') {
        structured = this.requireSuccess(message).structured_output;
      }
    }

    if (!structured) {
      throw new AiError('failed', 'Detection returned no architecture.');
    }
    return detectedToModel(structured as DetectedArchitecture, {
      preservePositionsFrom: previous,
    });
  }

  /** Run one conversational turn, optionally returning a proposed model. */
  async chat(
    cwd: string,
    model: ArchitectureModel,
    history: ChatTurn[],
    message: string,
    onEvent: AgentEventHandler,
    abortController: AbortController,
  ): Promise<ChatResponse> {
    const options = await this.baseOptions(cwd, abortController, {
      allowedTools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'default',
      systemPrompt: buildChatSystemPrompt(model),
      outputFormat: { type: 'json_schema', schema: buildChatSchema() },
    });

    const query = await loadQuery();
    let structured: unknown;
    for await (const event of query({ prompt: composeChatPrompt(history, message), options })) {
      this.relayProgress(event, onEvent);
      if (event.type === 'result') {
        structured = this.requireSuccess(event).structured_output;
      }
    }

    if (!structured || typeof (structured as ChatResponse).reply !== 'string') {
      throw new AiError('failed', 'Claude returned no response.');
    }
    return structured as ChatResponse;
  }

  /** Generate code that realizes an architecture change, streaming progress. */
  async generateCode(
    cwd: string,
    delta: ModelDelta,
    model: ArchitectureModel,
    instruction: string | undefined,
    onEvent: AgentEventHandler,
    abortController: AbortController,
  ): Promise<CodegenResult> {
    // Security posture for code generation:
    //  - shell is disabled entirely (no exfiltration / untrackable effects),
    //  - only read tools are pre-approved,
    //  - Edit/Write go through canUseTool, which confines them to the workspace.
    // This keeps every filesystem effect inside the repo and revertable.
    const options = await this.baseOptions(cwd, abortController, {
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: ['Bash', 'BashOutput', 'KillShell'],
      permissionMode: 'default',
      canUseTool: codegenGuard(cwd),
      systemPrompt: { type: 'preset', preset: 'claude_code' },
    });

    const query = await loadQuery();
    let summary = '';
    let sessionId: string | undefined;
    const touched = new Set<string>();
    for await (const message of query({
      prompt: buildCodegenPrompt(delta, model, instruction),
      options,
    })) {
      this.relayProgress(message, onEvent);
      collectTouchedFiles(message, touched);
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
      }
      if (message.type === 'result') {
        summary = this.requireSuccess(message).result;
      }
    }
    return { summary, sessionId, touchedFiles: [...touched] };
  }

  /** Shared option scaffolding: auth env, executable, model, cancellation. */
  private async baseOptions(
    cwd: string,
    abortController: AbortController,
    extra: Partial<Options>,
  ): Promise<Options> {
    const env = await this.auth.buildEnv();
    const model = this.auth.resolveModel();
    const executable = this.auth.resolveExecutablePath();
    return {
      cwd,
      env,
      abortController,
      // Keep runs reproducible: don't auto-load user/project settings unless a
      // job explicitly opts into the claude_code preset.
      settingSources: [],
      ...(model ? { model } : {}),
      ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      ...extra,
    };
  }

  private relayProgress(message: SDKMessage, onEvent: AgentEventHandler): void {
    if (message.type === 'assistant') {
      if (message.error === 'authentication_failed') {
        throw new AiError('auth', 'Claude authentication failed.');
      }
      for (const block of contentBlocks(message)) {
        if (block.type === 'text' && block.text) {
          onEvent({ kind: 'assistant', text: block.text });
        } else if (block.type === 'tool_use' && block.name) {
          onEvent({ kind: 'tool', name: block.name, detail: describeToolInput(block.input) });
        }
      }
    }
  }

  private requireSuccess(message: Extract<SDKMessage, { type: 'result' }>) {
    if (message.subtype === 'success' && !message.is_error) {
      return message;
    }
    const detail =
      message.subtype === 'success'
        ? `api status ${message.api_error_status ?? 'error'}`
        : message.errors.join('; ');
    if (/authentication|unauthorized|api key|401|403/i.test(detail)) {
      throw new AiError('auth', 'Claude authentication failed.');
    }
    throw new AiError('failed', `Claude run failed: ${detail || message.subtype}`);
  }
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

function contentBlocks(message: Extract<SDKMessage, { type: 'assistant' }>): ContentBlock[] {
  const content = (message.message as { content?: unknown }).content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function isInsideWorkspace(cwd: string, file: unknown): boolean {
  if (typeof file !== 'string' || file.length === 0) {
    return false;
  }
  const root = resolve(cwd);
  const target = resolve(cwd, file);
  return target === root || target.startsWith(root + sep);
}

/**
 * Permission gate for code generation: allow reads, allow writes only inside
 * the workspace, deny everything else (shell, network, out-of-workspace writes).
 */
function codegenGuard(cwd: string): NonNullable<Options['canUseTool']> {
  return async (toolName, input) => {
    if (READ_TOOLS.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    if (WRITE_TOOLS.has(toolName)) {
      const file = (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).notebook_path;
      if (isInsideWorkspace(cwd, file)) {
        return { behavior: 'allow', updatedInput: input };
      }
      return {
        behavior: 'deny',
        message: `Atlas blocked a write outside the workspace: ${String(file)}`,
      };
    }
    return { behavior: 'deny', message: `Atlas blocked tool "${toolName}" during code generation.` };
  };
}

function collectTouchedFiles(message: SDKMessage, touched: Set<string>): void {
  if (message.type !== 'assistant') {
    return;
  }
  for (const block of contentBlocks(message)) {
    if (block.type === 'tool_use' && (block.name === 'Write' || block.name === 'Edit')) {
      const file = (block.input as Record<string, unknown> | undefined)?.file_path;
      if (typeof file === 'string') {
        touched.add(file);
      }
    }
  }
}

function describeToolInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const path = record.file_path ?? record.path ?? record.command;
    if (typeof path === 'string') {
      return path;
    }
  }
  return '';
}

function composeChatPrompt(history: ChatTurn[], message: string): string {
  const transcript = history
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');
  return transcript ? `${transcript}\nUser: ${message}` : message;
}
