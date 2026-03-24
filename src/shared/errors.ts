export class TessynError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'TessynError';
  }
}

export class DaemonAlreadyRunningError extends TessynError {
  constructor() {
    super('Tessyn daemon is already running', 'DAEMON_ALREADY_RUNNING');
    this.name = 'DaemonAlreadyRunningError';
  }
}

export class DaemonNotRunningError extends TessynError {
  constructor() {
    super('Tessyn daemon is not running. Start it with: tessyn start', 'DAEMON_NOT_RUNNING');
    this.name = 'DaemonNotRunningError';
  }
}

export class SessionNotFoundError extends TessynError {
  constructor(id: string | number) {
    super(`Session not found: ${id}`, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundError';
  }
}

export class MigrationError extends TessynError {
  constructor(version: number, cause: unknown) {
    super(`Migration ${version} failed: ${cause instanceof Error ? cause.message : String(cause)}`, 'MIGRATION_FAILED');
    this.name = 'MigrationError';
  }
}
