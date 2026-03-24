import Anthropic from '@anthropic-ai/sdk';
import type Database from 'better-sqlite3';
import { createLogger } from '../shared/logger.js';
import * as queries from '../db/queries.js';

const log = createLogger('titles');

const MODEL = 'claude-haiku-4-20250414';
const MAX_PROMPTS = 3;
const MAX_CHARS_PER_PROMPT = 500;
const BATCH_SIZE = 20;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * Check if the Anthropic API key is available.
 */
export function hasApiKey(): boolean {
  return !!(process.env['ANTHROPIC_API_KEY']);
}

/**
 * Generate a title for a single session based on its first user messages.
 */
export async function generateTitle(userMessages: string[]): Promise<string> {
  const snippets = userMessages
    .slice(0, MAX_PROMPTS)
    .map(m => m.substring(0, MAX_CHARS_PER_PROMPT));

  const content = snippets.join('\n---\n');

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 80,
      messages: [
        {
          role: 'user',
          content: `Generate a short, descriptive title (max 50 characters) for a coding session based on these user messages. Return ONLY the title text, no quotes, no explanation, no punctuation at the end.\n\n${content}`,
        },
      ],
    });

    const block = response.content[0];
    if (block && block.type === 'text') {
      return block.text.trim().replace(/^["']|["']$/g, ''); // Strip any quotes
    }
    return 'Untitled session';
  } catch (err) {
    log.warn('Title generation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 'Untitled session';
  }
}

/**
 * Generate titles for sessions that don't have one yet.
 * Processes in batches to avoid overwhelming the API.
 * Returns the number of titles generated.
 */
export async function generateMissingTitles(db: Database.Database, limit?: number): Promise<number> {
  if (!hasApiKey()) {
    log.info('No ANTHROPIC_API_KEY set, skipping title generation');
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

  // Process in batches
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);

    // Process each session in the batch concurrently
    const promises = batch.map(async (session) => {
      try {
        // Get first few user messages for context
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
