import type Database from 'better-sqlite3';
import type { Session, SessionSummary, Message, SearchResult, SearchOptions, Checkpoint, SessionMeta, SessionToggles } from '../shared/types.js';

// === Session Queries ===

export function upsertSession(
  db: Database.Database,
  params: {
    provider: string;
    externalId: string;
    projectSlug: string;
    projectPath: string | null;
    jsonlPath: string;
    createdAt: number;
    updatedAt: number;
  },
): number {
  const stmt = db.prepare(`
    INSERT INTO sessions (provider, external_id, project_slug, project_path, jsonl_path, created_at, updated_at)
    VALUES (@provider, @externalId, @projectSlug, @projectPath, @jsonlPath, @createdAt, @updatedAt)
    ON CONFLICT(provider, external_id) DO UPDATE SET
      project_path = COALESCE(@projectPath, project_path),
      jsonl_path = @jsonlPath,
      updated_at = @updatedAt
    RETURNING id
  `);
  const row = stmt.get(params) as { id: number };
  return row.id;
}

export function updateSessionMeta(
  db: Database.Database,
  sessionId: number,
  params: {
    title?: string | null;
    firstPrompt?: string | null;
    messageCount?: number;
    updatedAt?: number;
    state?: 'active' | 'deleted';
  },
): void {
  const sets: string[] = [];
  const values: Record<string, unknown> = { id: sessionId };

  if (params.title !== undefined) { sets.push('title = @title'); values['title'] = params.title; }
  if (params.firstPrompt !== undefined) { sets.push('first_prompt = @firstPrompt'); values['firstPrompt'] = params.firstPrompt; }
  if (params.messageCount !== undefined) { sets.push('message_count = @messageCount'); values['messageCount'] = params.messageCount; }
  if (params.updatedAt !== undefined) { sets.push('updated_at = @updatedAt'); values['updatedAt'] = params.updatedAt; }
  if (params.state !== undefined) { sets.push('state = @state'); values['state'] = params.state; }

  if (sets.length === 0) return;

  db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = @id`).run(values);
}

export function updateSessionCheckpoint(
  db: Database.Database,
  sessionId: number,
  checkpoint: Checkpoint,
): void {
  db.prepare(`
    UPDATE sessions
    SET jsonl_byte_offset = @byteOffset, jsonl_size = @fileSize, jsonl_identity = @identity
    WHERE id = @id
  `).run({
    id: sessionId,
    byteOffset: checkpoint.byteOffset,
    fileSize: checkpoint.fileSize,
    identity: checkpoint.identity,
  });
}

export function getSessionByExternalId(
  db: Database.Database,
  provider: string,
  externalId: string,
): Session | null {
  const row = db.prepare(`
    SELECT id, provider, external_id, project_slug, project_path, title, first_prompt,
           created_at, updated_at, message_count, jsonl_path, jsonl_byte_offset,
           jsonl_size, jsonl_identity, git_branch, git_remote, state
    FROM sessions
    WHERE provider = ? AND external_id = ?
  `).get(provider, externalId) as Record<string, unknown> | undefined;

  return row ? mapSessionRow(row) : null;
}

export function getSessionById(db: Database.Database, id: number): Session | null {
  const row = db.prepare(`
    SELECT id, provider, external_id, project_slug, project_path, title, first_prompt,
           created_at, updated_at, message_count, jsonl_path, jsonl_byte_offset,
           jsonl_size, jsonl_identity, git_branch, git_remote, state
    FROM sessions WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined;

  return row ? mapSessionRow(row) : null;
}

export function listSessions(
  db: Database.Database,
  options?: {
    projectSlug?: string;
    state?: 'active' | 'deleted';
    limit?: number;
    offset?: number;
  },
): SessionSummary[] {
  let sql = `
    SELECT id, provider, external_id, project_slug, title, first_prompt,
           created_at, updated_at, message_count, state
    FROM sessions WHERE 1=1
  `;
  const params: Record<string, unknown> = {};

  if (options?.projectSlug) {
    sql += ' AND project_slug = @projectSlug';
    params['projectSlug'] = options.projectSlug;
  }
  if (options?.state) {
    sql += ' AND state = @state';
    params['state'] = options.state;
  } else {
    sql += " AND state = 'active'";
  }

  sql += ' ORDER BY updated_at DESC';

  if (options?.limit) {
    sql += ' LIMIT @limit';
    params['limit'] = options.limit;
  }
  if (options?.offset) {
    sql += ' OFFSET @offset';
    params['offset'] = options.offset;
  }

  const rows = db.prepare(sql).all(params) as Record<string, unknown>[];
  return rows.map(mapSessionSummaryRow);
}

export function getSessionCheckpoint(db: Database.Database, sessionId: number): Checkpoint | null {
  const row = db.prepare(`
    SELECT jsonl_byte_offset, jsonl_size, jsonl_identity
    FROM sessions WHERE id = ?
  `).get(sessionId) as { jsonl_byte_offset: number; jsonl_size: number; jsonl_identity: string | null } | undefined;

  if (!row) return null;
  return {
    byteOffset: row.jsonl_byte_offset,
    fileSize: row.jsonl_size,
    identity: row.jsonl_identity,
  };
}

export function findSessionByJsonlPath(db: Database.Database, jsonlPath: string): Session | null {
  const row = db.prepare(`
    SELECT id, provider, external_id, project_slug, project_path, title, first_prompt,
           created_at, updated_at, message_count, jsonl_path, jsonl_byte_offset,
           jsonl_size, jsonl_identity, git_branch, git_remote, state
    FROM sessions WHERE jsonl_path = ?
  `).get(jsonlPath) as Record<string, unknown> | undefined;

  return row ? mapSessionRow(row) : null;
}

export function getSessionCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE state = 'active'").get() as { count: number };
  return row.count;
}

export function getAllSessionJsonlPaths(db: Database.Database): string[] {
  const rows = db.prepare("SELECT jsonl_path FROM sessions WHERE state = 'active'").all() as { jsonl_path: string }[];
  return rows.map(r => r.jsonl_path);
}

// === Message Queries ===

export function insertMessages(
  db: Database.Database,
  sessionId: number,
  messages: Array<{
    role: string;
    content: string;
    toolName: string | null;
    toolInput: string | null;
    timestamp: number;
    sequence: number;
    blockType: string | null;
  }>,
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO messages (session_id, role, content, tool_name, tool_input, timestamp, sequence, block_type)
    VALUES (@sessionId, @role, @content, @toolName, @toolInput, @timestamp, @sequence, @blockType)
  `);

  const insertBatch = db.transaction((msgs: typeof messages) => {
    for (const msg of msgs) {
      stmt.run({
        sessionId,
        role: msg.role,
        content: msg.content,
        toolName: msg.toolName,
        toolInput: msg.toolInput,
        timestamp: msg.timestamp,
        sequence: msg.sequence,
        blockType: msg.blockType,
      });
    }
  });

  insertBatch(messages);
}

export function getMessages(
  db: Database.Database,
  sessionId: number,
  options?: { limit?: number; offset?: number },
): Message[] {
  let sql = `
    SELECT id, session_id, role, content, tool_name, tool_input, timestamp, sequence, block_type
    FROM messages WHERE session_id = ? ORDER BY sequence ASC
  `;
  const params: unknown[] = [sessionId];

  if (options?.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options?.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapMessageRow);
}

export function getMessageCount(db: Database.Database, sessionId: number): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?').get(sessionId) as { count: number };
  return row.count;
}

export function deleteSessionMessages(db: Database.Database, sessionId: number): void {
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
}

// === Search Queries ===

export function searchMessages(db: Database.Database, options: SearchOptions): SearchResult[] {
  let sql = `
    SELECT m.id as message_id, m.session_id, m.content, m.role, m.timestamp,
           s.title as session_title, s.project_slug,
           rank
    FROM messages_fts fts
    JOIN messages m ON m.id = fts.rowid
    JOIN sessions s ON s.id = m.session_id
    WHERE messages_fts MATCH @query
  `;
  const params: Record<string, unknown> = { query: options.query };

  if (options.projectSlug) {
    sql += ' AND s.project_slug = @projectSlug';
    params['projectSlug'] = options.projectSlug;
  }
  if (options.role) {
    sql += ' AND fts.role = @role';
    params['role'] = options.role;
  }

  sql += " AND s.state = 'active'";
  sql += ' ORDER BY rank';

  const limit = options.limit ?? 50;
  sql += ' LIMIT @limit';
  params['limit'] = limit;

  if (options.offset) {
    sql += ' OFFSET @offset';
    params['offset'] = options.offset;
  }

  const rows = db.prepare(sql).all(params) as Record<string, unknown>[];
  return rows.map((row) => ({
    sessionId: row['session_id'] as number,
    messageId: row['message_id'] as number,
    content: row['content'] as string,
    role: row['role'] as 'user' | 'assistant' | 'system',
    timestamp: row['timestamp'] as number,
    sessionTitle: row['session_title'] as string | null,
    projectSlug: row['project_slug'] as string,
    rank: row['rank'] as number,
  }));
}

// === Session Metadata (durable, survives reindex) ===

export function upsertSessionMeta(
  db: Database.Database,
  provider: string,
  externalId: string,
  fields: Partial<Omit<SessionMeta, 'provider' | 'externalId'>>,
): void {
  const now = Date.now();
  // Upsert: create if not exists, then update specified fields
  db.prepare(`
    INSERT INTO session_meta (provider, external_id, created_at, updated_at)
    VALUES (@provider, @externalId, @now, @now)
    ON CONFLICT(provider, external_id) DO UPDATE SET updated_at = @now
  `).run({ provider, externalId, now });

  const sets: string[] = ['updated_at = @now'];
  const values: Record<string, unknown> = { provider, externalId, now };

  if (fields.title !== undefined) { sets.push('title = @title'); values['title'] = fields.title; }
  if (fields.hidden !== undefined) { sets.push('hidden = @hidden'); values['hidden'] = fields.hidden ? 1 : 0; }
  if (fields.archived !== undefined) { sets.push('archived = @archived'); values['archived'] = fields.archived ? 1 : 0; }
  if (fields.autoCommit !== undefined) { sets.push('auto_commit = @autoCommit'); values['autoCommit'] = fields.autoCommit === null ? null : fields.autoCommit ? 1 : 0; }
  if (fields.autoBranch !== undefined) { sets.push('auto_branch = @autoBranch'); values['autoBranch'] = fields.autoBranch === null ? null : fields.autoBranch ? 1 : 0; }
  if (fields.autoDocument !== undefined) { sets.push('auto_document = @autoDocument'); values['autoDocument'] = fields.autoDocument === null ? null : fields.autoDocument ? 1 : 0; }
  if (fields.autoCompact !== undefined) { sets.push('auto_compact = @autoCompact'); values['autoCompact'] = fields.autoCompact === null ? null : fields.autoCompact ? 1 : 0; }
  if (fields.draft !== undefined) { sets.push('draft = @draft'); values['draft'] = fields.draft; }
  if (fields.modelOverride !== undefined) { sets.push('model_override = @modelOverride'); values['modelOverride'] = fields.modelOverride; }
  if (fields.customInstructions !== undefined) { sets.push('custom_instructions = @customInstructions'); values['customInstructions'] = fields.customInstructions; }

  if (sets.length > 1) {
    db.prepare(`
      UPDATE session_meta SET ${sets.join(', ')}
      WHERE provider = @provider AND external_id = @externalId
    `).run(values);
  }
}

export function getSessionMeta(
  db: Database.Database,
  provider: string,
  externalId: string,
): SessionMeta | null {
  const row = db.prepare(`
    SELECT provider, external_id, title, hidden, archived,
           auto_commit, auto_branch, auto_document, auto_compact,
           draft, model_override, custom_instructions, created_at, updated_at
    FROM session_meta
    WHERE provider = ? AND external_id = ?
  `).get(provider, externalId) as Record<string, unknown> | undefined;

  return row ? mapSessionMetaRow(row) : null;
}

export function getSessionToggles(
  db: Database.Database,
  provider: string,
  externalId: string,
): SessionToggles {
  const meta = getSessionMeta(db, provider, externalId);
  return {
    autoCommit: meta?.autoCommit ?? null,
    autoBranch: meta?.autoBranch ?? null,
    autoDocument: meta?.autoDocument ?? null,
    autoCompact: meta?.autoCompact ?? null,
  };
}

// === Cleanup ===

export function deleteAllData(db: Database.Database): void {
  // NOTE: session_meta is intentionally NOT deleted here.
  // It contains user-owned durable metadata that must survive reindex.
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
}

// === Row Mappers ===

function mapSessionRow(row: Record<string, unknown>): Session {
  return {
    id: row['id'] as number,
    provider: row['provider'] as string,
    externalId: row['external_id'] as string,
    projectSlug: row['project_slug'] as string,
    projectPath: row['project_path'] as string | null,
    title: row['title'] as string | null,
    firstPrompt: row['first_prompt'] as string | null,
    createdAt: row['created_at'] as number,
    updatedAt: row['updated_at'] as number,
    messageCount: row['message_count'] as number,
    jsonlPath: row['jsonl_path'] as string,
    jsonlByteOffset: row['jsonl_byte_offset'] as number,
    jsonlSize: row['jsonl_size'] as number,
    jsonlIdentity: row['jsonl_identity'] as string | null,
    gitBranch: row['git_branch'] as string | null,
    gitRemote: row['git_remote'] as string | null,
    state: row['state'] as 'active' | 'deleted',
  };
}

function mapSessionSummaryRow(row: Record<string, unknown>): SessionSummary {
  return {
    id: row['id'] as number,
    provider: row['provider'] as string,
    externalId: row['external_id'] as string,
    projectSlug: row['project_slug'] as string,
    title: row['title'] as string | null,
    firstPrompt: row['first_prompt'] as string | null,
    createdAt: row['created_at'] as number,
    updatedAt: row['updated_at'] as number,
    messageCount: row['message_count'] as number,
    state: row['state'] as 'active' | 'deleted',
  };
}

function mapMessageRow(row: Record<string, unknown>): Message {
  return {
    id: row['id'] as number,
    sessionId: row['session_id'] as number,
    role: row['role'] as 'user' | 'assistant' | 'system',
    content: row['content'] as string,
    toolName: row['tool_name'] as string | null,
    toolInput: row['tool_input'] as string | null,
    timestamp: row['timestamp'] as number,
    sequence: row['sequence'] as number,
    blockType: row['block_type'] as 'text' | 'tool_use' | 'thinking' | 'tool_result' | null,
  };
}

function intToBool(val: unknown): boolean | null {
  if (val === null || val === undefined) return null;
  return val === 1;
}

function mapSessionMetaRow(row: Record<string, unknown>): SessionMeta {
  return {
    provider: row['provider'] as string,
    externalId: row['external_id'] as string,
    title: row['title'] as string | null,
    hidden: row['hidden'] === 1,
    archived: row['archived'] === 1,
    autoCommit: intToBool(row['auto_commit']),
    autoBranch: intToBool(row['auto_branch']),
    autoDocument: intToBool(row['auto_document']),
    autoCompact: intToBool(row['auto_compact']),
    draft: row['draft'] as string | null,
    modelOverride: row['model_override'] as string | null,
    customInstructions: row['custom_instructions'] as string | null,
    createdAt: row['created_at'] as number,
    updatedAt: row['updated_at'] as number,
  };
}
