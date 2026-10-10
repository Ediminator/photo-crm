# MVP Scope (v1.0)

Selected by the maintainer on 2026-10-09. Each epic is decomposed into task contracts by the architect agent. Items marked _(later)_ are explicitly **not** part of v1.0.

## E1: Clients & contacts

- Clients (person or company) with contacts, addresses, preferred language, and notes.
- Relationship history timeline: enquiries, projects, emails sent, documents, portal activity.
- Tags and search; duplicate detection by email.
- **Google Contacts Sync (Opt-In):** One-way sync from CRM clients to photographer's Google Contacts via People API so caller ID identifies clients on mobile devices during shoot days.
- **Privacy:** per-person data export (JSON plus human-readable output), erasure with retention-lock awareness, and consent records (marketing, image usage).
- _(later)_ CSV import from other CRMs (Phase 2).

## E2: Lead capture & inquiry forms

- Configurable inquiry forms (fields, event types, required consent text), embeddable on the studio website (iframe or script-free HTML POST) and hosted at a public URL.
- Spam defence without third parties: honeypot, rate limiting, proof-of-work (for example ALTCHA).
- Lead inbox, auto-reply email (en/de), and conversion of a lead into a client plus project.
- Auto-deletion of unconverted leads after a configurable period.

## E3: Projects / shoots with pipeline stages

- Project types (wedding, portrait, event, commercial, video…) with configurable pipeline stages. Default: **Inquiry → Booked → Shot → Editing → Delivered → Archived**.
- Shoot details: date and time (time zone aware), locations (multiple, with addresses and notes), timeline or run-of-show, participants.
- Board (drag with a keyboard alternative) and list views; tasks or checklists per stage.

## E4: Calendar & booking scheduler

- Studio calendar showing shoots, appointments and blocked time.
- Availability rules and public booking pages (session types, durations, buffers, lead time).
- Two-way sync with Google Calendar (OAuth, minimal scopes) and CalDAV (Nextcloud, iCloud and others) as **opt-in** integrations.
- **Google Meet Integration:** Auto-generation of Google Meet video links for consultation calls booked through the scheduler.
- iCal feed (secret URL, revocable).
- Time zones handled explicitly; reminders via E8.

## E5: Packages, quotes & proposals

- Package and product catalogue (prices in minor units plus currency, tax rate field for display).
- Quotes or proposals built from packages, with optional add-ons the client can select, validity dates and acceptance.
- Proposal acceptance can lead straight into a contract (E6). _(Payment collection is later.)_

## E6: Contracts with e-signature

- Contract templates with merge fields (client, project, package, dates), in en and de.
- Simple electronic signature (eIDAS SES) by client and studio, with an evidence trail (document hash, timestamps, verification method). Signed PDFs become immutable.
- Countersignature, reminders, and a status in the project timeline.

## E7: Questionnaires

- Form builder (text, choice, date or time, repeatable groups for shot lists and timelines, file upload with limits).
- Sent via the portal; autosaves client answers; answers attach to the project and can be exported.
- Templates: wedding day timeline, family shot list, portrait preferences.

## E8: Email templates & workflow automations

- Email templates with merge fields per language; the studio's own SMTP; plain-text alternative; tracking-free (no open or click tracking).
- Automations: triggers (stage change, X days before or after the shoot date, document signed, questionnaire completed) leading to actions (send email, create task, move stage), with preview, dry run, pause, and an audit trail.

## E9: Client portal

- One portal per project: proposal, contract, questionnaires, gallery, messages, key dates.
- Access via magic link or long-lived per-project link (hashed and revocable); studio branding (logo, colours); en and de.
- No client account passwords in v1.0.

## E10: Gallery / video delivery & proofing

- Upload (resumable), automatic derivatives (web sizes, thumbnails), EXIF/GPS stripping on derivatives by default, optional watermark.
- Collections, favourites and proofing (client selects images, with limits), comments.
- Downloads (single or ZIP, original or web size, configurable), expiry dates, optional password, `noindex`.
- Video: upload and streaming playback (HLS or progressive, decided by ADR), poster frames.
- Storage: S3-compatible (self-hosted or provider), private by default.

## E11: Agentic interface (CLI & Model Context Protocol)

- Headless TypeScript CLI (`pcrm`) supporting text tables, shell piping, and machine-readable `--json` output.
- Model Context Protocol (MCP) server (`@ownlight/mcp`) exposing CRM domain tools and resources to AI agent assistants (Antigravity, Claude, Cursor).
- Supported transports: stdio (local desktop/workstation agents) and HTTP/SSE (remote container/agent workflows).
- Security: Scoped API tokens (`ownlight_live_...`), token rate limiting, PII redaction by default in tool responses, and immutable audit logging with agent attribution (`actor_type: 'agent'`, token ID, tool name).

## E12: External accounting & tax platform connector (Lexware Office)

- Modular `AccountingProvider` interface for seamless connection to external accounting and tax systems.
- Lexware Office integration as the primary GoBD, §14 UStG, and mandatory B2B e-invoicing (EN 16931 / ZUGFeRD / XRechnung) compliance path for Phase 1.
- Two-way contact synchronization (CRM Clients ↔ Lexware Contacts).
- Automatic invoice and down-payment invoice (_Anzahlungsrechnung_) generation upon proposal acceptance, contract signing, or shoot milestones.
- Sealed PDF/A-3 and ZUGFeRD invoice retrieval, made available to clients read-only in the Client Portal (E9).
- Webhook subscriptions (`invoice.status.changed`, `payment.changed`) for automatic payment status reconciliation in CRM project timelines.
- Security: AES-256-GCM encrypted API key storage at rest, webhook signature verification, and strict data minimization.

## Cross-cutting (applies to every epic)

- English and German UI; WCAG 2.2 AA; mobile-first.
- Audit log of security-relevant and privacy-relevant actions.
- Retention policies per data type; export and erasure coverage; no third-party calls by default.

## Explicitly out of scope for v1.0

Native in-house GoBD certification engine and direct bank-account feeds (provided externally via the Lexware Office connector in Phase 1; full native in-house engine is post-MVP), domain registration and DNS management (handled externally at registrar/DNS level), Google Drive for primary gallery/video delivery (handled via S3-compatible storage), full two-way Gmail inbox scraping (outgoing transactional mail is tracked), payment plans, Stripe credit card processing, expenses and mileage, reporting dashboards beyond basic counts, team members and roles, multi-tenant SaaS, native apps.
