import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import { getWebSocketPort } from '../platform/paths.js';
import { getStatus } from './lifecycle.js';
import { handleRequest } from '../protocol/handlers.js';
import { SubscriptionManager } from '../protocol/events.js';
import { createNotification, parseRequest, createResponse, createErrorResponse, RPC_ERRORS } from '../protocol/types.js';
import type { JsonRpcNotification } from '../shared/types.js';

const log = createLogger('ws-server');

let wss: WebSocketServer | null = null;
const subscriptions = new SubscriptionManager();
const clientMap = new Map<WebSocket, string>(); // ws -> clientId

/**
 * Start the WebSocket server for GUI frontends.
 */
export function startWsServer(db: Database.Database, port?: number): Promise<WebSocketServer> {
  const wsPort = port ?? getWebSocketPort();

  return new Promise((resolve, reject) => {
    wss = new WebSocketServer({ host: '127.0.0.1', port: wsPort });

    wss.on('listening', () => {
      log.info('WebSocket server listening', { port: wsPort });
      resolve(wss!);
    });

    wss.on('error', (err) => {
      log.error('WebSocket server error', { error: err.message });
      reject(err);
    });

    wss.on('connection', (ws) => {
      const clientId = crypto.randomUUID();
      clientMap.set(ws, clientId);
      log.info('WebSocket client connected', { clientId });

      // Send current status on connect
      const statusNotification = createNotification('status', getStatus() as unknown as Record<string, unknown>);
      ws.send(JSON.stringify(statusNotification));

      ws.on('message', (data) => {
        const raw = data.toString().trim();
        if (!raw) return;

        // Handle subscribe/unsubscribe specially
        const request = parseRequest(raw);
        if (request) {
          if (request.method === 'subscribe') {
            const topics = (request.params?.['topics'] ?? []) as string[];
            subscriptions.subscribe(clientId, topics);
            ws.send(JSON.stringify(createResponse(request.id, { subscribed: topics })));
            return;
          }
          if (request.method === 'unsubscribe') {
            const topics = (request.params?.['topics'] ?? []) as string[];
            subscriptions.unsubscribe(clientId, topics);
            ws.send(JSON.stringify(createResponse(request.id, { unsubscribed: topics })));
            return;
          }
        }

        // All other requests go through the standard handler
        const response = handleRequest(db, raw);
        ws.send(JSON.stringify(response));
      });

      ws.on('close', () => {
        subscriptions.removeClient(clientId);
        clientMap.delete(ws);
        log.info('WebSocket client disconnected', { clientId });
      });

      ws.on('error', (err) => {
        log.warn('WebSocket client error', { clientId, error: err.message });
      });
    });
  });
}

/**
 * Broadcast a notification to all subscribed WebSocket clients.
 */
export function broadcastNotification(notification: JsonRpcNotification): void {
  if (!wss) return;

  const method = notification.method;
  const subscriberIds = subscriptions.getSubscribers(method);
  const subscriberSet = new Set(subscriberIds);

  const payload = JSON.stringify(notification);

  for (const [ws, clientId] of clientMap) {
    if (ws.readyState === WebSocket.OPEN && subscriberSet.has(clientId)) {
      try {
        // Backpressure check: if buffered amount is too high, skip
        if (ws.bufferedAmount > 1024 * 1024) {
          log.warn('Skipping notification due to backpressure', { clientId, method });
          continue;
        }
        ws.send(payload);
      } catch (err) {
        log.warn('Failed to send notification', {
          clientId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/**
 * Stop the WebSocket server.
 */
export function stopWsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (wss) {
      // Close all connections
      for (const [ws, clientId] of clientMap) {
        subscriptions.removeClient(clientId);
        ws.close(1001, 'Server shutting down');
      }
      clientMap.clear();

      wss.close(() => {
        wss = null;
        log.info('WebSocket server stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}
