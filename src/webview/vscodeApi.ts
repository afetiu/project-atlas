/**
 * Typed access to the host bridge — VS Code's webview API, or a same-origin
 * WebSocket when this bundle is running standalone (`atlas-studio`, no VS
 * Code in the loop). Both transports speak the exact same message protocol,
 * so every other webview module is host-agnostic; this is the only file that
 * knows which world it's in.
 *
 * `acquireVsCodeApi` may only be called once per webview load, so the chosen
 * transport is resolved once and cached at module scope.
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

interface HostTransport {
  post(message: WebviewToHostMessage): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
  subscribe(handler: (message: HostToWebviewMessage) => void): () => void;
}

/** The original VS Code bridge — behavior unchanged from before the standalone split. */
function createVsCodeTransport(): HostTransport {
  const api = acquireVsCodeApi();
  return {
    post: (message) => api.postMessage(message),
    getState: <T>() => api.getState<T>(),
    setState: (state) => api.setState(state),
    subscribe(handler) {
      const listener = (event: MessageEvent<HostToWebviewMessage>) => handler(event.data);
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}

const VIEW_STATE_KEY = 'atlas:viewState';

/**
 * Standalone transport: the same message protocol over a same-origin
 * WebSocket to the atlas-studio server. `post` queues messages sent before
 * the socket is open (the webview posts `webview:ready` immediately on
 * mount), and a dropped connection (server restart, laptop sleep) reconnects
 * automatically instead of leaving the tab permanently dark.
 */
function createWebSocketTransport(): HostTransport {
  const listeners = new Set<(message: HostToWebviewMessage) => void>();
  const queue: WebviewToHostMessage[] = [];
  let socket: WebSocket | undefined;

  const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

  function connect(): void {
    const ws = new WebSocket(wsUrl);
    socket = ws;
    ws.addEventListener('open', () => {
      for (const message of queue.splice(0)) {
        ws.send(JSON.stringify(message));
      }
    });
    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as HostToWebviewMessage;
        for (const listener of listeners) {
          listener(message);
        }
      } catch {
        // malformed frame — drop it rather than crash the tab
      }
    });
    ws.addEventListener('close', () => {
      socket = undefined;
      setTimeout(connect, 1500);
    });
  }
  connect();

  return {
    post(message) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      } else {
        queue.push(message);
      }
    },
    getState<T>() {
      const raw = sessionStorage.getItem(VIEW_STATE_KEY);
      return raw ? (JSON.parse(raw) as T) : undefined;
    },
    setState(state) {
      sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state));
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };
}

const transport: HostTransport =
  typeof acquireVsCodeApi === 'function' ? createVsCodeTransport() : createWebSocketTransport();

export function postToHost(message: WebviewToHostMessage): void {
  transport.post(message);
}

/** Persisted view state (collapsed panels, filters) that survives a reload. */
export function getViewState<T>(): T | undefined {
  return transport.getState<T>();
}

export function setViewState<T>(state: T): void {
  transport.setState(state);
}

/** Subscribe to messages from the host. Returns an unsubscribe fn. */
export function onHostMessage(handler: (message: HostToWebviewMessage) => void): () => void {
  return transport.subscribe(handler);
}
