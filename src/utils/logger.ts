export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env.PIPELINE_LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatEntry(level: LogLevel, message: string, data?: Record<string, unknown>) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  });
}

export const logger = {
  setLevel(level: LogLevel) {
    currentLevel = level;
  },

  debug(message: string, data?: Record<string, unknown>) {
    if (shouldLog('debug')) console.error(formatEntry('debug', message, data));
  },

  info(message: string, data?: Record<string, unknown>) {
    if (shouldLog('info')) console.error(formatEntry('info', message, data));
  },

  warn(message: string, data?: Record<string, unknown>) {
    if (shouldLog('warn')) console.error(formatEntry('warn', message, data));
  },

  error(message: string, data?: Record<string, unknown>) {
    if (shouldLog('error')) console.error(formatEntry('error', message, data));
  },
};
