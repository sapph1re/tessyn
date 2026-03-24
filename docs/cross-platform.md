# Cross-Platform

Tessyn runs on macOS, Windows, and Linux. This document covers platform-specific behavior and gotchas.

## Platform Matrix

| | macOS | Linux | Windows |
|---|---|---|---|
| IPC | Unix domain socket | Unix domain socket | Named pipe |
| File watcher | FSEvents | inotify | ReadDirectoryChangesW |
| Data dir | `~/Library/Application Support/tessyn/` | `~/.local/share/tessyn/` | `%LOCALAPPDATA%\tessyn\Data\` |
| Claude data | `~/.claude/` | `~/.claude/` | `%USERPROFILE%\.claude\` |
| Socket path | `/tmp/tessyn-<uid>.sock` | `/tmp/tessyn-<uid>.sock` | `\\.\pipe\tessyn-<username>` |

## Path Handling

- Always use `path.join()` and `os.homedir()` — never hardcode `/` or `\`
- Use `env-paths` for Tessyn's own directories (respects XDG on Linux)
- Claude Code data directory: `os.homedir()/.claude`, overridable via `TESSYN_CLAUDE_DIR`
- All paths are overridable via environment variables for testing

## Socket Path (macOS Gotcha)

macOS has a **104-byte limit** on Unix socket paths. `os.tmpdir()` on macOS returns `/var/folders/s6/.../T/` which is already ~60 bytes. We use `/tmp/` explicitly instead to stay well under the limit.

## File Watching

`@parcel/watcher` uses native backends per platform. Key behavioral differences:

- **macOS (FSEvents):** Events may arrive with `/private/var/` prefix even when watching `/var/` (symlink resolution). The `resolveRealPath()` helper in `watcher/claude-paths.ts` handles this.
- **Windows (ReadDirectoryChangesW):** Mandatory file locking — if Claude Code has a file open exclusively, reads may get `EBUSY`. The JSONL parser opens files read-only with shared access.
- **Linux (inotify):** Fastest event delivery (~10ms). No special handling needed.

## Signal Handling

- **macOS/Linux:** `SIGTERM` and `SIGINT` for graceful shutdown. Both registered in `platform/signals.ts`.
- **Windows:** `SIGTERM` is emulated by Node.js — `process.on('SIGTERM')` works. No `SIGUSR1`/`SIGUSR2`. For child process shutdown, the daemon also listens for `process.on('message', 'shutdown')`.

## IPC Security

- **Unix:** Socket file gets `chmod 0600` after creation (owner-only read/write).
- **Windows:** Named pipe uses default security. Pipe name includes username to prevent cross-user collision.

## WebSocket Security

- Bound to `127.0.0.1` only (not `0.0.0.0`)
- Origin check rejects non-localhost origins
- Auth token generated per daemon start, written to `<data_dir>/ws-auth-token` with `0600` permissions
- GUI frontends read this token file to authenticate

## Line Endings

JSONL files from Claude Code use `\n` on all platforms. The parser handles both `\n` and `\r\n` (split on `\n`, trim trailing `\r`) as a safety measure.

## Environment Variables

All configuration is overridable for testing and custom setups:

| Variable | Default | Description |
|----------|---------|-------------|
| `TESSYN_CLAUDE_DIR` | `~/.claude` | Claude Code data directory |
| `TESSYN_DATA_DIR` | Platform-appropriate | Tessyn data directory |
| `TESSYN_DB_PATH` | `<data_dir>/tessyn.db` | SQLite database path |
| `TESSYN_SOCKET_PATH` | `/tmp/tessyn-<uid>.sock` | IPC socket path |
| `TESSYN_WS_PORT` | `9833` | WebSocket server port |
| `TESSYN_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |
