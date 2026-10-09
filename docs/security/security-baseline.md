# Security Baseline: Photo CRM

This document establishes the mandatory security standards and controls for the application, based on **OWASP ASVS 5.0 (Application Security Verification Standard) Level 2** and modern Next.js/TypeScript architecture.

---

## 1. Authentication & Session Management (ASVS V6, V7)

- **Authentication Engine:** Self-hosted Better-Auth with PostgreSQL/Drizzle adapter.
- **Password Policy:** Minimum 12 characters, up to 128+ characters. No restrictive character-set rules. Checked offline against common/breached password dictionaries.
- **Password Hashing:** `argon2id` with parameters: `m=65536` (64 MB), `t=3`, `p=4` (or Better-Auth recommended baseline).
- **Multi-Factor Authentication (MFA):** TOTP (RFC 6238) and WebAuthn/Passkeys. TOTP secrets encrypted at rest.
- **Cookies:** `HttpOnly`, `Secure` (production), `SameSite=Lax`, with `__Host-` or `__Secure-` prefix.
- **Session Lifecycle:** Rotated on sign-in and privilege change. Configurable idle timeout (default 7 days) and absolute timeout (30 days). Server-side invalidation and global revocation ("sign out all devices").
- **Client Portal Access:** Expiring (≤ 15 min) single-use magic links, or scoped, revocable per-project tokens stored hashed with SHA-256.

---

## 2. Access Control & Authorization (ASVS V8)

- **Default Deny:** All endpoints, server actions, and route handlers require explicit authentication and authorization unless designated in an allowlist.
- **Object-Level Scoping:** Bare IDs from client requests are never trusted. All database reads and writes must include ownership criteria:
  ```typescript
  // Example pattern in repository layer:
  await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.studioId, studioId)));
  ```
- **Insecure Direct Object Reference (IDOR) Testing:** Every resource must have automated negative integration tests verifying that unauthorized actors receive 404/denial.

---

## 3. Input Validation & Encoding (ASVS V1, V2)

- **Validation at Boundaries:** All input to server actions and route handlers must be parsed using `zod` schemas with `.strict()`. Free-text fields have strict maximum length constraints.
- **Mass Assignment Prevention:** Data objects for database insertion must be constructed explicitly from schema-validated fields; never pass spread request bodies directly into ORM mutations.
- **Sanitisation:** Any user-controlled rich text or markdown (contract templates, questionnaires) must be sanitised with DOMPurify on both input and render.
- **Anti-Automation & Rate Limiting:** All authentication, password-reset, magic link, and public inquiry endpoints must be protected by IP- and identifier-based rate limiting stored in PostgreSQL.

---

## 4. Cryptography & Secrets (ASVS V11)

- **Secrets at Rest:** Sensitive integration credentials (OAuth tokens, CalDAV passwords, TOTP secrets) must be encrypted using AES-256-GCM with keys managed through environment variables or secure key vaults.
- **Randomness:** Use `crypto.randomBytes` or `crypto.randomUUID`. Never use `Math.random` for security tokens, session identifiers, or database IDs.
- **Document Integrity:** All electronically signed contracts must store the SHA-256 hash of the sealed PDF and the signing evidence trail.

---

## 5. Security Headers & Network Security (ASVS V3, V12)

- **HTTP Headers:** Nonce-based Content Security Policy (`script-src 'self' 'nonce-...' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`), HTTP Strict Transport Security (HSTS), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.
- **SSRF Protection:** Outbound HTTP requests to user-configured endpoints (CalDAV servers, webhooks) must be validated using an SSRF-safe client that rejects private, link-local, loopback, and cloud metadata IP ranges.

---

## 6. Logging & Error Handling (ASVS V16)

- **PII-Safe Structured Logging:** Pino-based JSON logger with automatic redaction paths for `email`, `name`, `phone`, `address`, `password`, `token`, `authorization`, `cookie`, `ip`.
- **Audit Logging:** Append-only `audit_events` table for security-relevant and privacy-relevant operations (authentication, role changes, exports, deletions, signature events).
- **Error Messages:** User-facing responses must provide generic, localised error descriptions with correlation IDs. Detailed stack traces must never be exposed to clients.

---

## 7. Software Supply Chain & Licence Policy (ASVS V15)

- **Package Pinning:** Exact versions in `package.json` with a committed `pnpm-lock.yaml`.
- **Allowed Licences (AGPL-3.0 Compatible):**
  - MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0
  - AGPL-3.0, GPL-3.0, LGPL-3.0, MPL-2.0 (file-level)
  - Unlicense, CC0-1.0
- **Prohibited Licences:** Proprietary, Commercial, SSPL, BUSL, Commons Clause, GPL-2.0-only (without "or later" exception).
- **Automation:** GitHub Actions workflow pins by full 40-character commit SHA with version comments. Regular dependency updates via Dependabot/Renovate with a ≥ 3-day cooldown for non-security updates.
