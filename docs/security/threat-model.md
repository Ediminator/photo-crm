# Threat Model: Photo CRM

This threat model identifies key assets, trust boundaries, threat actors, and STRIDE mitigations for the single-studio self-hosted CRM system.

---

## 1. System Assets

| Asset ID | Asset Name | Description | Sensitivity |
| --- | --- | --- | --- |
| **A-1** | Client Personal Data | Names, emails, phones, addresses, shoot dates, relationship history | High (GDPR/CCPA) |
| **A-2** | Client Imagery & Videos | Raw and derivative photos/videos, including family photos and photos of minors | Critical |
| **A-3** | Legal Contracts & Signatures | Signed agreements, financial terms, simple electronic signature audit trails | High |
| **A-4** | Studio Owner Credentials | Admin password hashes, TOTP secrets, WebAuthn credentials, session tokens | Critical |
| **A-5** | Third-Party Integration Secrets | SMTP passwords, Google OAuth refresh tokens, CalDAV credentials, S3 API keys | Critical |
| **A-6** | Invoices & Accounting Records | Post-MVP financial vouchers subject to GoBD / §14 UStG | High |

---

## 2. Threat Actors & Capabilities

1. **Unauthenticated Internet Attacker:** Accesses public inquiry forms, client portal magic links, or login pages. Attempts credential stuffing, brute force, spamming, and SSRF.
2. **Untrusted/Malicious Client:** Authorized to view their own project portal. Attempts IDOR to access other clients' galleries, contracts, or personal info.
3. **Compromised Dependency / Supply Chain:** Malicious npm package attempting code execution or secret exfiltration.
4. **Network Eavesdropper:** Snoops unencrypted traffic on local or public networks.

---

## 3. Trust Boundaries

```text
[ Browser: Public / Internet ]
              │ (HTTPS / TLS 1.3)
      [ Caddy Reverse Proxy ]
              │ (Internal Docker Network)
      [ Next.js App Server ]
         │               │
  (PostgreSQL)      (S3 Storage / MinIO)
```

1. **Boundary 1: Internet to Public Endpoints** (Inquiry form, health check, login, portal links)
2. **Boundary 2: Authenticated Client vs. Studio Owner** (Portal routes vs. Studio Admin routes)
3. **Boundary 3: App Server to Database & S3 Storage** (Internal private Docker network)
4. **Boundary 4: App Server to External Third Parties** (SMTP server, Google Calendar, CalDAV)

---

## 4. STRIDE Threat Analysis & Mitigations

### Spoofing
- **Threat:** Attacker spoofs studio owner or claims initial instance setup.
- **Mitigation:** Setup token required for initial instance bootstrap (`SETUP_TOKEN`); argon2id password hashing; mandatory MFA (TOTP/WebAuthn); constant-time token comparison.

### Tampering
- **Threat:** Client or attacker modifies signed contract or database records.
- **Mitigation:** Append-only audit logs with DB triggers preventing UPDATE/DELETE; SHA-256 document hashing of signed PDFs; parameterised queries via Drizzle ORM.

### Repudiation
- **Threat:** Client disputes signing a contract or accepting a proposal.
- **Mitigation:** E-signature audit trail recording document hash, timestamp, signer IP (hashed/truncated), user agent, and verification token.

### Information Disclosure
- **Threat:** Attacker enumerates accounts, reads other clients' photos/galleries (IDOR), or steals credentials from logs.
- **Mitigation:** Object-level authorization checks on all reads/writes; generic error messages; automatic log redaction of PII; private S3 buckets with short-lived pre-signed URLs; EXIF/GPS data stripping from delivered image derivatives.

### Denial of Service
- **Threat:** Attacker spams inquiry forms or uploads decompression bombs / huge video files.
- **Mitigation:** Database-backed rate limiting; honeypot fields; proof-of-work bot protection; server-side file size and magic-byte checks; streaming uploads.

### Elevation of Privilege
- **Threat:** Client portal user escalates to studio admin privileges.
- **Mitigation:** Strict server-side route guards (`requireOwner()`); separate portal token authorization context; minimal database privileges for application user.
