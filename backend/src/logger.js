/**
 * Tiny structured logger. Writes JSON lines to stdout so it plays well with
 * Docker/cloud log aggregators. Avoids external dependencies.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function write(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};

export default logger;
