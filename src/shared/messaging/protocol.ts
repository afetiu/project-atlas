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

import type { ArchitectureModel } from '../model/types';
import type { ValidationIssue } from '../serialization/validation';

/* ------------------------------------------------------------------ */
/* Extension host → webview                                            */
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

export type HostToWebviewMessage = ModelLoadedMessage | ModelErrorMessage;

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

export type WebviewToHostMessage = WebviewReadyMessage | ModelChangedMessage;
