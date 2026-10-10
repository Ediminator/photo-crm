# Threat Model: Ownlight

This threat model identifies key assets, trust boundaries, threat actors, and STRIDE mitigations for the single-studio self-hosted CRM system.

---

## 1. System Assets

| Asset ID | Asset Name                      | Description                                                                                      | Sensitivity      |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------- |
| **A-1**  | Client Personal Data            | Names, emails, phones, addresses, shoot dates, relationship history                              | High (GDPR/CCPA) |
| **A-2**  | Client Imagery & Videos         | Raw and derivative photos/videos, including family photos and photos of minors                   | Critical         |
| **A-3**  | Legal Contracts & Signatures    | Signed agreements, financial terms, simple electronic signature audit trails                     | High             |
| **A-4**  | Studio Owner Credentials        | Admin password hashes, TOTP secrets, WebAuthn credentials, session tokens                        | Critical         |
| **A-5**  | Third-Party Integration Secrets | SMTP passwords, Google OAuth refresh tokens, CalDAV credentials, S3 API keys, Lexware API tokens | Critical         |
| **A-6**  | Invoices & Accounting Records   | Financial vouchers subject to GoBD / §14 UStG, sealed in Lexware and referenced in CRM           | High             |
| **A-7**  | Scoped Agent API Tokens         | Bearer keys (`ownlight_live_...`) authorizing CLI automation and MCP agent tools                 | Critical         |

---

## 2. Threat Actors & Capabilities

1. **Unauthenticated Internet Attacker:** Accesses public inquiry forms, client portal magic links, or login pages. Attempts credential stuffing, brute force, spamming, and SSRF.
2. **Untrusted/Malicious Client:** Authorized to view their own project portal. Attempts IDOR to access other clients' galleries, contracts, or personal info.
3. **Compromised Dependency / Supply Chain:** Malicious npm package attempting code execution or secret exfiltration.
4. **Network Eavesdropper:** Snoops unencrypted traffic on local or public networks.
5. **Rogue / Misconfigured AI Agent:** Agent running runaway loops, hallucinating arguments, or attempting unauthorized bulk reads/updates over CLI or MCP interfaces.

---

## 3. Trust Boundaries

```text
[ Browser: Public / Internet ]
              │ (HTTPS / TLS 1.3)
      [ Caddy Reverse Proxy ]
              │ (Internal Docker Network)
      [ Next.js App Server ] ◄────── (stdio / HTTP) ────── [ CLI / MCP Agent Server ]
         │               │
  (PostgreSQL)      (S3 Storage / MinIO)
         │
         └──────── (HTTPS) ────────► [ Lexware Office API / Webhooks ]
```

1. **Boundary 1: Internet to Public Endpoints** (Inquiry form, health check, login, portal links)
2. **Boundary 2: Authenticated Client vs. Studio Owner** (Portal routes vs. Studio Admin routes)
3. **Boundary 3: App Server to Database & S3 Storage** (Internal private Docker network)
4. **Boundary 4: App Server to External Third Parties** (SMTP server, Google Calendar, CalDAV)
5. **Boundary 5: App Server / MCP Server to AI Agents & CLI** (stdio local process or token-authenticated SSE/HTTP)
6. **Boundary 6: App Server to Lexware Office REST API & Webhooks** (Encrypted token outbound, signed webhook inbound)

---

## 4. STRIDE Threat Analysis & Mitigations

### Spoofing

- **Threat:** Attacker spoofs studio owner, claims initial instance setup, or forges agent token.
- **Mitigation:** Setup token required for initial instance bootstrap (`SETUP_TOKEN`); argon2id password hashing; mandatory MFA (TOTP RFC 6238 with code replay prevention & WebAuthn/Passkeys with challenge expiration and signature counter verification); constant-time token comparison; SHA-256 hashed API keys with required scopes; re-authentication step-up (≤ 5 min freshness) for sensitive MFA management.

### Tampering

- **Threat:** Client, attacker, or rogue agent modifies signed contract, issued invoice, or audit records.
- **Mitigation:** Append-only audit logs with DB triggers preventing UPDATE/DELETE; SHA-256 document hashing of signed PDFs; parameterized queries via Drizzle ORM; Lexware Office immutable voucher locking; webhook HMAC signature verification.

### Repudiation

- **Threat:** Client disputes contract signature or owner disputes agent-initiated actions.
- **Mitigation:** E-signature audit trail recording document hash, timestamp, signer IP, and user agent; immutable agent audit logging with `actor_type: 'agent'`, `token_id`, `tool_name`, and arguments hash.

### Information Disclosure

- **Threat:** Attacker enumerates accounts, reads other clients' galleries (IDOR), steals credentials from logs, or LLM agent exposes client PII.
- **Mitigation:** Object-level authorization checks; generic error messages; automatic log redaction of PII; private S3 buckets with short-lived pre-signed URLs; EXIF/GPS stripping; PII masking by default in CLI/MCP outputs; strict data minimization when syncing to Lexware Office; AES-256-GCM field encryption at rest for TOTP secrets; scrypt-hashed single-use recovery codes.

### Denial of Service

- **Threat:** Attacker spams inquiry forms, uploads huge files, or an agent enters an infinite loop.
- **Mitigation:** Database-backed rate limiting per IP and per API token; honeypot fields; proof-of-work bot protection; server-side file size and magic-byte checks; streaming uploads; agent token rate limiting.

### Elevation of Privilege

- **Threat:** Client portal user escalates to studio admin privileges, or an agent with read scope executes write actions.
- **Mitigation:** Strict server-side route guards (`requireOwner()`, `requireAuth({ scopes })`); granular API token permission enforcement (e.g. `clients:read` cannot invoke `clients:write` or `lexware:sync`); separate portal token authorization context.
