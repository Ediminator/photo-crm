# Operations: Structured Logging & PII Redaction

## 1. Principles

1. **Zero Cleartext PII in Logs:** Logs must never capture customer names, email addresses, phone numbers, postal addresses, passwords, tokens, session cookies, or raw IP addresses.
2. **Structured JSON Output:** In production environments, logs are emitted as single-line JSON objects to standard output for ingestion by log collectors (Grafana Loki, Datadog, CloudWatch).
3. **End-to-End Correlation:** Every HTTP request carries or receives a unique correlation ID (`x-request-id`), passed downstream and stamped onto every log statement emitted during the request lifecycle.
4. **No Console Rule:** The ESLint rule `no-console` is strictly enforced across `src/**`. All server components, actions, and services must import and use `logger` from `@/server/log`.

---

## 2. Logger Architecture (`src/server/log.ts`)

Photo CRM standardizes on [Pino](https://getpino.io) for high-performance, asynchronous JSON logging.

```typescript
import { logger, runWithRequestId } from '@/server/log';

// Statically configured logger instance
logger.info({ userId: '01912345-...' }, 'User profile fetched');
```

### Development vs Production Mode

- **Production (`NODE_ENV=production`):** Emits structured NDJSON directly to stdout with minimal CPU overhead.
- **Development (`NODE_ENV=development`):** Streams through `pino-pretty` with timestamp translation and color-coded level badges.

---

## 3. Automated PII Redaction

Pino is configured with strict redaction paths using `fast-redact` and a replacement censor value of `'[Redacted]'`:

```typescript
export const REDACTION_PATHS = [
  '*.email',
  '*.name',
  '*.phone',
  '*.address',
  '*.password',
  '*.token',
  'authorization',
  'cookie',
  '*.ip',
  // Recursive multi-level and array wildcard expansions
  'email',
  '*.email',
  '*.*.email',
  '*[*].email',
  'name',
  '*.name',
  '*.*.name',
  '*[*].name',
  'phone',
  '*.phone',
  '*.*.phone',
  'address',
  '*.address',
  '*.*.address',
  'password',
  '*.password',
  '*.*.password',
  'token',
  '*.token',
  '*.*.token',
  'authorization',
  '*.authorization',
  '*.*.authorization',
  'cookie',
  '*.cookie',
  '*.*.cookie',
  'ip',
  '*.ip',
  '*.*.ip',
];
```

### Redaction Example

```typescript
logger.info({
  email: 'client@example.com',
  user: {
    name: 'Jane Doe',
    token: 'secret-token-xyz',
  },
  status: 'ok',
});
```

**Output:**

```json
{
  "level": 30,
  "time": 1791620000000,
  "email": "[Redacted]",
  "user": {
    "name": "[Redacted]",
    "token": "[Redacted]"
  },
  "status": "ok",
  "requestId": "01912345-6789-7abc-8def-0123456789ab",
  "msg": "..."
}
```

---

## 4. Correlation IDs (`X-Request-Id`)

Correlation IDs enable tracing an operation from the edge reverse proxy through middleware, server components, and database queries.

### Lifecycle

1. **Edge Middleware (`src/middleware.ts`):**
   - Inspects `request.headers.get('x-request-id')`.
   - If present and valid (length ≤ 128 characters), preserves the ID.
   - If absent, generates an RFC 9562 UUIDv7 via `crypto.randomUUID()`.
   - Injects `x-request-id` into downstream request headers.
   - Sets `X-Request-Id: <id>` on all responses (including redirects and error pages).
2. **Context Propagation (`AsyncLocalStorage`):**
   - Operations running inside `runWithRequestId(requestId, () => ...)` store the active correlation ID in Node's async context.
   - Pino's `mixin()` hook automatically extracts the active request ID and injects `"requestId": "<id>"` into every log message without requiring manual parameter passing.
