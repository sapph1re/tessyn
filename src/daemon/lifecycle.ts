import net from 'node:net';
import fs from 'node:fs';
import { createLogger } from '../shared/logger.js';
import { getSocketPath } from '../platform/paths.js';
import type { DaemonState, DaemonStatus } from '../shared/types.js';
import { DaemonAlreadyRunningError } from '../shared/errors.js';

const log = createLogger('lifecycle');

const VERSION = '0.2.0';
const PROTOCOL_VERSION = 2;
const startTime = Date.now();

let state: DaemonState = 'cold';
let sessionsIndexed = 0;
let sessionsTotal = 0;

export function getState(): DaemonState {
  return state;
}

export function setState(newState: DaemonState): void {
  const oldState = state;
  state = newState;
  log.info(`State transition: ${oldState} → ${newState}`);
}

export function setIndexProgress(indexed: number, total: number): void {
  sessionsIndexed = indexed;
  sessionsTotal = total;
}

export function getStatus(): DaemonStatus {
  return {
    state,
    sessionsIndexed,
    sessionsTotal,
    uptime: Date.now() - startTime,
    version: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: ['search', 'meta', 'run', 'stream', 'titles'],
  };
}

/**
 * Check if another daemon is already running by pinging the socket.
 * Returns true if a daemon is responding.
 */
export async function isDaemonRunning(socketPath?: string): Promise<boolean> {
  const sock = socketPath ?? getSocketPath();
  return new Promise<boolean>((resolve) => {
    const client = net.createConnection(sock, () => {
      // Connection succeeded — daemon is running
      // Send a ping and close
      client.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'status' }) + '\n');
      client.end();
      resolve(true);
    });
    client.on('error', () => {
      resolve(false);
    });
    // Timeout after 2 seconds
    client.setTimeout(2000, () => {
      client.destroy();
      resolve(false);
    });
  });
}

/**
 * Clean up stale Unix socket file.
 * On Windows, named pipes auto-clean, so this is a no-op.
 */
export function cleanStaleSocket(socketPath?: string): void {
  if (process.platform === 'win32') return;

  const sock = socketPath ?? getSocketPath();
  try {
    fs.unlinkSync(sock);
    log.info('Cleaned stale socket', { path: sock });
  } catch (err: unknown) {
    // ENOENT is fine — no stale socket to clean
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('Failed to clean stale socket', { path: sock, error: (err as Error).message });
    }
  }
}

/**
 * Acquire single-instance lock by attempting to listen on the socket.
 * If another daemon is running, throws DaemonAlreadyRunningError.
 * If socket is stale, cleans it up and proceeds.
 */
export async function acquireLock(socketPath?: string): Promise<void> {
  const sock = socketPath ?? getSocketPath();

  const running = await isDaemonRunning(sock);
  if (running) {
    throw new DaemonAlreadyRunningError();
  }

  // Not running — clean up stale socket if present
  cleanStaleSocket(sock);
}
