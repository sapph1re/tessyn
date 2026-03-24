import net from 'node:net';
import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import { getSocketPath } from '../platform/paths.js';
import { handleRequest } from '../protocol/handlers.js';

const log = createLogger('ipc-server');

let server: net.Server | null = null;

/**
 * Start the IPC server for CLI clients.
 * Uses Unix domain sockets on macOS/Linux and named pipes on Windows.
 */
export function startIpcServer(db: Database.Database, socketPath?: string): Promise<net.Server> {
  const sock = socketPath ?? getSocketPath();

  return new Promise((resolve, reject) => {
    server = net.createServer((conn) => {
      let buffer = '';

      conn.on('data', (data) => {
        buffer += data.toString();

        // Process complete messages (newline-delimited)
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIdx).trim();
          buffer = buffer.substring(newlineIdx + 1);

          if (line) {
            const response = handleRequest(db, line);
            conn.write(JSON.stringify(response) + '\n');
          }
        }
      });

      conn.on('error', (err) => {
        log.debug('IPC client connection error', { error: err.message });
      });
    });

    server.on('error', (err) => {
      log.error('IPC server error', { error: err.message });
      reject(err);
    });

    server.listen(sock, () => {
      log.info('IPC server listening', { path: sock });
      resolve(server!);
    });
  });
}

/**
 * Stop the IPC server.
 */
export function stopIpcServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        log.info('IPC server stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}
