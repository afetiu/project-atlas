/**
 * The message protocol exchanged between the extension host and the webview.
 *
 * Messages are strongly typed and discriminated by `type`. Keeping the contract
 * in `shared/` means both ends compile against the exact same definitions, so a
 * change to a payload shape surfaces as a type error on both sides.
 *
 * Direction is encoded in the type name:
 *   - `HostToWebview*` flows extension → webview.
 *   - `WebviewToHost*` flows webview → extension.
 */

import type { ChatTurn } from '../ai/chat';
import type { DocMeta } from '../docs/catalog';
import type { ArchitectureModel } from '../model/types';
import type { ValidationIssue } from '../serialization/validation';

/** The AI job currently running, used for progress attribution. */
export type AiJob = 'detect' | 'chat' | 'codegen';

/** A change the AI proposes, ready for the user to review and apply. */
export interface ChangeProposal {
  summary: string;
  /** The complete desired architecture if this proposal is applied. */
  model: ArchitectureModel;
}

/* ------------------------------------------------------------------ */
/* Extension host → webview                                           */
/* ------------------------------------------------------------------ */

/** Push the authoritative model into the webview (initial load or reload). */
export interface ModelLoadedMessage {
  type: 'model:loaded';
  model: ArchitectureModel;
}

/** Report a parse/validation problem so the webview can surface it. */
export interface ModelErrorMessage {
  type: 'model:error';
  message: string;
  issues?: ValidationIssue[];
}

/** AI busy/idle state, so the UI can show spinners and disable actions. */
export interface AiStatusMessage {
  type: 'ai:status';
  busy: boolean;
  job?: AiJob;
  label?: string;
}

/** A streamed progress line from a running AI job. */
export interface AiProgressMessage {
  type: 'ai:progress';
  job: AiJob;
  line: string;
}

/** An AI job failed (or needs auth). */
export interface AiErrorMessage {
  type: 'ai:error';
  code: 'auth' | 'cancelled' | 'failed';
  message: string;
}

/** A streamed token of the assistant's in-progress reply. */
export interface ChatTokenMessage {
  type: 'chat:token';
  text: string;
}

/** A completed chat turn, optionally carrying a proposal to apply. */
export interface ChatReplyMessage {
  type: 'chat:reply';
  reply: string;
  proposal?: ChangeProposal;
}

/** How the current model differs from the code-synced baseline. */
export interface SyncStatusMessage {
  type: 'sync:status';
  pendingSummary: string[];
}

/** Components whose code has changed since the last detection (drift). */
export interface DriftStatusMessage {
  type: 'drift:status';
  driftedNodeIds: string[];
}

/** Raw contents of atlas.rules.yaml, compiled into custom rules in the webview. */
export interface RulesConfigMessage {
  type: 'rules:config';
  text: string;
}

/** A single post-codegen verification check. */
export interface VerificationCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

/** Whether the generated code is verified to realize the architecture change. */
export interface VerificationReport {
  ok: boolean;
  checks: VerificationCheck[];
}

/** Code generation finished; carries the resulting git diff and verification. */
export interface ApplyDoneMessage {
  type: 'apply:done';
  summary: string;
  diff: string;
  /** Whether there are generated files that can be reverted. */
  revertable: boolean;
  /** Result of verifying the generated code against the model. */
  verification: VerificationReport;
}

/** The most recent code generation was reverted (files restored). */
export interface ApplyRevertedMessage {
  type: 'apply:reverted';
  ok: boolean;
}

/** Live tools a bound component's MCP server exposes (or an error). */
export interface McpToolsMessage {
  type: 'mcp:tools';
  nodeId: string;
  server: string;
  tools?: Array<{ name: string; description?: string }>;
  error?: string;
}

/** Result of invoking a tool on a bound component's MCP server. */
export interface McpToolResultMessage {
  type: 'mcp:toolResult';
  nodeId: string;
  tool: string;
  ok: boolean;
  text: string;
}

/** The workspace's Markdown documentation catalog. */
export interface DocsListMessage {
  type: 'docs:list';
  docs: DocMeta[];
}

/** Full text of one document, for the reader. */
export interface DocsContentMessage {
  type: 'docs:content';
  path: string;
  text?: string;
  error?: string;
}

/** Commit history of atlas.yaml, for the time-lapse scrubber (newest first). */
export interface HistoryEntriesMessage {
  type: 'history:entries';
  entries: Array<{ sha: string; date: string; summary: string }>;
}

export type HostToWebviewMessage =
  | ModelLoadedMessage
  | ModelErrorMessage
  | AiStatusMessage
  | AiProgressMessage
  | AiErrorMessage
  | ChatTokenMessage
  | ChatReplyMessage
  | SyncStatusMessage
  | DriftStatusMessage
  | RulesConfigMessage
  | ApplyDoneMessage
  | ApplyRevertedMessage
  | McpToolsMessage
  | McpToolResultMessage
  | DocsListMessage
  | DocsContentMessage
  | HistoryEntriesMessage;

/* ------------------------------------------------------------------ */
/* Webview → extension host                                           */
/* ------------------------------------------------------------------ */

/** The webview has mounted and is ready to receive the model. */
export interface WebviewReadyMessage {
  type: 'webview:ready';
}

/** The user edited the graph; persist this model to `atlas.yaml`. */
export interface ModelChangedMessage {
  type: 'model:changed';
  model: ArchitectureModel;
}

/** Run AI repository detection and replace the model with the result. */
export interface DetectRequestMessage {
  type: 'ai:detect';
}

/** Derive the map statically from the code's import graph (no AI), preserving intent. */
export interface MapFromCodeMessage {
  type: 'code:map';
}

/** Send a chat turn to the AI. */
export interface ChatSendMessage {
  type: 'chat:send';
  message: string;
  history: ChatTurn[];
}

/**
 * Apply a target architecture: persist it, then generate the code changes that
 * realize the difference from the current code-synced baseline.
 */
export interface ApplyRequestMessage {
  type: 'apply:request';
  model: ArchitectureModel;
  instruction?: string;
}

/** Revert the files produced by the most recent code generation. */
export interface ApplyRevertMessage {
  type: 'apply:revert';
}

/** Cancel the in-flight AI job. */
export interface AiCancelMessage {
  type: 'ai:cancel';
}

/** Ask the host to prompt for and store an Anthropic API key. */
export interface ConfigureAuthMessage {
  type: 'auth:configure';
}

/** Open (or reveal) the workspace file/directory a component maps to. */
export interface OpenFileMessage {
  type: 'open:file';
  path: string;
}

/** List the tools a bound component's MCP server exposes. */
export interface McpListToolsMessage {
  type: 'mcp:listTools';
  nodeId: string;
  server: string;
}

/** Invoke a tool on a bound component's MCP server. */
export interface McpCallToolMessage {
  type: 'mcp:callTool';
  nodeId: string;
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}

/** Scan the workspace for Markdown documentation. */
export interface DocsScanMessage {
  type: 'docs:scan';
}

/** Read one document's full text. */
export interface DocsReadMessage {
  type: 'docs:read';
  path: string;
}

/** List atlas.yaml's commit history for time-lapse. */
export interface HistoryListMessage {
  type: 'history:list';
}

/** Load the map as it was at a commit (view-only snapshot). */
export interface HistoryLoadMessage {
  type: 'history:load';
  sha: string;
}

/** Leave time-lapse: reload the current map from disk. */
export interface HistoryExitMessage {
  type: 'history:exit';
}

export type WebviewToHostMessage =
  | WebviewReadyMessage
  | ModelChangedMessage
  | DetectRequestMessage
  | MapFromCodeMessage
  | ChatSendMessage
  | ApplyRequestMessage
  | ApplyRevertMessage
  | AiCancelMessage
  | ConfigureAuthMessage
  | OpenFileMessage
  | McpListToolsMessage
  | McpCallToolMessage
  | DocsScanMessage
  | DocsReadMessage
  | HistoryListMessage
  | HistoryLoadMessage
  | HistoryExitMessage;
