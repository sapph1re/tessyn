# Tessyn

Tessyn is a background daemon that indexes Claude Code session files into a local SQLite database with full-text search. It watches for filesystem changes, parses JSONL in real time, and serves the indexed data over IPC and WebSocket. This gives you cross-session search, session history, and a stable API for building developer tools — desktop apps, VS Code extensions, TUIs, or anything else — on top of your Claude Code workflow.

## Quick Start

```bash
# Install dependencies and build
npm install
npm run build

# Start the daemon (foreground)
tessyn start

# In another terminal:
tessyn status
tessyn sessions list
tessyn search "auth bug"
tessyn search "refactor" --project my-project --role assistant
tessyn stop
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `tessyn start [--daemon]` | Start the daemon (foreground, or `-d` for background) |
| `tessyn stop` | Stop the daemon |
| `tessyn status` | Show daemon state, index stats, version |
| `tessyn sessions list [--project <slug>] [--limit N]` | List indexed sessions |
| `tessyn sessions show <id>` | Display session messages |
| `tessyn search <query> [--project <slug>] [--role <role>]` | Full-text search across all sessions |
| `tessyn titles [--limit N]` | Generate titles for untitled sessions via Claude Haiku |
| `tessyn watch` | Stream daemon events in real-time |
| `tessyn reindex` | Rebuild the entire index from JSONL files |

## How It Works

```
  Claude Code CLI          Tessyn Daemon            Frontends
  ┌──────────────┐      ┌─────────────────┐     ┌────────────┐
  │ Writes JSONL │─────→│ @parcel/watcher  │     │ Desktop    │
  │ to disk      │      │ JSONL parser     │←───→│ VS Code    │
  │              │      │ SQLite + FTS5    │ WS  │ TUI        │
  └──────────────┘      │ IPC server       │←───→│ CLI        │
                        └─────────────────┘ IPC  └────────────┘
```

1. **Claude Code** writes session data to `~/.claude/projects/<slug>/<id>.jsonl`
2. **Tessyn's watcher** detects changes via native filesystem events
3. **The indexer** parses new JSONL lines incrementally (byte-offset checkpoints, no re-reading)
4. **SQLite + FTS5** stores messages with full-text search, filtered by project/role
5. **IPC server** (Unix sockets / named pipes) serves the CLI
6. **WebSocket server** (localhost, token-authenticated) serves GUI frontends with real-time push notifications

JSONL files are the source of truth. Tessyn never writes to them. The SQLite database is a disposable index — `tessyn reindex` rebuilds it from scratch at any time.

## Architecture

```
src/
├── daemon/       # Entry point, lifecycle, IPC + WebSocket servers
├── cli/          # Commander-based CLI, IPC client
├── assist/       # Claude API integration (title generation)
├── indexer/      # JSONL parser, checkpoint model, session discovery
├── db/           # SQLite, FTS5, migrations, prepared queries
├── watcher/      # @parcel/watcher, debounced change processing
├── protocol/     # JSON-RPC 2.0 types, handlers, event subscriptions
├── platform/     # Cross-platform paths, signals, installation
└── shared/       # Types, errors, logger
```

## Cross-Platform

Tessyn runs on macOS, Windows, and Linux. CI tests on 4 targets:

| Platform | IPC | File Watcher Backend |
|----------|-----|---------------------|
| macOS ARM64 | Unix domain socket | FSEvents |
| Linux x64 | Unix domain socket | inotify |
| Linux ARM64 | Unix domain socket | inotify |
| Windows x64 | Named pipe | ReadDirectoryChangesW |

## Configuration

All paths are overridable via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TESSYN_CLAUDE_DIR` | `~/.claude` | Claude Code data directory |
| `TESSYN_DATA_DIR` | Platform-appropriate¹ | Tessyn data directory (SQLite, logs) |
| `TESSYN_DB_PATH` | `<data_dir>/tessyn.db` | SQLite database path |
| `TESSYN_SOCKET_PATH` | `/tmp/tessyn-<uid>.sock`² | IPC socket path |
| `TESSYN_WS_PORT` | `9833` | WebSocket server port |
| `TESSYN_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |
| `ANTHROPIC_API_KEY` | *(none)* | Required for title generation (`tessyn titles`) |

¹ macOS: `~/Library/Application Support/tessyn/`, Linux: `~/.local/share/tessyn/`, Windows: `%LOCALAPPDATA%\tessyn\Data\`
² Windows: `\\.\pipe\tessyn-<username>`

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm test             # All tests (unit + integration + E2E)
npm run test:unit    # Unit tests only
npm run test:watch   # Watch mode for unit tests
npm run lint         # ESLint
```

See [CLAUDE.md](CLAUDE.md) for conventions and architecture details.

## Tech Stack

- **TypeScript / Node.js** (>=22) — daemon and CLI
- **better-sqlite3** — synchronous SQLite with FTS5
- **@parcel/watcher** — native file watching (FSEvents, inotify, ReadDirectoryChangesW)
- **ws** — WebSocket server for GUI frontends
- **commander** — CLI framework
- **env-paths** — cross-platform data directories

## License

MIT
