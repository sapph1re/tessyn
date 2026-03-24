import { sendRequest } from '../ipc-client.js';
import { DaemonNotRunningError } from '../../shared/errors.js';

export async function reindexCommand(): Promise<void> {
  try {
    console.log('Triggering full reindex...');
    const response = await sendRequest('reindex', undefined, undefined, 60000);

    if (response.error) {
      console.error('Error:', response.error.message);
      process.exit(1);
    }

    const result = response.result as { indexed: number; total: number };
    console.log(`Reindex complete: ${result.indexed} sessions updated out of ${result.total} total.`);
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      console.log(err.message);
    } else {
      console.error('Reindex failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}
