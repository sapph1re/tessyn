# Database Schema

SQLite with WAL mode, FTS5 for full-text search. All timestamps are Unix epoch milliseconds (INTEGER).

## Tables

### schema_version

Tracks applied migrations. Simple integer versioning.

```sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL  -- Unix epoch ms
);
```

### sessions

Provider-agnostic session records. One row per JSONL file.

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'claude',
  external_id TEXT NOT NULL,          -- provider's session UUID (from filename or JSONL content)
  project_slug TEXT NOT NULL,         -- directory name under ~/.claude/projects/
  project_path TEXT,                  -- original working directory (null if unknown)
  title TEXT,                         -- generated via claude CLI or user-assigned
  first_prompt TEXT,                  -- first user message, truncated to 500 chars
  created_at INTEGER NOT NULL,        -- Unix epoch ms
  updated_at INTEGER NOT NULL,        -- Unix epoch ms
  message_count INTEGER DEFAULT 0,
  jsonl_path TEXT NOT NULL,           -- absolute path to source JSONL file
  jsonl_byte_offset INTEGER DEFAULT 0, -- last fully parsed byte position
  jsonl_size INTEGER DEFAULT 0,       -- file size at last parse
  jsonl_identity TEXT,                -- SHA-256 hash of first 1KB (replacement detection)
  git_branch TEXT,
  git_remote TEXT,
  state TEXT NOT NULL DEFAULT 'active', -- active | deleted
  UNIQUE(provider, external_id)
);

CREATE INDEX idx_sessions_project ON sessions(project_slug);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_state ON sessions(state);
```

**Key design decisions:**
- `UNIQUE(provider, external_id)` — prevents duplicates across providers. Internal `id` is an autoincrement surrogate key (stable across reindexes within a session, but NOT across full reindexes — use `external_id` for durable references).
- `jsonl_byte_offset` + `jsonl_size` + `jsonl_identity` — the checkpoint model for incremental indexing.
- `state = 'deleted'` instead of row deletion — the file may reappear (e.g., restored from backup).

### messages

Individual message blocks extracted from JSONL. One assistant response with multiple content blocks produces multiple rows.

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,               -- user | assistant | system
  content TEXT NOT NULL,            -- full text content
  tool_name TEXT,                   -- for tool_use blocks (e.g., "Read", "Edit", "Bash")
  tool_input TEXT,                  -- JSON string of tool input parameters
  timestamp INTEGER NOT NULL,       -- Unix epoch ms
  sequence INTEGER NOT NULL,        -- JSONL source line number (stable, idempotent)
  block_type TEXT,                  -- text | tool_use | thinking | tool_result
  UNIQUE(session_id, sequence)      -- dedupe key: INSERT OR REPLACE is idempotent
);

CREATE INDEX idx_messages_session ON messages(session_id, sequence);
```

**Key design decisions:**
- `sequence` is the JSONL line number, not a counter. This makes it stable across re-reads and crash-safe (no duplicate rows on replay).
- `UNIQUE(session_id, sequence)` + `INSERT OR REPLACE` = idempotent upserts.
- `ON DELETE CASCADE` — deleting a session cleans up its messages automatically.

### messages_fts (FTS5)

Full-text search index. Content-sync'd with the `messages` table via triggers.

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,                    -- searchable text
  session_id UNINDEXED,       -- for filtered queries (not tokenized)
  role UNINDEXED,             -- for filtered queries (not tokenized)
  content=messages,           -- content-sync with messages table
  content_rowid=id,
  tokenize='porter unicode61' -- porter stemming + unicode support
);
```

Kept in sync by `AFTER INSERT/DELETE/UPDATE` triggers on `messages`.

## Migrations

Each migration is a TypeScript function in `src/db/migrations/`. The migration runner:
1. Reads current version from `schema_version`
2. Runs pending migrations in order, each in its own transaction
3. Migration failures are fatal (daemon exits rather than serving stale schema)

Escape hatch: `tessyn reindex` drops all data and rebuilds from JSONL.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TESSYN_DB_PATH` | `<data_dir>/tessyn.db` | SQLite database path |
| `TESSYN_DATA_DIR` | Platform-appropriate | Parent directory for DB and other data |

Data directory locations:
- macOS: `~/Library/Application Support/tessyn/`
- Linux: `~/.local/share/tessyn/`
- Windows: `%LOCALAPPDATA%\tessyn\Data\`
