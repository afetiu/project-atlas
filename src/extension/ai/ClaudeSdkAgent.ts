/**
 * Thin, purpose-built wrapper over the Claude Agent SDK.
 *
 * Exposes the three jobs Atlas needs — detect, chat, generate — and hides the
 * SDK's streaming/message plumbing behind small typed methods. Each method
 * builds an options object, drives `query()`, and surfaces progress through a
 * callback so the panel can relay it to the webview.
 */

import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import {
  buildDetectionSchema,
  detectedToModel,
  type DetectedArchitecture,
} from '../../shared/ai/detection';
import { parseChatReply, type ChatResponse, type ChatTurn } from '../../shared/ai/chat';
import type { ModelDelta } from '../../shared/model/diff';
import type { ArchitectureModel } from '../../shared/model/types';
import { resolveWithinRoot } from '../workspace/paths';
import {
  AiError,
  type AgentEventHandler,
  type ArchitectureAgent,
  type CodegenResult,
} from './agent';
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
    // Don't memoize a rejected import: a transient/first-run failure would
    // otherwise wedge every later AI action until the extension host restarts.
    queryFnPromise.catch(() => {
      queryFnPromise = undefined;
    });
  }
  return queryFnPromise;
}

// Watchdog ceilings so a wedged SDK subprocess can't pin the UI "busy" forever:
// the timer aborts the run, which surfaces as a clean cancellation.
const DETECT_TIMEOUT_MS = 5 * 60_000;
const CHAT_TIMEOUT_MS = 5 * 60_000;
const CODEGEN_TIMEOUT_MS = 15 * 60_000;

/** Abort `controller` after `ms`; returns a disposer to cancel the watchdog. */
function startWatchdog(controller: AbortController, ms: number): () => void {
  const timer = setTimeout(() => controller.abort(), ms);
  return () => clearTimeout(timer);
}

export class ClaudeSdkAgent implements ArchitectureAgent {
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
    const stopWatchdog = startWatchdog(abortController, DETECT_TIMEOUT_MS);
    let structured: unknown;
    try {
      for await (const message of query({ prompt: buildDetectionPrompt(), options })) {
        this.relayProgress(message, onEvent);
        if (message.type === 'result') {
          structured = this.requireSuccess(message).structured_output;
        }
      }
    } catch (error) {
      throw this.normalizeError(error, abortController);
    } finally {
      stopWatchdog();
    }
    this.throwIfAborted(abortController);

    if (!structured) {
      throw new AiError('failed', 'Detection returned no architecture.');
    }
    const model = detectedToModel(structured as DetectedArchitecture, {
      preservePositionsFrom: previous,
    });
    if (model.nodes.length === 0) {
      // A zero-node result would silently overwrite a good architecture with an
      // empty one — treat it as a failure the caller can recover from.
      throw new AiError('failed', 'Detection found no components in this repository.');
    }
    return model;
  }

  /** Run one conversational turn, optionally returning a proposed model. */
  async chat(
    cwd: string,
    model: ArchitectureModel,
    history: ChatTurn[],
    message: string,
    onToken: (text: string) => void,
    abortController: AbortController,
  ): Promise<ChatResponse> {
    // Stream the prose reply token-by-token; a trailing fenced block (parsed
    // afterwards) carries any proposal, so we don't need structured output.
    const options = await this.baseOptions(cwd, abortController, {
      allowedTools: ['Read', 'Glob', 'Grep'],
      permissionMode: 'default',
      systemPrompt: buildChatSystemPrompt(model),
      includePartialMessages: true,
    });

    const query = await loadQuery();
    const stopWatchdog = startWatchdog(abortController, CHAT_TIMEOUT_MS);
    let full = '';
    let sawResult = false;
    try {
      for await (const event of query({ prompt: composeChatPrompt(history, message), options })) {
        if (event.type === 'stream_event') {
          const delta = textDelta(event);
          if (delta) {
            full += delta;
            onToken(delta);
          }
        } else if (event.type === 'assistant' && event.error) {
          throw classifyAssistantError(event.error);
        } else if (event.type === 'result') {
          this.requireSuccess(event);
          sawResult = true;
        }
      }
    } catch (error) {
      throw this.normalizeError(error, abortController);
    } finally {
      stopWatchdog();
    }
    // A run that streamed text but never produced a successful result (aborted
    // or truncated) must not be presented as a finished answer.
    this.throwIfAborted(abortController);
    if (!sawResult) {
      throw new AiError('failed', 'Claude did not finish the response.');
    }
    return parseChatReply(full);
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
    const stopWatchdog = startWatchdog(abortController, CODEGEN_TIMEOUT_MS);
    let summary = '';
    let sessionId: string | undefined;
    const touched = new Set<string>();
    try {
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
    } catch (error) {
      throw this.normalizeError(error, abortController);
    } finally {
      stopWatchdog();
    }
    this.throwIfAborted(abortController);
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
      if (message.error) {
        throw classifyAssistantError(message.error);
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
    // Branch on is_error independently of subtype: a 'success' subtype can still
    // carry is_error with an api_error_status, and the error subtypes carry an
    // `errors` array. They are disjoint shapes, so read each from its own branch.
    if (message.subtype === 'success') {
      if (!message.is_error) {
        return message;
      }
      const status = message.api_error_status ?? null;
      if (status === 401 || status === 403) {
        throw new AiError('auth', 'Claude authentication failed.');
      }
      throw new AiError('failed', `Claude run failed (API status ${status ?? 'error'}).`);
    }
    const detail = message.errors.join('; ');
    if (/authentication|unauthorized|api key|401|403/i.test(detail)) {
      throw new AiError('auth', 'Claude authentication failed.');
    }
    throw new AiError('failed', `Claude run failed: ${detail || message.subtype}`);
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
    return new AiError('failed', `Claude run failed: ${message}`);
  }

  /** Convert a post-loop aborted signal into an explicit cancellation. */
  private throwIfAborted(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new AiError('cancelled', 'Cancelled.');
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /\babort(ed)?\b/i.test(error.message))
  );
}

/** Map an assistant-level SDK error enum value to a classified AiError. */
function classifyAssistantError(error: string): AiError {
  switch (error) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'billing_error':
      return new AiError('auth', `Claude authentication/billing error: ${error.replace(/_/g, ' ')}.`);
    case 'rate_limit':
    case 'overloaded':
    case 'server_error':
      return new AiError('failed', `Claude is temporarily unavailable (${error.replace(/_/g, ' ')}). Try again shortly.`);
    case 'model_not_found':
    case 'invalid_request':
      return new AiError('failed', `Claude rejected the request (${error.replace(/_/g, ' ')}). Check the Atlas model setting.`);
    default:
      return new AiError('failed', `Claude error: ${error.replace(/_/g, ' ')}.`);
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
  // Symlink-aware: a write through a pre-existing in-repo symlink that points
  // outside the workspace must be refused even though it looks "inside" lexically.
  return resolveWithinRoot(cwd, file) !== null;
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

/** Pull a text delta out of a streaming partial-assistant event, if present. */
function textDelta(event: Extract<SDKMessage, { type: 'stream_event' }>): string | undefined {
  const raw = event.event as { type?: string; delta?: { type?: string; text?: string } };
  if (raw.type === 'content_block_delta' && raw.delta?.type === 'text_delta') {
    return raw.delta.text;
  }
  return undefined;
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
