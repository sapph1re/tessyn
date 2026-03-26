import { sendRequest } from '../ipc-client.js';
import { DaemonNotRunningError } from '../../shared/errors.js';
import type { SessionSummary, Message } from '../../shared/types.js';

export async function listSessionsCommand(options: {
  project?: string;
  limit?: number;
}): Promise<void> {
  try {
    const response = await sendRequest('sessions.list', {
      projectSlug: options.project,
      limit: options.limit ?? 20,
    });

    if (response.error) {
      console.error('Error:', response.error.message);
      process.exit(1);
    }

    const { sessions } = response.result as { sessions: SessionSummary[] };

    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }

    console.log(`Sessions (${sessions.length}):\n`);
    for (const session of sessions) {
      const title = session.title ?? session.firstPrompt?.substring(0, 60) ?? '(untitled)';
      const date = new Date(session.updatedAt).toLocaleString();
      console.log(`  [${session.id}] ${title}`);
      console.log(`       Project: ${session.projectSlug}  Messages: ${session.messageCount}  Updated: ${date}`);
      console.log();
    }
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      console.log(err.message);
    } else {
      console.error('Failed to list sessions:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}

export async function showSessionCommand(
  id: string,
  options?: { limit?: number },
): Promise<void> {
  try {
    const sessionId = parseInt(id, 10);
    if (isNaN(sessionId)) {
      console.error('Invalid session ID. Must be a number.');
      process.exit(1);
    }

    const response = await sendRequest('sessions.get', {
      id: sessionId,
      limit: options?.limit,
    });

    if (response.error) {
      console.error('Error:', response.error.message);
      process.exit(1);
    }

    const { session, messages } = response.result as {
      session: SessionSummary;
      messages: Message[];
    };

    const title = session.title ?? session.firstPrompt?.substring(0, 60) ?? '(untitled)';
    console.log(`Session: ${title}`);
    console.log(`Project: ${session.projectSlug}`);
    console.log(`Messages: ${session.messageCount}`);
    console.log(`---\n`);

    for (const msg of messages) {
      const roleLabel = msg.role.toUpperCase();
      const time = new Date(msg.timestamp).toLocaleTimeString();

      if (msg.blockType === 'tool_use') {
        console.log(`  [${time}] ${roleLabel}: ${msg.content}`);
      } else if (msg.blockType === 'thinking') {
        console.log(`  [${time}] ${roleLabel} (thinking): ${msg.content.substring(0, 200)}...`);
      } else {
        console.log(`  [${time}] ${roleLabel}: ${msg.content}`);
      }
    }
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      console.log(err.message);
    } else {
      console.error('Failed to show session:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}
