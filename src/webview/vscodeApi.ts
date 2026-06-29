/**
 * Typed access to the VS Code webview API.
 *
 * `acquireVsCodeApi` may only be called once per webview load, so the handle is
 * cached at module scope. All host communication funnels through this thin,
 * strongly-typed wrapper rather than touching the global directly.
 */

import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../shared/messaging/protocol';

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function postToHost(message: WebviewToHostMessage): void {
  api.postMessage(message);
}

/** Persisted view state (collapsed panels, filters) that survives a reload. */
export function getViewState<T>(): T | undefined {
  return api.getState<T>();
}

export function setViewState<T>(state: T): void {
  api.setState<T>(state);
}

/** Subscribe to messages from the extension host. Returns an unsubscribe fn. */
export function onHostMessage(handler: (message: HostToWebviewMessage) => void): () => void {
  const listener = (event: MessageEvent<HostToWebviewMessage>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
