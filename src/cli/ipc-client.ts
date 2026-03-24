import net from 'node:net';
import { getSocketPath } from '../platform/paths.js';
import { DaemonNotRunningError } from '../shared/errors.js';
import type { JsonRpcRequest, JsonRpcResponse } from '../shared/types.js';

const DEFAULT_TIMEOUT = 5000;

/**
 * Send a JSON-RPC request to the daemon over IPC and return the response.
 */
export async function sendRequest(
  method: string,
  params?: Record<string, unknown>,
  socketPath?: string,
  timeout?: number,
): Promise<JsonRpcResponse> {
  const sock = socketPath ?? getSocketPath();
  const timeoutMs = timeout ?? DEFAULT_TIMEOUT;

  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  };

  return new Promise<JsonRpcResponse>((resolve, reject) => {
    let buffer = '';
    let resolved = false;

    const client = net.createConnection(sock, () => {
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (data) => {
      buffer += data.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = buffer.substring(0, newlineIdx).trim();
        if (line && !resolved) {
          resolved = true;
          try {
            const response = JSON.parse(line) as JsonRpcResponse;
            resolve(response);
          } catch {
            reject(new Error('Invalid response from daemon'));
          }
          client.end();
        }
      }
    });

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ||
            (err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new DaemonNotRunningError());
        } else {
          reject(err);
        }
      }
    });

    client.setTimeout(timeoutMs, () => {
      if (!resolved) {
        resolved = true;
        client.destroy();
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }
    });

    client.on('close', () => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Connection closed before response'));
      }
    });
  });
}
