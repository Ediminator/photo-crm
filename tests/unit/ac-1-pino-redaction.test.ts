import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, runWithRequestId, getRequestId, REDACTION_PATHS } from '@/server/log';

vi.mock('server-only', () => ({}));

describe('AC-1: Structured Logger and PII Redaction', () => {
  function captureLoggerStream(): {
    stream: Writable;
    getLines: () => Record<string, unknown>[];
    getRawOutput: () => string;
  } {
    let output = '';
    const stream = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });

    return {
      stream,
      getRawOutput: () => output,
      getLines: () =>
        output
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  }

  it('AC-1: redaction paths cover all mandatory PII fields', () => {
    const required = [
      '*.email',
      '*.name',
      '*.phone',
      '*.address',
      '*.password',
      '*.token',
      'authorization',
      'cookie',
      '*.ip',
    ];

    for (const path of required) {
      expect(REDACTION_PATHS).toContain(path);
    }
  });

  it('AC-1: replaces email, name, token, authorization with [Redacted] at top level and nested depths', () => {
    const { stream, getLines, getRawOutput } = captureLoggerStream();
    const testLogger = createLogger({ destination: stream, level: 'info' });

    testLogger.info(
      {
        email: 'photographer@example.com',
        name: 'Jane Doe',
        token: 'secret-token-xyz123',
        authorization: 'Bearer auth-bearer-token',
        nested: {
          email: 'client@example.org',
          name: 'John Smith',
          token: 'sub-token-789',
          phone: '+49 30 0000000',
          address: 'Musterstrasse 1, 10115 Berlin',
          password: 'super-secret-password-123',
          cookie: 'session=abcde',
          ip: '192.168.1.1',
          deep: {
            email: 'deep@example.com',
            token: 'deep-token-value',
            authorization: 'Basic dXNlcjpwYXNz',
          },
        },
        items: [
          {
            email: 'arr1@example.com',
            name: 'Array Person',
          },
        ],
      },
      'PII log event',
    );

    const raw = getRawOutput();
    // Verify no raw PII strings leaked in output
    expect(raw).not.toContain('photographer@example.com');
    expect(raw).not.toContain('Jane Doe');
    expect(raw).not.toContain('secret-token-xyz123');
    expect(raw).not.toContain('Bearer auth-bearer-token');
    expect(raw).not.toContain('client@example.org');
    expect(raw).not.toContain('John Smith');
    expect(raw).not.toContain('+49 30 0000000');
    expect(raw).not.toContain('Musterstrasse 1');
    expect(raw).not.toContain('super-secret-password-123');
    expect(raw).not.toContain('deep@example.com');
    expect(raw).not.toContain('deep-token-value');
    expect(raw).not.toContain('arr1@example.com');

    // Verify structured json parsed values
    const lines = getLines();
    expect(lines).toHaveLength(1);
    const logObj = lines[0];
    expect(logObj).toBeDefined();

    expect(logObj?.email).toBe('[Redacted]');
    expect(logObj?.name).toBe('[Redacted]');
    expect(logObj?.token).toBe('[Redacted]');
    expect(logObj?.authorization).toBe('[Redacted]');

    const nested = logObj?.nested as Record<string, unknown>;
    expect(nested).toBeDefined();
    expect(nested.email).toBe('[Redacted]');
    expect(nested.name).toBe('[Redacted]');
    expect(nested.token).toBe('[Redacted]');
    expect(nested.phone).toBe('[Redacted]');
    expect(nested.address).toBe('[Redacted]');
    expect(nested.password).toBe('[Redacted]');
    expect(nested.cookie).toBe('[Redacted]');
    expect(nested.ip).toBe('[Redacted]');

    const deep = nested.deep as Record<string, unknown>;
    expect(deep).toBeDefined();
    expect(deep.email).toBe('[Redacted]');
    expect(deep.token).toBe('[Redacted]');
    expect(deep.authorization).toBe('[Redacted]');

    const items = logObj?.items as Record<string, unknown>[];
    expect(items[0]?.email).toBe('[Redacted]');
    expect(items[0]?.name).toBe('[Redacted]');
  });

  it('AC-1: attaches correlation ID automatically when executed in runWithRequestId context', () => {
    const { stream, getLines } = captureLoggerStream();
    const testLogger = createLogger({ destination: stream, level: 'info' });

    expect(getRequestId()).toBeUndefined();

    runWithRequestId('req-test-uuid-456', () => {
      expect(getRequestId()).toBe('req-test-uuid-456');
      testLogger.info({ event: 'test-event' }, 'Message in correlation context');
    });

    const lines = getLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.requestId).toBe('req-test-uuid-456');
    expect(lines[0]?.event).toBe('test-event');
  });

  it('AC-1: creates default logger instance and handles non-nested messages safely', () => {
    const { stream, getLines } = captureLoggerStream();
    const testLogger = createLogger({ destination: stream, level: 'debug' });

    testLogger.debug('Simple debug message');
    const lines = getLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.msg).toBe('Simple debug message');
    expect(lines[0]?.level).toBe(20);
  });
});
