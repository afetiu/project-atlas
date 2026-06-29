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

export type HostToWebviewMessage =
  | ModelLoadedMessage
  | ModelErrorMessage
  | AiStatusMessage
  | AiProgressMessage
  | AiErrorMessage
  | ChatTokenMessage
  | ChatReplyMessage
  | SyncStatusMessage
  | ApplyDoneMessage;

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

export type WebviewToHostMessage =
  | WebviewReadyMessage
  | ModelChangedMessage
  | DetectRequestMessage
  | ChatSendMessage
  | ApplyRequestMessage
  | ApplyRevertMessage
  | AiCancelMessage
  | ConfigureAuthMessage
  | OpenFileMessage;
