/**
 * Typed postMessage bridge between webview and extension host.
 * The webview calls these functions; the extension host listens via onDidReceiveMessage.
 */

// Acquire the VS Code API (injected by the webview host)
// This can only be called once per webview lifecycle.
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// === Outgoing messages (webview → extension host) ===

let nextRequestId = 1;
const pendingRequests = new Map<string, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();

/**
 * Signal that the webview is ready to receive state.
 */
export function signalReady(): void {
  vscode.postMessage({ type: 'ready' });
}

/**
 * Call a daemon RPC method via the extension host.
 */
export async function rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
  const requestId = String(nextRequestId++);
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: resolve as (result: unknown) => void,
      reject,
    });
    vscode.postMessage({
      type: 'rpc',
      requestId,
      params: { method, params },
    });
  });
}

// === Incoming messages (extension host → webview) ===

type MessageHandler = (msg: ExtensionMessage) => void;
const messageHandlers: MessageHandler[] = [];

export interface ExtensionMessage {
  type: string;
  [key: string]: unknown;
}

export function onMessage(handler: MessageHandler): () => void {
  messageHandlers.push(handler);
  return () => {
    const idx = messageHandlers.indexOf(handler);
    if (idx >= 0) messageHandlers.splice(idx, 1);
  };
}

// Listen for messages from extension host
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as ExtensionMessage;
  if (!msg || typeof msg.type !== 'string') return;

  // Handle RPC responses
  if (msg.type === 'rpc.result' || msg.type === 'rpc.error') {
    const requestId = msg['requestId'] as string;
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pendingRequests.delete(requestId);
      if (msg.type === 'rpc.error') {
        pending.reject(new Error(msg['error'] as string));
      } else {
        pending.resolve(msg['result']);
      }
    }
    return;
  }

  // Dispatch to handlers
  for (const handler of messageHandlers) {
    try {
      handler(msg);
    } catch {
      // Don't let one handler break others
    }
  }
});

// === State persistence ===

export function saveState(state: unknown): void {
  vscode.setState(state);
}

export function loadState<T>(): T | undefined {
  return vscode.getState() as T | undefined;
}
