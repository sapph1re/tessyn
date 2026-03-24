import os from 'node:os';
import path from 'node:path';
import envPaths from 'env-paths';

const paths = envPaths('tessyn', { suffix: '' });

/**
 * Get the Tessyn data directory (for SQLite DB, logs, etc).
 * Platform-appropriate via env-paths:
 * - macOS: ~/Library/Application Support/tessyn/
 * - Linux: ~/.local/share/tessyn/
 * - Windows: %LOCALAPPDATA%\tessyn\Data\
 */
export function getDataDir(): string {
  return process.env['TESSYN_DATA_DIR'] ?? paths.data;
}

/**
 * Get the Tessyn config directory.
 * - macOS: ~/Library/Preferences/tessyn/
 * - Linux: ~/.config/tessyn/
 * - Windows: %APPDATA%\tessyn\Config\
 */
export function getConfigDir(): string {
  return process.env['TESSYN_CONFIG_DIR'] ?? paths.config;
}

/**
 * Get the Tessyn log directory.
 * - macOS: ~/Library/Logs/tessyn/
 * - Linux: ~/.local/state/tessyn/
 * - Windows: %LOCALAPPDATA%\tessyn\Log\
 */
export function getLogDir(): string {
  return process.env['TESSYN_LOG_DIR'] ?? paths.log;
}

/**
 * Get the Claude Code data directory.
 * Default: ~/.claude (all platforms).
 * Overridable via TESSYN_CLAUDE_DIR for testing and custom profiles.
 */
export function getClaudeDataDir(): string {
  return process.env['TESSYN_CLAUDE_DIR'] ?? path.join(os.homedir(), '.claude');
}

/**
 * Get the Claude Code projects directory where JSONL files live.
 */
export function getClaudeProjectsDir(): string {
  return path.join(getClaudeDataDir(), 'projects');
}

/**
 * Get the IPC socket path for daemon communication.
 * - macOS/Linux: /tmp/tessyn-<uid>.sock (short path to stay under 104-byte macOS limit)
 * - Windows: \\.\pipe\tessyn-<username>
 */
export function getSocketPath(): string {
  if (process.env['TESSYN_SOCKET_PATH']) {
    return process.env['TESSYN_SOCKET_PATH'];
  }

  if (process.platform === 'win32') {
    const username = os.userInfo().username;
    return `\\\\.\\pipe\\tessyn-${username}`;
  }

  // Unix: use /tmp explicitly (not os.tmpdir() which is long on macOS)
  // to stay under macOS 104-byte socket path limit
  const uid = process.getuid?.() ?? process.pid;
  return `/tmp/tessyn-${uid}.sock`;
}

/**
 * Get the SQLite database path.
 */
export function getDatabasePath(): string {
  return process.env['TESSYN_DB_PATH'] ?? path.join(getDataDir(), 'tessyn.db');
}

/**
 * Get the default WebSocket port.
 */
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
