import type Database from 'better-sqlite3';

export const version = 1;

export function up(db: Database.Database): void {
  db.exec(`
    -- Provider-agnostic sessions
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'claude',
      external_id TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      project_path TEXT,
      title TEXT,
      first_prompt TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      jsonl_path TEXT NOT NULL,
      jsonl_byte_offset INTEGER DEFAULT 0,
      jsonl_size INTEGER DEFAULT 0,
      jsonl_identity TEXT,
      git_branch TEXT,
      git_remote TEXT,
      state TEXT NOT NULL DEFAULT 'active',
      UNIQUE(provider, external_id)
    );

    CREATE INDEX idx_sessions_project ON sessions(project_slug);
    CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX idx_sessions_state ON sessions(state);

    -- Messages (full content preserved)
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_input TEXT,
      timestamp INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      block_type TEXT,
      UNIQUE(session_id, sequence)
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
  `);
}
