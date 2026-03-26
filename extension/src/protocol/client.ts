import WebSocket from 'ws';
import type { Disposable } from 'vscode';
import type { JsonRpcResponse, JsonRpcNotification, DaemonStatus } from './types.js';
import { readAuthToken, getWebSocketPort } from './auth.js';

const REQUEST_TIMEOUT_MS = 30_000;
const LONG_REQUEST_TIMEOUT_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

const LONG_METHODS = new Set(['reindex', 'titles.generate']);

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type NotificationHandler = (method: string, params: Record<string, unknown> | undefined) => void;
type ConnectionHandler = (connected: boolean) => void;

export class TessynClient implements Disposable {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers: NotificationHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Connect to the Tessyn daemon WebSocket server.
   * Reads the auth token from disk and connects to localhost.
   */
  async connect(): Promise<void> {
    if (this.disposed) return;

    const token = readAuthToken();
    if (!token) {
      throw new Error('Auth token not found — is the Tessyn daemon running?');
    }

    const port = getWebSocketPort();
    const url = `ws://127.0.0.1:${port}?token=${token}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 10_000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.setConnected(true);
        this.startHeartbeat();
        resolve();
      });

      ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        this.handleDisconnect();
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        if (!this._connected) {
          reject(err);
        }
        // If already connected, the close event will handle cleanup
      });
    });
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to daemon');
    }

    const id = this.nextId++;
    const timeoutMs = LONG_METHODS.has(method) ? LONG_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      const request = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      });

      this.ws!.send(request);
    });
  }

  /**
   * Subscribe to daemon event topics.
   */
  async subscribe(topics: string[]): Promise<void> {
    await this.call('subscribe', { topics });
  }

  /**
   * Register a handler for push notifications from the daemon.
   */
  onNotification(handler: NotificationHandler): Disposable {
    this.notificationHandlers.push(handler);
    return {
      dispose: () => {
        const idx = this.notificationHandlers.indexOf(handler);
        if (idx >= 0) this.notificationHandlers.splice(idx, 1);
      },
    };
  }

  /**
   * Register a handler for connection state changes.
   */
  onConnectionChange(handler: ConnectionHandler): Disposable {
    this.connectionHandlers.push(handler);
    return {
      dispose: () => {
        const idx = this.connectionHandlers.indexOf(handler);
        if (idx >= 0) this.connectionHandlers.splice(idx, 1);
      },
    };
  }

  /**
   * Disconnect from the daemon.
   */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.rejectAllPending('Disconnected');
    this.setConnected(false);
  }

  /**
   * Dispose the client. Prevents reconnection.
   */
  dispose(): void {
    this.disposed = true;
    this.disconnect();
    this.notificationHandlers = [];
    this.connectionHandlers = [];
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    // Response to a pending request
    if ('id' in msg && msg['id'] !== null) {
      const response = msg as unknown as JsonRpcResponse;
      const pending = this.pending.get(response.id as number);
      if (pending) {
        this.pending.delete(response.id as number);
        clearTimeout(pending.timer);
        if (response.error) {
          pending.reject(new Error(`${response.error.message} (code: ${response.error.code})`));
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Notification (no id)
    if ('method' in msg) {
      const notification = msg as unknown as JsonRpcNotification;
      for (const handler of this.notificationHandlers) {
        try {
          handler(notification.method, notification.params);
        } catch {
          // Don't let one handler's error break others
        }
      }
    }
  }

  private handleDisconnect(): void {
    this.ws = null;
    this.stopHeartbeat();
    this.rejectAllPending('Connection lost');
    this.setConnected(false);
  }

  private setConnected(connected: boolean): void {
    if (this._connected === connected) return;
    this._connected = connected;
    for (const handler of this.connectionHandlers) {
      try {
        handler(connected);
      } catch {
        // Ignore handler errors
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        await Promise.race([
          this.call<DaemonStatus>('status'),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Heartbeat timeout')), HEARTBEAT_TIMEOUT_MS)
          ),
        ]);
      } catch {
        // Heartbeat failed — force disconnect to trigger reconnect
        this.ws?.close();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
