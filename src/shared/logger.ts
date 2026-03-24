export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level]! >= LOG_LEVELS[currentLevel]!;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): string {
  const parts = [`[${formatTimestamp()}] [${level.toUpperCase()}] [${component}] ${message}`];
  if (data && Object.keys(data).length > 0) {
    parts.push(` ${JSON.stringify(data)}`);
  }
  return parts.join('');
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(component: string): Logger {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', component, message, data));
      }
    },
    info(message: string, data?: Record<string, unknown>) {
      if (shouldLog('info')) {
        console.log(formatMessage('info', component, message, data));
      }
    },
    warn(message: string, data?: Record<string, unknown>) {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', component, message, data));
      }
    },
    error(message: string, data?: Record<string, unknown>) {
      if (shouldLog('error')) {
        console.error(formatMessage('error', component, message, data));
      }
    },
  };
}
