import { createLogger } from '../shared/logger.js';

const log = createLogger('signals');

type ShutdownHandler = () => Promise<void> | void;

const handlers: ShutdownHandler[] = [];
let shutdownInProgress = false;

/**
 * Register a handler to be called during graceful shutdown.
 * Handlers are called in reverse order of registration (LIFO).
 */
export function onShutdown(handler: ShutdownHandler): void {
  handlers.push(handler);
}

/**
 * Execute all shutdown handlers and exit.
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInProgress) {
    log.warn('Shutdown already in progress, forcing exit');
    process.exit(1);
  }
  shutdownInProgress = true;

  log.info(`Received ${signal}, shutting down gracefully...`);

  // Call handlers in reverse order (LIFO)
  for (let i = handlers.length - 1; i >= 0; i--) {
    try {
      await handlers[i]!();
    } catch (err) {
      log.error('Shutdown handler failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info('Shutdown complete');
  process.exit(0);
}

/**
 * Install cross-platform signal handlers for graceful shutdown.
 * Call once at daemon startup.
 */
export function installSignalHandlers(): void {
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  // Windows: handle the 'shutdown' message if running as a child process
  if (process.platform === 'win32') {
    process.on('message', (msg) => {
      if (msg === 'shutdown') {
        void gracefulShutdown('message:shutdown');
      }
    });
  }

  // Prevent unhandled rejections from crashing the daemon
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', { error: err.message, stack: err.stack });
    void gracefulShutdown('uncaughtException');
  });
}

/**
 * Check if shutdown is in progress.
 */
export function isShuttingDown(): boolean {
  return shutdownInProgress;
}

/**
 * Reset shutdown state (for testing only).
 */
export function _resetShutdownState(): void {
  shutdownInProgress = false;
  handlers.length = 0;
}
