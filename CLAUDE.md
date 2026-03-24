# Tessyn

The developer workflow operating system.

## Build & Test

```bash
npm run build        # TypeScript compilation
npm test             # All tests
npm run test:unit    # Unit tests only
npm run test:integration  # Integration tests
npm run test:e2e     # End-to-end tests
npm run lint         # ESLint
npm run tessyn       # Run CLI (after build)
```

## Architecture

- **Daemon** (`src/daemon/`): Long-running process that watches Claude Code JSONL files, indexes into SQLite, serves IPC + WebSocket
- **CLI** (`src/cli/`): Thin client that talks to daemon over IPC (Unix socket / named pipe)
- **Indexer** (`src/indexer/`): JSONL parser, checkpoint model, session discovery
- **DB** (`src/db/`): SQLite via better-sqlite3, FTS5 search, migration runner
- **Watcher** (`src/watcher/`): @parcel/watcher for file change detection
- **Protocol** (`src/protocol/`): JSON-RPC 2.0 over newline-delimited JSON
- **Platform** (`src/platform/`): Cross-platform paths, signals, installation

## Key Principles

- JSONL is source of truth — Claude Code CLI owns it, Tessyn never writes to it
- SQLite is an index, not a replacement — rebuild from JSONL at any time via `tessyn reindex`
- Cross-platform from day one — macOS, Windows, Linux
- All timestamps are Unix epoch milliseconds (INTEGER in SQLite)
- Use `path.join()` and `os.homedir()` everywhere, never hardcode separators

## Environment Variables

- `TESSYN_CLAUDE_DIR` — Override Claude data directory (default: `~/.claude`)
- `TESSYN_DATA_DIR` — Override Tessyn data directory
- `TESSYN_SOCKET_PATH` — Override IPC socket path
- `TESSYN_WS_PORT` — Override WebSocket port (default: 9833)
- `TESSYN_DB_PATH` — Override SQLite database path
- `TESSYN_LOG_LEVEL` — Log level: debug, info, warn, error (default: info)

## Testing

- Unit tests use `:memory:` SQLite databases and fixture files
- Integration tests use real file system, real sockets, real @parcel/watcher
- E2E tests spawn real daemon processes
- All tests use `TESSYN_CLAUDE_DIR` pointed to temp directories
- No mocks for core infrastructure — test the real thing
