import fs from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';

const paths = envPaths('tessyn', { suffix: '' });

function getDataDir(): string {
  return process.env['TESSYN_DATA_DIR'] ?? paths.data;
}

function getAuthTokenPath(): string {
  return path.join(getDataDir(), 'ws-auth-token');
}

export function getWebSocketPort(): number {
  const envPort = process.env['TESSYN_WS_PORT'];
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  return 9833;
}

/**
 * Read the WebSocket auth token from the daemon's data directory.
 * Returns null if the token file doesn't exist (daemon not running or never started).
 */
export function readAuthToken(): string | null {
  try {
    return fs.readFileSync(getAuthTokenPath(), 'utf-8').trim();
  } catch {
    return null;
  }
}
