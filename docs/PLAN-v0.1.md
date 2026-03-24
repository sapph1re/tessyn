# Tessyn Core Daemon — Implementation Plan

## Overview

Build the foundation: a cross-platform Node.js/TypeScript daemon that watches Claude Code's JSONL files, indexes them into SQLite with FTS5, and serves session data over IPC (CLI) and WebSocket (GUI frontends).

**Platforms:** macOS (ARM64 + x86_64), Windows (x64), Linux (x64 + ARM64)

## Project Structure

```
tessyn/
├── src/
│   ├── daemon/
│   │   ├── index.ts              # Daemon entry point
│   │   ├── lifecycle.ts          # Single-instance lock, readiness state, graceful shutdown
│   │   ├── ipc-server.ts         # net.Server for CLI clients (Unix socket / named pipe)
│   │   └── ws-server.ts          # WebSocket server for GUI frontends
│   ├── cli/
│   │   ├── index.ts              # CLI entry point (commander)
│   │   ├── commands/
│   │   │   ├── start.ts          # tessyn start [--daemon]
│   │   │   ├── stop.ts           # tessyn stop
│   │   │   ├── status.ts         # tessyn status
│   │   │   ├── sessions.ts       # tessyn sessions [list|show]
│   │   │   ├── search.ts         # tessyn search <query>
│   │   │   └── reindex.ts        # tessyn reindex
│   │   └── ipc-client.ts         # Thin client connecting to daemon socket
│   ├── watcher/
│   │   ├── index.ts              # @parcel/watcher setup and event routing
│   │   ├── claude-paths.ts       # Cross-platform Claude data dir resolution (overridable)
│   │   └── debounce.ts           # Debounced file change batching
│   ├── indexer/
│   │   ├── index.ts              # Orchestrator: watcher events -> parser -> SQLite
│   │   ├── jsonl-parser.ts       # Line-by-line JSONL parser with error recovery
│   │   ├── checkpoint.ts         # Byte-offset ingestion checkpoint with identity verification
│   │   └── session-discovery.ts  # Scan existing sessions, project slug derivation
│   ├── db/
│   │   ├── index.ts              # Database initialization, WAL mode, connection management
│   │   ├── schema.ts             # Schema definition + migration runner
│   │   ├── queries.ts            # Prepared statements for all operations
│   │   └── migrations/
│   │       └── 001-initial.ts    # Initial schema
│   ├── protocol/
│   │   ├── types.ts              # JSON-RPC 2.0 message types (requests, responses, notifications)
│   │   ├── handlers.ts           # Request routing and response formatting
│   │   └── events.ts             # WebSocket notification/subscription definitions
│   ├── platform/
│   │   ├── paths.ts              # Cross-platform path utilities (env-paths, socket paths)
│   │   ├── signals.ts            # Cross-platform signal/shutdown handling
│   │   └── install.ts            # Platform-specific daemon installation (stretch)
│   └── shared/
│       ├── types.ts              # Shared TypeScript types
│       ├── errors.ts             # Error types
│       └── logger.ts             # Structured logging
├── test/
│   ├── unit/
│   │   ├── jsonl-parser.test.ts
│   │   ├── checkpoint.test.ts
│   │   ├── claude-paths.test.ts
│   │   ├── session-discovery.test.ts
│   │   ├── schema.test.ts
│   │   └── protocol.test.ts
│   ├── integration/
│   │   ├── indexer.test.ts        # Real SQLite + fixture JSONL files
│   │   ├── watcher.test.ts        # Real @parcel/watcher + temp dirs
│   │   ├── ipc.test.ts            # Real net.Server + net.Socket
│   │   ├── search.test.ts         # FTS5 queries against indexed data
│   │   ├── checkpoint.test.ts     # Partial writes, truncation, crash recovery
│   │   └── idempotency.test.ts    # Duplicate events, repeated reindex
│   ├── e2e/
│   │   ├── daemon-lifecycle.test.ts  # Spawn real daemon, exercise via CLI
│   │   └── watch-index-query.test.ts # Write JSONL -> watcher -> index -> query
│   └── fixtures/
│       └── conversations/
│           ├── simple-chat.jsonl
│           ├── multi-turn-with-tools.jsonl
│           ├── thinking-blocks.jsonl
│           ├── malformed-lines.jsonl
│           ├── partial-line.jsonl      # Incomplete trailing line
│           ├── mixed-line-endings.jsonl # \n and \r\n
│           ├── empty.jsonl
│           └── large-conversation.jsonl
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .github/
│   └── workflows/
│       └── ci.yml
└── CLAUDE.md
```

## Phase 1: Project Scaffold, Lifecycle & CI

### 1.1 Initialize project
- `npm init`, tsconfig.json (strict, ESM, NodeNext module resolution)
- Install dev deps: typescript, vitest, @types/node, @types/better-sqlite3, @types/ws
- Install prod deps: better-sqlite3, @parcel/watcher, ws, env-paths, commander
- ESLint with @typescript-eslint (minimal config)
- CLAUDE.md with project conventions

### 1.2 Platform utilities
- `platform/paths.ts`:
  - `getSocketPath()`: `/tmp/tessyn-<uid>.sock` (macOS/Linux), `\\.\pipe\tessyn-<username>` (Windows)
  - `getDataDir()`: via env-paths (XDG on Linux, ~/Library on macOS, %LOCALAPPDATA% on Windows)
  - `getClaudeDataDir()`: `os.homedir()/.claude` by default, overridable via `TESSYN_CLAUDE_DIR` env var
- `platform/signals.ts`: cross-platform graceful shutdown handler (SIGTERM/SIGINT on Unix, process message on Windows)
- Tests for path generation on each platform

### 1.3 Minimal daemon lifecycle
- Single-instance lock: attempt to listen on IPC socket. If EADDRINUSE, ping existing socket.
  If ping succeeds → daemon already running. If ping fails → stale socket, clean up and take over.
- Readiness state machine: `cold` → `scanning` → `caught_up`. Also `degraded` on errors.
- Foreground start: `tessyn start` (default for development)
- Graceful shutdown: close watcher → flush pending writes → close SQLite → close sockets → exit
- Health endpoint: returns `{state, sessionsIndexed, sessionsTotal, uptime, version}`

### 1.4 CI pipeline
- GitHub Actions workflow with tiered matrix
- Windows job: `git config --global core.autocrlf false` BEFORE checkout step
- CI tiers:
  - **Unit tests**: all 5 targets (Linux x64, Linux ARM64, macOS ARM64, macOS x86_64, Windows x64)
  - **Integration tests**: 3 targets (Linux x64, macOS ARM64, Windows x64)
  - **E2E tests**: 2 targets (Linux x64, macOS ARM64) — expand as stability proves out
- Steps per job: checkout, setup-node (v22, npm cache), npm ci, npm run build, npm test:<tier>

## Phase 2: JSONL Parser & Session Discovery

### 2.1 JSONL parser
- Line-by-line streaming parser using `fs.createReadStream` with byte offset support
- Handle event types: user, assistant, system, result, progress, file-history-snapshot, queue-operation
- Extract from assistant content blocks: text, tool_use (name + input), thinking
- Per-line error recovery: skip malformed lines, log warning, continue
- Handle both `\n` and `\r\n` line endings (split on `\n`, trim trailing `\r`)
- Read with shared/read-only access flags for concurrent reading while Claude writes
- Return parsed events with their byte ranges for checkpoint tracking

### 2.2 Ingestion checkpoint model
- Per-session checkpoint stored in `sessions` table:
  - `jsonl_byte_offset` (INTEGER): last fully parsed byte position (end of last complete line)
  - `jsonl_size` (INTEGER): file size at last parse
  - `jsonl_identity` (TEXT): hash of first 1KB of file (detect replacement vs. append)
- On file change event:
  1. Read current file size and first-1KB hash
  2. If identity matches and size >= stored size: **incremental** — seek to byte_offset, parse new lines
  3. If identity doesn't match or size < stored size: **full reparse** — delete existing messages, reparse from byte 0
  4. If file gone: mark session as `deleted` (don't remove from DB — the file may come back)
- Only process complete lines (ignore trailing bytes without `\n`)

### 2.3 Session discovery
- Project slug algorithm (match Claude Code's encoding: non-alphanumeric except `-` → `-`)
- `getClaudeDataDir()` resolved cross-platform (overridable via env/config)
- Within each project dir: discover `*.jsonl` files
- Extract metadata: session ID (from filename), timestamps, message count, first prompt
- Sort by last user/assistant message timestamp

### 2.4 Test fixtures
- Capture real JSONL samples from actual Claude Code sessions (anonymized)
- Create synthetic edge cases: empty, malformed, partial lines, mixed line endings, very long messages, Unicode
- Include fixtures for: simple chat, multi-turn with tools, thinking blocks, system events

## Phase 3: SQLite Schema & Indexer

### 3.1 Schema
```sql
-- Schema versioning
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL  -- Unix epoch ms
);

-- Provider-agnostic sessions
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'claude',
  external_id TEXT NOT NULL,          -- provider's session UUID
  project_slug TEXT NOT NULL,
  project_path TEXT,                  -- original working directory
  title TEXT,                         -- generated or user-assigned
  first_prompt TEXT,                  -- first user message (truncated to 500 chars)
  created_at INTEGER NOT NULL,        -- Unix epoch ms
  updated_at INTEGER NOT NULL,        -- Unix epoch ms
  message_count INTEGER DEFAULT 0,
  jsonl_path TEXT NOT NULL,           -- absolute path to source JSONL
  jsonl_byte_offset INTEGER DEFAULT 0, -- last parsed byte position
  jsonl_size INTEGER DEFAULT 0,       -- file size at last parse
  jsonl_identity TEXT,                -- hash of first 1KB for replacement detection
  git_branch TEXT,
  git_remote TEXT,
  state TEXT NOT NULL DEFAULT 'active', -- active, deleted
  UNIQUE(provider, external_id)
);

CREATE INDEX idx_sessions_project ON sessions(project_slug);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_state ON sessions(state);

-- Messages (full content preserved)
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,               -- user, assistant, system
  content TEXT NOT NULL,            -- full text content
  tool_name TEXT,                   -- for tool_use blocks
  tool_input TEXT,                  -- JSON string for tool_use
  timestamp INTEGER NOT NULL,       -- Unix epoch ms
  sequence INTEGER NOT NULL,        -- order within session (derived from JSONL line position)
  block_type TEXT,                  -- text, tool_use, thinking, tool_result
  UNIQUE(session_id, sequence)      -- dedupe key for idempotent upserts
);

CREATE INDEX idx_messages_session ON messages(session_id, sequence);

-- FTS5 for full-text search (with unindexed metadata for filtered queries)
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  session_id UNINDEXED,
  role UNINDEXED,
  content=messages,
  content_rowid=id,
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content, session_id, role)
  VALUES (new.id, new.content, new.session_id, new.role);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
  VALUES('delete', old.id, old.content, old.session_id, old.role);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
  VALUES('delete', old.id, old.content, old.session_id, old.role);
  INSERT INTO messages_fts(rowid, content, session_id, role)
  VALUES (new.id, new.content, new.session_id, new.role);
END;
```

### 3.2 Migration runner
- Simple: read schema_version, run pending migrations in order
- Each migration is a function receiving a Database instance, runs within a transaction
- Rebuild-from-JSONL as escape hatch: `tessyn reindex` drops all data and reparses every JSONL file
- Migration failures are fatal (log error, exit) — don't serve stale schema

### 3.3 Indexer
- Accepts parsed JSONL events, inserts into SQLite using `INSERT OR REPLACE` on `(session_id, sequence)`
- Batch inserts within a single transaction for performance
- Updates session checkpoint (byte_offset, size, identity) after successful batch
- Transitions daemon readiness state: `scanning` while initial index runs, `caught_up` when done
- Full reindex: delete all rows, re-scan all JSONL files, rebuild FTS

## Phase 4: File Watcher

### 4.1 Watcher setup
- @parcel/watcher on `getClaudeDataDir()/projects/` (resolved cross-platform, overridable)
- Filter for `*.jsonl` file events only
- Debounce: batch changes over 200ms window before processing
- Handle: new file (new session), modified file (new messages), deleted file (mark session deleted)

### 4.2 Change processing
- On file change event:
  1. Resolve session from file path (or create new session record)
  2. Run checkpoint verification (identity match, size comparison)
  3. Parse new content (incremental or full based on checkpoint)
  4. Index into SQLite within a transaction
  5. Emit `session.updated` or `session.created` event to WebSocket subscribers
- Duplicate watcher events: checkpoint model naturally dedupes (same byte offset = nothing to parse)

### 4.3 Initial scan on startup
- Scan all existing JSONL files in Claude data directory
- Compare with SQLite state:
  - New files (not in DB): create session + full parse
  - Changed files (size/identity mismatch): incremental or full reparse
  - Missing files (in DB but not on disk): mark session as `deleted`
- Daemon starts serving IPC/WebSocket immediately in `scanning` state
- Transitions to `caught_up` when scan completes
- Status responses include `{state, sessionsIndexed, sessionsTotal}`

## Phase 5: Protocol & Servers

### 5.1 Protocol definition
Two layers:

**Base layer (JSON-RPC 2.0, shared by IPC and WebSocket):**
- `sessions.list` — list sessions with optional filters (project, state, date range, limit/offset)
- `sessions.get` — get single session with messages (supports pagination)
- `search` — full-text search with optional filters (project, role, date range)
- `status` — daemon state, index stats, version, uptime
- `reindex` — trigger full reindex (returns immediately, state transitions to `scanning`)

**Event layer (WebSocket only, JSON-RPC notifications):**
- `session.created` — new session indexed
- `session.updated` — new messages added to existing session
- `session.deleted` — session file removed
- `index.state_changed` — daemon readiness state transition
- Subscription: `subscribe` / `unsubscribe` RPC methods with topic filters
- Backpressure: if WebSocket send buffer exceeds threshold, drop oldest notifications

### 5.2 IPC server (CLI clients)
- Node `net.Server` listening on platform-appropriate socket path
- Stale socket cleanup on startup (Unix: unlink if ping fails)
- Newline-delimited JSON framing
- Single connection per CLI invocation: connect, send request, read response, disconnect
- 5-second timeout for responses

### 5.3 WebSocket server (GUI frontends)
- `ws` library on `localhost:9833` (configurable via `TESSYN_WS_PORT`)
- Same JSON-RPC base protocol as IPC
- Additionally handles subscribe/unsubscribe and pushes notifications
- Connection lifecycle: on connect, send current daemon status; on disconnect, clean up subscriptions

## Phase 6: CLI Client

### 6.1 Commands
- `tessyn start [--daemon]` — start daemon (foreground default, `--daemon` for background)
- `tessyn stop` — send shutdown command via IPC
- `tessyn status` — show daemon state, index stats, version
- `tessyn sessions [--project <slug>] [--limit N]` — list sessions
- `tessyn sessions show <id>` — display session messages
- `tessyn search <query> [--project <slug>] [--role user|assistant]` — full-text search
- `tessyn reindex` — trigger full reindex

### 6.2 IPC client
- Connect to daemon socket (platform-appropriate path)
- Send JSON-RPC request, await response with 5-second timeout
- If daemon not running: helpful error with `tessyn start` suggestion
- If daemon is in `scanning` state: show warning that results may be incomplete

## Phase 7: Platform Installation (stretch)

### 7.1 Background mode
- `tessyn start --daemon`: detach process, redirect stdout/stderr to log file in data dir
- Log rotation: keep last 5 log files, 10MB each

### 7.2 Auto-start installation
- `tessyn install` — register daemon for auto-start:
  - macOS: LaunchAgent plist in `~/Library/LaunchAgents/com.tessyn.daemon.plist`
  - Linux: systemd user service in `~/.config/systemd/user/tessyn.service`
  - Windows: shortcut in Startup folder or Task Scheduler entry
- `tessyn uninstall` — remove auto-start registration

## Testing Strategy

### Unit tests (all 5 CI targets)
- JSONL parser: all event types, malformed input, partial lines, mixed line endings, Unicode
- Checkpoint model: identity matching, incremental vs full reparse decisions
- Session discovery: slug generation, file enumeration
- Path utilities: socket paths, data dirs per platform
- Schema migrations: apply, verify structure, version tracking
- Protocol messages: serialize/deserialize, JSON-RPC compliance

### Integration tests (Linux x64, macOS ARM64, Windows x64)
- Indexer: parse fixture JSONL → SQLite → verify rows, FTS results, checkpoint state
- Watcher: create temp dir, write files, verify events fire with correct paths
- IPC: start real net.Server, connect real net.Socket, send/receive JSON-RPC
- Search: index fixtures, run FTS queries, verify ranking and filtered results
- **Checkpoint edge cases:**
  - Partial line append (write half a JSON line, then complete it)
  - File truncation (shrink file → verify full reparse triggered)
  - File replacement (different content, same path → verify full reparse)
  - Duplicate watcher events (fire same event twice → verify no duplicate rows)
  - Idempotent reindex (reindex twice → verify identical DB state)
- **Crash recovery:** kill indexer mid-transaction, restart, verify consistency

### E2E tests (Linux x64, macOS ARM64)
- Full daemon lifecycle: start → write JSONL → query via IPC → verify results → stop
- Watch-index-query pipeline: simulate Claude Code writing a conversation incrementally
- CLI commands: exercise all commands against a running daemon

### Cross-platform principles
- All tests use `TESSYN_CLAUDE_DIR` override pointing to temp directories
- Platform-specific test helpers: `getTestSocketPath()`, `describeOnPlatform()`
- JSONL fixtures include both `\n` and `\r\n` line endings
- No mocks for SQLite, file system, IPC, or watcher — all real
- Expand integration/E2E platform coverage as CI stability proves out

### What we DON'T test (by design)
- Actual Claude API calls (we test JSONL parsing, not Claude Code itself)
- GUI frontend behavior (that's the frontend's responsibility)
- Performance at scale (premature — revisit with real usage data)

## Implementation Order

1. **Phase 1** — Scaffold, platform utils, minimal daemon lifecycle, CI. Get green CI on all targets.
2. **Phase 2** — JSONL parser, checkpoint model, session discovery. Pure logic, foundational.
3. **Phase 3** — SQLite schema, migration runner, indexer. Depends on parser + checkpoint.
4. **Phase 4** — File watcher. Depends on indexer. Core pipeline complete: watch → parse → index.
5. **Phase 5** — Protocol definition, IPC server, WebSocket server. Depends on DB queries.
6. **Phase 6** — CLI client. Depends on IPC server.
7. **Phase 7** — Background mode, platform installation. Polish/stretch.

Each phase is independently testable. CI validates every phase on every target within its tier.
