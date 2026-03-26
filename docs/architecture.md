# Architecture

## Overview

Tessyn is a background daemon that indexes Claude Code's JSONL session files into a local SQLite database with full-text search, and serves the data over IPC and WebSocket.

```
  Claude Code CLI          Tessyn Daemon            Frontends
  ┌──────────────┐      ┌─────────────────┐     ┌────────────┐
  │ Writes JSONL │─────→│ @parcel/watcher  │     │ Desktop    │
  │ to disk      │      │ JSONL parser     │←───→│ VS Code    │
  │              │      │ SQLite + FTS5    │ WS  │ TUI        │
  └──────────────┘      │ IPC server       │←───→│ CLI        │
                        └─────────────────┘ IPC  └────────────┘
```

## Data Flow

**Indexing (watch → parse → index):**
1. Claude Code writes session data to `~/.claude/projects/<slug>/<id>.jsonl`
2. @parcel/watcher detects file changes via native OS events (FSEvents / inotify / ReadDirectoryChangesW)
3. Changes are debounced (200ms window) and filtered to `*.jsonl` only
4. The checkpoint model decides: skip (unchanged), incremental (appended), or full reparse (replaced/truncated)
5. JSONL parser reads new lines, extracts messages with their byte ranges
6. Messages are inserted into SQLite in a single atomic transaction
7. WebSocket subscribers are notified of the change

**Querying (CLI or frontend → daemon → SQLite):**
1. Client sends a JSON-RPC 2.0 request over IPC (CLI) or WebSocket (GUI)
2. Daemon runs the query against SQLite (FTS5 for search, standard queries for session listing)
3. Response is returned as JSON-RPC

## Components

```
src/
├── daemon/       # Entry point, lifecycle, IPC + WebSocket servers
├── cli/          # Commander-based CLI, IPC client
├── assist/       # Claude CLI integration (title generation)
├── run/          # Claude process management (spawn, stream, cancel)
├── indexer/      # JSONL parser, checkpoint model, session discovery
├── db/           # SQLite, FTS5, migrations, prepared queries
├── watcher/      # @parcel/watcher, debounced change processing
├── protocol/     # JSON-RPC 2.0 types, handlers, event subscriptions
├── platform/     # Cross-platform paths, signals, installation
└── shared/       # Types, errors, logger

skills/             # Claude Code skills (installed via `tessyn skills install`)
├── recall/         # /recall — full-text search across all sessions
├── sessions/       # /sessions — browse session history
└── session-context/ # /session-context — load past session into context
```

### Daemon (`src/daemon/`)

The daemon is the central process. On startup:
1. Acquires single-instance lock (attempt to listen on IPC socket; if taken, ping to verify liveness)
2. Initializes SQLite with WAL mode and runs pending migrations
3. Starts IPC server (Unix socket / named pipe) and WebSocket server (localhost, token-authenticated)
4. Performs initial full scan of all JSONL files → transitions from `cold` → `scanning` → `caught_up`
5. Generates titles for untitled sessions (background, requires `claude` CLI)
6. Starts file watcher for ongoing changes

Readiness state machine: `cold` → `scanning` → `caught_up` (or `degraded` on errors).

### Indexer (`src/indexer/`)

**JSONL Parser:** Line-by-line parser that handles all Claude Code event types:
- `user` — user messages (string content)
- `assistant` — assistant responses (array of content blocks: text, tool_use, thinking)
- `system` — system messages, session init (carries session_id)
- `result` — completion metadata (carries session_id)
- Skipped: progress, file-history-snapshot, queue-operation, pr-link

**Checkpoint Model:** Each session tracks its parse state:
- `jsonl_byte_offset` — last fully parsed byte position
- `jsonl_size` — file size at last parse
- `jsonl_identity` — SHA-256 hash of first 1KB (detects file replacement vs. append)

Decision logic on file change:
- Identity match + size grew → **incremental** (seek to offset, parse new lines only)
- Identity mismatch or size shrank → **full reparse** (parse first, then replace in atomic transaction)
- File gone → mark session as `deleted` (keep in DB, may come back)

**Session Discovery:** Scans `~/.claude/projects/` for `<slug>/<session-id>.jsonl` files. Project slug matches Claude Code's encoding: all non-alphanumeric characters except `-` replaced with `-`.

### Protocol (`src/protocol/`)

JSON-RPC 2.0 over newline-delimited JSON. Two layers:

**Base layer (IPC + WebSocket):** `sessions.list`, `sessions.get`, `search`, `status`, `reindex`, `titles.generate`, `shutdown`, `sessions.rename`, `sessions.hide`, `sessions.archive`, `sessions.toggles.get/set`, `sessions.draft.get/save`, `run.send`, `run.cancel`, `run.list`, `run.get`

**Event layer (WebSocket only):** `session.created`, `session.updated`, `session.deleted`, `index.state_changed`, `run.started`, `run.system`, `run.delta`, `run.block_start/stop`, `run.message`, `run.completed`, `run.failed`, `run.cancelled`, `run.rate_limit`. Clients subscribe via `subscribe`/`unsubscribe` RPC methods with wildcard topic matching (`session.*`, `run.*`, `*`).

### IPC vs WebSocket

| | IPC (CLI clients) | WebSocket (GUI frontends) |
|---|---|---|
| Transport | Unix domain socket / named pipe | ws on localhost:9833 |
| Auth | Socket file permissions (chmod 0600) | Token from `<data_dir>/ws-auth-token` + origin check |
| Pattern | Request/response only | Request/response + push notifications |
| Connection | One-shot per CLI invocation | Long-lived with subscriptions |

## Key Principles

- **JSONL is sacred.** Claude Code owns the JSONL files. Tessyn never writes to them. Users can switch between Claude Code terminal and Tessyn seamlessly.
- **SQLite is disposable.** It's an index, not a replacement. `tessyn reindex` rebuilds from scratch.
- **Store everything, present selectively.** Full JSONL structure (tool_use, thinking blocks, metadata) is preserved. Presentation layer decides what to show.
- **Provider-agnostic.** The schema has a `provider` column. When other AI tools need indexing, it's a new importer writing to the same schema.
- **Cross-platform from day one.** macOS, Windows, Linux. No hardcoded paths, no platform assumptions.
- **Real tests, no mocks.** Real SQLite, real file system, real sockets, real watcher.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript / Node.js (>=22) |
| Database | SQLite via better-sqlite3, FTS5 for search |
| File watching | @parcel/watcher (native per-platform backends) |
| IPC | Node.js `net` module (Unix sockets / named pipes) |
| WebSocket | ws library |
| CLI framework | commander |
| Claude integration | `claude -p` subprocess (uses subscription, no API key) |
| Data directories | env-paths (XDG-compliant) |
| Testing | Vitest (pool: forks for native addon isolation) |
| CI | GitHub Actions, 4-target matrix |
