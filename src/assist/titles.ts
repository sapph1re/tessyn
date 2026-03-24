import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import * as queries from '../db/queries.js';

const log = createLogger('titles');

const execFileAsync = promisify(execFile);

const MAX_PROMPTS = 3;
const MAX_CHARS_PER_PROMPT = 500;
const BATCH_SIZE = 5; // Lower concurrency — each spawns a Claude process

/**
 * Check if `claude` CLI is available on the system.
 */
export async function isClaudeAvailable(): Promise<boolean> {
  try {
    await execFileAsync('claude', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a title for a session using `claude -p` (uses the user's subscription).
 */
export async function generateTitle(userMessages: string[]): Promise<string> {
  const snippets = userMessages
    .slice(0, MAX_PROMPTS)
    .map(m => m.substring(0, MAX_CHARS_PER_PROMPT));

  const content = snippets.join('\n---\n');
  const prompt = `Generate a short, descriptive title (max 50 characters) for a coding session based on these user messages. Return ONLY the title text, no quotes, no explanation, no punctuation at the end.\n\n${content}`;

  try {
    const { stdout } = await execFileAsync('claude', [
      '-p', prompt,
      '--model', 'haiku',
      '--output-format', 'text',
      '--no-session-persistence',
      '--max-turns', '1',
    ], {
      timeout: 30000,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'tessyn' },
    });

    const title = stdout.trim().replace(/^["']|["']$/g, '');
    return title || 'Untitled session';
  } catch (err) {
    log.warn('Title generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 'Untitled session';
  }
}

/**
 * Generate titles for sessions that don't have one yet.
 * Uses `claude -p` which goes through the user's Claude Code subscription.
 * Returns the number of titles generated.
 */
export async function generateMissingTitles(db: Database.Database, limit?: number): Promise<number> {
  const available = await isClaudeAvailable();
  if (!available) {
    log.info('Claude CLI not available, skipping title generation');
    return 0;
  }

  // Find sessions without titles
  const sessions = db.prepare(`
    SELECT id, first_prompt FROM sessions
    WHERE title IS NULL AND state = 'active' AND first_prompt IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit ?? 50) as Array<{ id: number; first_prompt: string }>;

  if (sessions.length === 0) {
    return 0;
  }

  log.info(`Generating titles for ${sessions.length} sessions`);

  let generated = 0;

  // Process in small batches (each spawns a claude process)
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (session) => {
      try {
        const messages = db.prepare(`
          SELECT content FROM messages
          WHERE session_id = ? AND role = 'user'
          ORDER BY sequence ASC
          LIMIT ?
        `).all(session.id, MAX_PROMPTS) as Array<{ content: string }>;

        const userTexts = messages.length > 0
          ? messages.map(m => m.content)
          : [session.first_prompt];

        const title = await generateTitle(userTexts);

        if (title !== 'Untitled session') {
          queries.updateSessionMeta(db, session.id, { title });
          log.debug('Generated title', { sessionId: session.id, title });
          return true;
        }
        return false;
      } catch (err) {
        log.warn('Failed to generate title for session', {
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    });

    const results = await Promise.all(promises);
    generated += results.filter(Boolean).length;
  }

  log.info(`Generated ${generated} titles`);
  return generated;
}
