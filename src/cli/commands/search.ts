import { sendRequest } from '../ipc-client.js';
import { DaemonNotRunningError } from '../../shared/errors.js';
import type { SearchResult } from '../../shared/types.js';

export async function searchCommand(
  queryParts: string[],
  options: { project?: string; role?: string; limit?: number },
): Promise<void> {
  const query = queryParts.join(' ');
  try {
    const response = await sendRequest('search', {
      query,
      projectSlug: options.project,
      role: options.role,
      limit: options.limit ?? 20,
    });

    if (response.error) {
      console.error('Error:', response.error.message);
      process.exit(1);
    }

    const { results, total } = response.result as { results: SearchResult[]; total: number };

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    console.log(`Search results for "${query}" (${total} matches):\n`);

    for (const result of results) {
      const title = result.sessionTitle ?? '(untitled)';
      const date = new Date(result.timestamp).toLocaleString();
      const preview = result.content.substring(0, 200).replace(/\n/g, ' ');

      console.log(`  [Session ${result.sessionId}] ${title} (${result.projectSlug})`);
      console.log(`  ${result.role.toUpperCase()} @ ${date}:`);
      console.log(`  ${preview}${result.content.length > 200 ? '...' : ''}`);
      console.log();
    }
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      console.log(err.message);
    } else {
      console.error('Search failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}
