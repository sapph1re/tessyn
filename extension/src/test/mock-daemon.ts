import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';
import type { JsonRpcNotification } from '../protocol/types.js';

type RpcHandler = (params: Record<string, unknown> | undefined) => unknown;

/**
 * Lightweight mock WebSocket server for testing.
 * Used for fault injection tests — real daemon tests use a spawned Tessyn daemon.
 */
export class MockDaemon {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private rpcHandlers = new Map<string, RpcHandler>();
  private _authToken: string;
  private _rejectNextAuth = false;

  constructor() {
    this._authToken = crypto.randomBytes(16).toString('hex');
  }

  get authToken(): string {
    return this._authToken;
  }

  async start(port: number = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port, host: '127.0.0.1' });

      this.wss.on('listening', () => {
        const addr = this.wss!.address();
        const actualPort = typeof addr === 'object' ? addr.port : port;
        resolve(actualPort);
      });

      this.wss.on('error', reject);

      this.wss.on('connection', (ws, req) => {
        // Validate auth token
        const url = new URL(req.url || '', `http://127.0.0.1`);
        const token = url.searchParams.get('token');

        if (this._rejectNextAuth || token !== this._authToken) {
          this._rejectNextAuth = false;
          ws.close(4001, 'Invalid token');
          return;
        }

        this.clients.add(ws);

        ws.on('message', (data) => {
          this.handleMessage(ws, data.toString());
        });

        ws.on('close', () => {
          this.clients.delete(ws);
        });

        // Send initial status notification
        const statusNotification = JSON.stringify({
          jsonrpc: '2.0',
          method: 'index.state_changed',
          params: { state: 'caught_up', sessionsIndexed: 5, sessionsTotal: 5 },
        });
        ws.send(statusNotification);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.wss.close(() => {
        this.wss = null;
        resolve();
      });
    });
  }

  /**
   * Register a handler for an RPC method.
   */
  onRpc(method: string, handler: RpcHandler): void {
    this.rpcHandlers.set(method, handler);
  }

  /**
   * Push an event notification to all connected clients.
   */
  pushEvent(notification: JsonRpcNotification): void {
    const msg = JSON.stringify(notification);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  /**
   * Disconnect all clients (simulates daemon crash).
   */
  disconnectAll(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
  }

  /**
   * Reject the next authentication attempt.
   */
  rejectNextAuth(): void {
    this._rejectNextAuth = true;
  }

  /**
   * Rotate the auth token (simulates daemon restart).
   */
  rotateToken(): string {
    this._authToken = crypto.randomBytes(16).toString('hex');
    return this._authToken;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }));
      return;
    }

    const id = msg['id'];
    const method = msg['method'] as string;
    const params = msg['params'] as Record<string, unknown> | undefined;

    // Check for registered handler
    const handler = this.rpcHandlers.get(method);
    if (handler) {
      try {
        const result = handler(params);
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
      } catch (err) {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
        }));
      }
      return;
    }

    // Default handlers for common methods
    switch (method) {
      case 'status':
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            state: 'caught_up',
            sessionsIndexed: 5,
            sessionsTotal: 5,
            uptime: 60000,
            version: '0.2.2',
            protocolVersion: 2,
            capabilities: ['search', 'meta', 'run', 'stream', 'titles'],
          },
        }));
        break;

      case 'subscribe':
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: { subscribed: params?.['topics'] ?? [] },
        }));
        break;

      case 'sessions.list':
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: { sessions: [] },
        }));
        break;

      case 'run.list':
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: { runs: [] },
        }));
        break;

      default:
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        }));
    }
  }
}
