import { sendRequest } from '../ipc-client.js';
import { DaemonNotRunningError } from '../../shared/errors.js';
import type { DaemonStatus } from '../../shared/types.js';

export async function statusCommand(): Promise<void> {
  try {
    const response = await sendRequest('status');
    if (response.error) {
      console.error('Error:', response.error.message);
      process.exit(1);
    }

    const status = response.result as DaemonStatus;
    console.log(`Tessyn daemon status:`);
    console.log(`  State:    ${status.state}`);
    console.log(`  Sessions: ${status.sessionsIndexed} indexed`);
    console.log(`  Uptime:   ${formatUptime(status.uptime)}`);
    console.log(`  Version:  ${status.version}`);

    if (status.state === 'scanning') {
      console.log(`\n  ⚠ Indexing in progress (${status.sessionsIndexed}/${status.sessionsTotal})`);
    }
  } catch (err) {
    if (err instanceof DaemonNotRunningError) {
      console.log(err.message);
    } else {
      console.error('Failed to get status:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
