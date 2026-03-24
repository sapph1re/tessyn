import { sendRequest } from '../ipc-client.js';
import { DaemonNotRunningError } from '../../shared/errors.js';

export async function stopCommand(): Promise<void> {
  try {
    await sendRequest('shutdown');
    console.log('Tessyn daemon is shutting down.');
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      console.log(err.message);
    } else {
      console.error('Failed to stop daemon:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}
