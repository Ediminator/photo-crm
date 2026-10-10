import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Writable } from 'node:stream';
import middleware from '@/middleware';
import { createLogger, runWithRequestId } from '@/server/log';

vi.mock('server-only', () => ({}));

describe('AC-7: Request Correlation ID and X-Request-Id Header', () => {
  function captureLoggerStream(): {
    stream: Writable;
    getLines: () => Record<string, unknown>[];
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
      getLines: () =>
        output
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  }

  it('AC-7: middleware generates X-Request-Id when request has no x-request-id header', () => {
    const request = new NextRequest('http://localhost:3000/en/setup');
    const response = middleware(request);

    const requestId = response.headers.get('X-Request-Id');
    expect(requestId).toBeDefined();
    expect(requestId).not.toBeNull();
    // Must be valid non-empty string / UUID format
    expect(requestId?.length).toBeGreaterThanOrEqual(16);
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe(requestId);
  });

  it('AC-7: middleware propagates incoming x-request-id to response and request headers', () => {
    const customCorrelationId = 'corr-client-test-7890-abcdef';
    const request = new NextRequest('http://localhost:3000/en/setup', {
      headers: {
        'x-request-id': customCorrelationId,
      },
    });

    const response = middleware(request);
    expect(response.headers.get('X-Request-Id')).toBe(customCorrelationId);
    expect(response.headers.get('x-middleware-request-x-request-id')).toBe(customCorrelationId);
  });

  it('AC-7: middleware preserves correlation ID on unauthenticated redirect response', () => {
    const customCorrelationId = 'corr-redirect-12345';
    const request = new NextRequest('http://localhost:3000/en', {
      headers: {
        'x-request-id': customCorrelationId,
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get('X-Request-Id')).toBe(customCorrelationId);
  });

  it('AC-7: every log line emitted during request lifecycle shares the same correlation ID matching X-Request-Id', () => {
    const { stream, getLines } = captureLoggerStream();
    const logger = createLogger({ destination: stream, level: 'info' });

    // 1. Simulate incoming HTTP request handled by middleware
    const request = new NextRequest('http://localhost:3000/en/setup');
    const response = middleware(request);
    const correlationId = response.headers.get('X-Request-Id');
    expect(correlationId).toBeDefined();
    if (!correlationId) {
      throw new Error('Expected X-Request-Id header');
    }

    // 2. Simulate server execution of the request inside the correlation ID context
    runWithRequestId(correlationId, () => {
      logger.info({ step: 'request_received' }, 'Handling incoming request');
      logger.info({ step: 'auth_check' }, 'Verifying authorization state');
      logger.info({ step: 'response_sent' }, 'Rendering response');
    });

    // 3. Verify all log lines share the identical correlation ID matching X-Request-Id
    const lines = getLines();
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      expect(line.requestId).toBe(correlationId);
    }

    expect(lines[0]?.step).toBe('request_received');
    expect(lines[1]?.step).toBe('auth_check');
    expect(lines[2]?.step).toBe('response_sent');
  });

  it('I1-S04: rejects malformed or malicious x-request-id characters and falls back to crypto.randomUUID()', () => {
    const maliciousInputs = [
      '<script>alert(1)</script>',
      'req-id-with spaces',
      'req-id/injection',
      'req-id@domain',
      '../../etc/passwd',
      'req-id-with;semi=colon',
      'a'.repeat(129), // exceeds 128 characters
    ];

    for (const badInput of maliciousInputs) {
      const request = new NextRequest('http://localhost:3000/en/setup', {
        headers: { 'x-request-id': badInput },
      });
      const response = middleware(request);
      const generatedId = response.headers.get('X-Request-Id');

      expect(generatedId).not.toBe(badInput);
      expect(generatedId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });

  it('I1-S04: accepts valid correlation ID conforming to /^[a-zA-Z0-9_\\-.]{1,128}$/', () => {
    const validInput = 'req.abc-123_XYZ.456';
    const request = new NextRequest('http://localhost:3000/en/setup', {
      headers: { 'x-request-id': validInput },
    });
    const response = middleware(request);
    expect(response.headers.get('X-Request-Id')).toBe(validInput);
  });
});
