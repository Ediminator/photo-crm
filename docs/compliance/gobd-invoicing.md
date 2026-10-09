# Invoicing Compliance Blueprint: GoBD, §14 UStG & E-Invoicing

This document outlines the architectural strategy and legal compliance framework for German financial compliance, statutory record retention, and electronic invoicing in Photo CRM.

---

## 1. Compliance Strategy Overview

German financial and tax regulations impose strict legal accountability on commercial photo studios:
- **GoBD** (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff)
- **Umsatzsteuergesetz** (§14 UStG — invoice contents, sequential gapless numbering, correct VAT rates)
- **Abgabenordnung** (§147 AO — statutory retention periods: 8 years under BEG IV 2025 for accounting vouchers, 10 years for books and annual financial statements)
- **Electronic Invoicing Mandate** (Wachstumschancengesetz / EN 16931 — mandatory B2B e-invoicing via ZUGFeRD 2.x and XRechnung)

To provide German photo studios with immediate, legally sound compliance while minimizing operational and legal liability in a self-hosted software environment, Photo CRM adopts a **hybrid two-stage approach**:

| Phase | Strategy | Role of Photo CRM | Role of External Platform |
| --- | --- | --- | --- |
| **Phase 1 (MVP)** | **External Connector (Lexware Office)** | Shoots, contracts, portal delivery, trigger invoicing, webhook sync | Sealed GoBD vouchers, gapless numbering, ZUGFeRD/XRechnung, bank matching, DATEV exports |
| **Post-MVP** | **Modular Connector + Optional Native Engine** | Pluggable accounting providers (`AccountingProvider`), native PDF/A-3 generation | Certified cloud platforms (Lexware, SevDesk) or local GoBD vault |

---

## 2. Phase 1: Lexware Office Integration Pattern (Primary Compliance Path)

Per [ADR-0007](file:///projects/photo-crm/docs/architecture/adr/0007-accounting-integration-lexware.md), Photo CRM connects to Lexware Office via its official REST API v1.

### 2.1 Division of Responsibilities

```text
┌──────────────────────────────────────────────┐
│                  Photo CRM                   │
│  - Captures bookings, packages, quotes       │
│  - Obtains e-signatures on contracts (E6)    │
│  - Dispatches invoice creation requests      │
│  - Stores external voucher IDs & SHA-256     │
│  - Exposes sealed PDFs in Client Portal (E9) │
│  - Receives webhooks & updates timelines     │
└──────────────────────┬───────────────────────┘
                       │ HTTPS (REST API v1 + Webhooks)
┌──────────────────────▼───────────────────────┐
│                Lexware Office                │
│  - Sequential gapless numbering engine       │
│  - GoBD-compliant immutable voucher storage  │
│  - PDF/A-3 & ZUGFeRD / XRechnung generation  │
│  - Storno / cancellation workflow            │
│  - Bank feed reconciliation & payment match  │
│  - DATEV tax advisor export interface        │
└──────────────────────────────────────────────┘
```

1. **Voucher Immutability & Numbering:**
   - Lexware Office acts as the authoritative GoBD ledger. When Photo CRM requests invoice creation, Lexware assigns the legally required sequential invoice number and finalizes the record.
   - Corrections are executed via cancellation invoices (*Stornorechnungen*) generated through Lexware, preserving the audit trail required by GoBD §3.2.
2. **E-Invoicing (ZUGFeRD & XRechnung):**
   - Lexware automatically compiles the EN 16931-compliant XML payload embedded inside an archival PDF/A-3 container.
   - Photo CRM fetches the finalized document via the Lexware API and computes a SHA-256 hash. The client can download this sealed document directly from the authenticated Client Portal (E9).
3. **Payment Reconciliation via Webhooks:**
   - Lexware bank account feeds automatically detect incoming wire transfers or PayPal payments.
   - Lexware fires `payment.changed` and `invoice.status.changed` webhooks to Photo CRM.
   - Photo CRM verifies webhook HMAC signatures, transitions shoot financial stages (e.g., `Down Payment Received`, `Fully Paid`), and logs an audit event (`actor_type: 'system'`).

### 2.2 Security & Privacy Controls
- **API Secret Storage:** Studio Lexware API keys are stored encrypted at rest using AES-256-GCM.
- **Data Minimization (GDPR Art. 5(1)(c)):** Only invoicing-relevant fields (client legal name, billing address, line item description, amount, VAT tax rate) are transferred. Intimate shoot notes, questionnaires, and photo assets remain strictly inside Photo CRM.
- **Webhook Protection:** Webhook endpoints validate authentication tokens, reject unsigned payloads, and run idempotent updates within database transactions.

---

## 3. Statutory Retention (§147 AO) vs. GDPR Erasure (Art. 17)

A critical requirement of German financial compliance is reconciling data subject erasure requests with mandatory tax preservation laws:

1. **Primacy of Retention (GDPR Art. 17(3)(b)):**
   - The right to erasure does **not** apply to data required to comply with statutory retention periods under German tax law (§147 AO, §257 HGB).
2. **Implementation in Photo CRM:**
   - When a client exercises a GDPR erasure request (DSAR), Photo CRM checks for linked accounting records (invoices or down-payments).
   - If active tax vouchers exist:
     - Operational CRM data (marketing consents, questionnaires, photo galleries, raw files) is erased or anonymized per policy.
     - The client's core billing record and linked Lexware voucher references are placed in `legalHold` status.
     - Operational search by client name is disabled, but tax audit export capabilities remain preserved.
     - Once the statutory retention period (8 years under BEG IV 2025) expires, the `retention:sweep` worker purges the retained billing record.

---

## 4. Post-MVP Native Engine Blueprint (Reference Architecture)

Should Photo CRM implement an optional fully native GoBD engine in post-MVP phases, the following architectural controls must be met:

### Immutability & Database Locking
- Issued invoices become permanently immutable via database row-level locking and PostgreSQL rules/triggers disallowing `UPDATE` and `DELETE`.
- Corrections must be exclusively handled through formal credit notes (*Gutschrift*) or cancellation invoices (*Stornorechnung*), referencing original voucher IDs.

### Atomic Sequence Counters
- Sequential numbering must execute inside serializable database transactions (`SELECT ... FOR UPDATE`) or dedicated sequence tables to guarantee collision-free, gapless sequences across concurrent web sessions.

### In-House Document Sealing
- Server-side generation of PDF/A-3 documents embedding EN 16931 XML profiles (ZUGFeRD / XRechnung).
- SHA-256 document hashing recorded in the immutable `audit_events` table at generation time.
