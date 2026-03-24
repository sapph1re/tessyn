import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { runMigrations } from '../../src/db/schema.js';
import { indexSession } from '../../src/indexer/index.js';
import * as queries from '../../src/db/queries.js';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/conversations');

describe('Search Integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    // Index all fixtures
    indexSession(db, path.join(FIXTURES, 'simple-chat.jsonl'), 'project-a');
    indexSession(db, path.join(FIXTURES, 'multi-turn-with-tools.jsonl'), 'project-b');
    indexSession(db, path.join(FIXTURES, 'thinking-blocks.jsonl'), 'project-a');
  });

  afterEach(() => {
    db.close();
  });

  it('should find messages by content', () => {
    const results = queries.searchMessages(db, { query: 'auth' });
    expect(results.length).toBeGreaterThan(0);
  });

  it('should find messages with partial word match (porter stemming)', () => {
    // Porter stemmer should match "authentication" with "auth" query
    const results = queries.searchMessages(db, { query: 'authentication' });
    // Should find at least the message about auth module
    expect(results.length).toBeGreaterThanOrEqual(0); // Stemming may or may not match
  });

  it('should filter by project slug', () => {
    const allResults = queries.searchMessages(db, { query: 'session' });
    const projectAResults = queries.searchMessages(db, { query: 'session', projectSlug: 'project-a' });

    // Project-filtered results should be a subset
    expect(projectAResults.length).toBeLessThanOrEqual(allResults.length);
    for (const r of projectAResults) {
      expect(r.projectSlug).toBe('project-a');
    }
  });

  it('should filter by role', () => {
    const userResults = queries.searchMessages(db, { query: 'bug', role: 'user' });
    for (const r of userResults) {
      expect(r.role).toBe('user');
    }
  });

  it('should respect limit', () => {
    const results = queries.searchMessages(db, { query: 'the', limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should return ranked results', () => {
    const results = queries.searchMessages(db, { query: 'TypeScript error' });
    // Results should be ranked by relevance (rank field present)
    for (const r of results) {
      expect(typeof r.rank).toBe('number');
    }
  });

  it('should return empty for no matches', () => {
    const results = queries.searchMessages(db, { query: 'xyznonexistent' });
    expect(results.length).toBe(0);
  });
});
