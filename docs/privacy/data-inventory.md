# Data Inventory: Personal Data Register (GDPR Art. 30)

This register documents all personal data processed by the application, its lawful basis, purpose, retention period, and erasure handling.

---

## 1. Studio Owner Personal Data

| Data Field / Entity               | Purpose                                                   | Lawful Basis (GDPR)                        | Retention Period                      | Deletion / Export                                                   |
| --------------------------------- | --------------------------------------------------------- | ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------- |
| `owner.name`, `owner.email`       | Account identification & administration                   | Art. 6(1)(b) Contract / System Operation   | Account lifetime                      | Deleted on instance reset / factory purge; included in Owner Export |
| `owner.password_hash`             | Authentication security                                   | Art. 6(1)(f) Legitimate Interest / Art. 32 | Account lifetime                      | Overwritten on reset                                                |
| `owner.mfa_secret`                | Two-factor authentication (encrypted at rest)             | Art. 32 Security of processing             | Account lifetime / until MFA disabled | Purged on disable                                                   |
| `studio_settings.studio_name`     | Business identification (may identify sole trader)        | Art. 6(1)(b)/(f) Operation & Owner Data    | Instance lifetime                     | Exported with settings                                              |
| `studio_settings.lexware_api_key` | Lexware Office integration secret (AES-256-GCM encrypted) | Art. 6(1)(c) Compliance / Art. 32          | Until integration removed             | Purged on disconnect                                                |

---

## 2. Clients & Leads Data (Phase 1 Epics)

| Data Field / Entity                                  | Purpose                                                       | Lawful Basis (GDPR)                               | Retention Period                                  | Deletion / Export                                |
| ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `leads.name`, `leads.email`, `leads.phone`           | Processing initial shoot inquiry                              | Art. 6(1)(b) Pre-contractual steps                | 12 months after inactivity (default)              | Hard delete or convert to client                 |
| `clients.name`, `clients.address`, `contacts.*`      | Client relationship & project fulfillment                     | Art. 6(1)(b) Performance of a contract            | Active project + 3 years civil limitation         | Full export (Art. 15/20); Art. 17 Erasure        |
| `shoots.locations`, `shoots.timeline`                | Event scheduling & execution                                  | Art. 6(1)(b) Contract                             | Active project + 1 year                           | Erased with client record                        |
| `questionnaire_answers.*`                            | Capturing wedding/shoot preferences                           | Art. 6(1)(b) Contract / Art. 6(1)(a) Consent      | Active project + 1 year                           | Erased with client record                        |
| `galleries.photos`                                   | Image delivery & proofing                                     | Art. 6(1)(b) Contract                             | Defined by studio package (e.g. 1–2 years online) | S3 objects hard deleted on expiry                |
| `consents.*` (Marketing, Portfolio)                  | Tracking consent to publish photos                            | Art. 6(1)(a) Consent / KUG §22                    | Until consent withdrawn + 3 years proof           | Retained as proof of prior consent               |
| `accounting_vouchers.*` (Invoice refs, amounts, VAT) | Statutory financial & e-invoicing compliance (Lexware Office) | Art. 6(1)(c) Legal obligation (§147 AO, §14 UStG) | 8 years (BEG IV 2025)                             | Retained under `legalHold`; purged after 8 years |

---

## 3. System & Audit Data

| Data Field / Entity | Purpose                                                           | Lawful Basis (GDPR)              | Retention Period         | Deletion / Export                                     |
| ------------------- | ----------------------------------------------------------------- | -------------------------------- | ------------------------ | ----------------------------------------------------- |
| `sessions.*`        | User session management                                           | Art. 32 Security of processing   | 30 days maximum          | Automatically purged on expiry                        |
| `rate_limits.*`     | Anti-automation & brute-force defense                             | Art. 6(1)(f) Legitimate Interest | 24 hours maximum         | Automatically purged daily                            |
| `audit_events.*`    | Security accountability, breach investigation & agent attribution | Art. 5(2), Art. 32               | 24 months (configurable) | Pruned by retention sweep (pseudonymous IDs retained) |
