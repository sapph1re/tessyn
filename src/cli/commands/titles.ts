import { sendRequest } from '../ipc-client.js';
import { DaemonNotRunningError } from '../../shared/errors.js';

export async function titlesCommand(options: { limit?: number }): Promise<void> {
  try {
    console.log('Generating titles for untitled sessions...');
    const response = await sendRequest('titles.generate', {
      limit: options.limit ?? 50,
    }, undefined, 60000); // 60s timeout — title gen can be slow

    if (response.error) {
      console.error('Error:', response.error.message);
      process.exit(1);
    }

    const result = response.result as { generated: number };
    if (result.generated === 0) {
      console.log('All sessions already have titles (or no API key set).');
    } else {
      console.log(`Generated ${result.generated} title(s).`);
    }
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      console.log(err.message);
    } else {
      console.error('Title generation failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}
