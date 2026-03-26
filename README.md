# Tessyn

Tessyn is a background daemon that indexes Claude Code session files into a local SQLite database with full-text search. It watches for filesystem changes, parses JSONL in real time, and serves the indexed data over IPC and WebSocket. This gives you cross-session search, session history, and a CLI for developer workflow tools on top of your Claude Code sessions.

## Prerequisites

- **Node.js >= 22** (required)
- **Claude Code CLI** (optional, needed for title generation and `run.send`)
- macOS, Linux, or Windows
- Native build tools may be needed if prebuilt binaries aren't available for your platform (Xcode CLT on macOS, `build-essential` on Linux, MSVC Build Tools on Windows)

## Quick Start

```bash
# Install globally (requires Node >= 22)
npm install -g tessyn

# Start the daemon
tessyn start

tessyn status
tessyn sessions list
tessyn search "auth bug"
tessyn search "refactor" --project my-project --role assistant
tessyn stop
```

Or from source:

```bash
git clone https://github.com/sapph1re/tessyn.git
cd tessyn
npm install
npm run build
npm install -g .
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `tessyn start [--foreground]` | Start the daemon (background by default, `-f` for foreground) |
| `tessyn stop` | Stop the daemon |
| `tessyn status` | Show daemon state, index stats, version |
| `tessyn sessions list [--project <slug>] [--limit N]` | List indexed sessions |
| `tessyn sessions show <id> [--limit N]` | Display session messages |
| `tessyn search <query> [--project <slug>] [--role <role>]` | Full-text search across all sessions |
| `tessyn titles [--limit N]` | Generate titles for untitled sessions (requires `claude` CLI) |
| `tessyn watch` | Stream daemon events in real-time |
| `tessyn reindex` | Rebuild the entire index from JSONL files |
| `tessyn skills install` | Install Claude Code skills (`/recall`, `/sessions`, `/session-context`) |
| `tessyn skills install --uninstall` | Remove installed skills |

## Claude Code Skills

Tessyn ships with skills (slash commands) for Claude Code. Install them once:

```bash
tessyn skills install
```

Then use them in any Claude Code session:

| Skill | Description |
|-------|-------------|
| `/recall <query>` | Search across all past sessions. Find previous conversations, implementations, and decisions. |
| `/sessions` | Browse session history across all projects. See recent sessions, filter by project. |
| `/session-context <id>` | Load a past session into the current conversation. Brings knowledge from a previous session without switching to it. |

Skills require the Tessyn daemon to be running (`tessyn start`).

To remove installed skills: `tessyn skills install --uninstall`

## How It Works

```
                         Tessyn Daemon
  Claude Code CLI      ┌──────────────────┐      GUI Frontends
  ┌──────────────┐     │ @parcel/watcher  │     ┌────────────┐
  │              │────→│ JSONL parser     │     │ Desktop    │
  │ Writes JSONL │     │ SQLite + FTS5    │←WS─→│ VS Code    │
  │ to disk      │←────│ RunManager       │     │ TUI        │
  │              │spawn│ IPC + WS servers │     └────────────┘
  └──────────────┘     └───────┬──────────┘
                               │IPC
                        ┌──────┴──────┐
                        │ tessyn CLI  │
                        └─────────────┘
```

1. **Claude Code** writes session data to `~/.claude/projects/<slug>/<id>.jsonl`
2. **Tessyn's watcher** detects changes via native filesystem events
3. **The indexer** parses new JSONL lines incrementally (byte-offset checkpoints, no re-reading)
4. **SQLite + FTS5** stores messages with full-text search, filtered by project/role
5. **RunManager** spawns and streams Claude sessions on behalf of GUI clients (`run.send`)
6. **IPC server** (Unix sockets / named pipes) serves the CLI
7. **WebSocket server** (localhost, token-authenticated) serves GUI frontends with real-time push notifications

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

See [docs/](docs/) for architecture, schema, protocol, and testing documentation.

## Contributing

We use trunk-based development with `master` as the trunk. Merge (not rebase) to integrate changes.

### Getting Started

**External contributors:** Fork the repo first, then clone your fork. Replace `origin` with `upstream` when pulling from the main repo.

**Maintainers with write access:** Clone the repo directly.

### Workflow

```bash
# 1. Start from latest master
git switch master
git pull --ff-only origin master

# 2. Check for overlapping work
gh pr list   # Coordinate if someone is working on the same area

# 3. Create a branch
git switch -c <type>/<short-description>
# Types: feat/, fix/, refactor/, docs/, chore/, test/
# Examples: feat/title-generation, fix/socket-path-macos

# 4. Make changes, commit frequently

# 5. Before pushing — all must pass
npm run build && npm run lint && npm test

# 6. Before opening a PR — merge latest master
git fetch origin master
git merge origin/master   # Resolve any conflicts
npm test                  # Run tests again after merge

# 7. Push and open PR
git push -u origin <branch-name>
gh pr create
```

### CI

All PRs are checked by GitHub Actions. All checks must pass before merging.

| Check | Platforms |
|-------|-----------|
| Lint + build | Linux x64 |
| Unit tests | Linux x64, Linux ARM64, macOS ARM64, Windows x64 |
| Integration tests | Linux x64, macOS ARM64, Windows x64 |
| E2E tests | Linux x64, macOS ARM64 |

### Where Things Go

- **Code:** `src/`, tests in `test/`
- **Documentation:** `docs/` — update when architecture, schema, or protocol changes
- **README:** User-facing — update when CLI commands or configuration changes

## Tech Stack

- **TypeScript / Node.js** (>=22) — daemon and CLI
- **better-sqlite3** — synchronous SQLite with FTS5
- **@parcel/watcher** — native file watching (FSEvents, inotify, ReadDirectoryChangesW)
- **ws** — WebSocket server for GUI frontends
- **commander** — CLI framework
- **env-paths** — cross-platform data directories

## License

MIT
