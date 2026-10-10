import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger, type LoggerOptions, type DestinationStream } from 'pino';

export interface LogContext {
  requestId?: string;
}

export const logStorage = new AsyncLocalStorage<LogContext>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return logStorage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return logStorage.getStore()?.requestId;
}

const SENSITIVE_KEYS = [
  'email',
  'name',
  'phone',
  'address',
  'password',
  'token',
  'authorization',
  'cookie',
  'ip',
] as const;

export const REDACTION_PATHS: readonly string[] = Object.freeze(
  Array.from(
    new Set([
      '*.email',
      '*.name',
      '*.phone',
      '*.address',
      '*.password',
      '*.token',
      'authorization',
      'cookie',
      '*.ip',
      ...SENSITIVE_KEYS.flatMap((key) => [
        key,
        `*.${key}`,
        `*.*.${key}`,
        `*.*.*.${key}`,
        `*.*.*.*.${key}`,
        `*[*].${key}`,
        `*.*[*].${key}`,
        `*[*].*.${key}`,
      ]),
    ]),
  ),
);

export interface CreateLoggerOptions extends LoggerOptions {
  destination?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const isDev = process.env.NODE_ENV === 'development';
  const { destination, ...customOptions } = options;

  const baseOptions: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    redact: {
      paths: [...REDACTION_PATHS],
      censor: '[Redacted]',
    },
    mixin() {
      const requestId = getRequestId();
      return requestId ? { requestId } : {};
    },
    ...customOptions,
  };

  if (destination) {
    return pino(baseOptions, destination);
  }

  return pino(baseOptions);
}

export const logger: Logger = createLogger();
