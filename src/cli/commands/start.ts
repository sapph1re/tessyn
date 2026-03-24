import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDaemonRunning } from '../../daemon/lifecycle.js';

export async function startCommand(options: { daemon?: boolean }): Promise<void> {
  // Check if already running
  const running = await isDaemonRunning();
  if (running) {
    console.log('Tessyn daemon is already running.');
    return;
  }

  if (options.daemon) {
    // Background mode: spawn detached process
    const daemonScript = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../daemon/index.js',
    );

    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });

    child.unref();
    console.log(`Tessyn daemon started in background (PID: ${child.pid})`);
  } else {
    // Foreground mode: start the daemon in this process
    console.log('Starting Tessyn daemon (foreground)...');
    const { startDaemon } = await import('../../daemon/index.js');
    await startDaemon();
  }
}
