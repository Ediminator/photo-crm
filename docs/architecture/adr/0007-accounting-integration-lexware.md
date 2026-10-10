# ADR-0007: External accounting & tax platform connector (Lexware Office)

- Status: Proposed
- Date: 2026-10-09

## Context

German tax law imposes stringent, legally binding requirements on invoicing, record retention, and electronic tax audits:

1. **GoBD:** Demands immutability of accounting records, gapless chronological audit trails, and strict retention periods (§147 AO, currently 8 years under BEG IV 2025; 10 years for books and balance sheets). Once issued, invoices cannot be modified or deleted—corrections require formal cancellation invoices (_Stornorechnungen_).
2. **Umsatzsteuergesetz (§14 UStG):** Mandates sequential, collision-free invoice numbering, specific mandatory company and tax details, and accurate VAT rate attribution (e.g. standard 19%, 7% artistic/licensing rate where applicable, or §19 UStG _Kleinunternehmer_ exemption).
3. **Mandatory B2B E-Invoicing (EN 16931):** Starting January 2025 (with phased transition rules through 2026/2027), German businesses must be capable of receiving and issuing structured electronic invoices conformant to European standard EN 16931 (ZUGFeRD 2.x and XRechnung).
4. **Tax Advisor Integration:** Photographers routinely export financial data to DATEV format for their tax advisors (_Steuerberater_).

Building, verifying, maintaining, and legally defending an in-house GoBD-certified accounting and e-invoicing engine inside a self-hosted open-source CRM involves substantial liability, continuous regulatory maintenance, and complex banking reconciliation features.

In Germany, Lexware Office (formerly _lexoffice_) is the leading certified cloud accounting platform used by solo photographers and creative studios for GoBD compliance, e-invoicing, bank account matching, and tax filings.

## Decision

We will integrate Setline with the **Lexware Office REST API v1** using a modular accounting connector architecture (`AccountingProvider`). Lexware Office serves as the primary GoBD and e-invoicing compliance solution for Setline in Phase 1.

### 1. Connector Capabilities

The integration implements four core workflows:

```text
┌─────────────────────────────────┐                 ┌────────────────────────────────┐
│            Setline            │                 │         Lexware Office         │
│  (Shoots, Contracts, Portal)    │                 │  (GoBD, E-Invoice, DATEV, Tax) │
└────────────────┬────────────────┘                 └────────────────┬───────────────┘
                 │                                                   │
                 │ 1. Two-way Contact Sync (Clients)                 │
                 ├──────────────────────────────────────────────────►│
                 │◄──────────────────────────────────────────────────┤
                 │                                                   │
                 │ 2. Create Invoice / Down-Payment (Anzahlung)      │
                 ├──────────────────────────────────────────────────►│
                 │                                                   │
                 │ 3. Fetch Sealed GoBD PDF / ZUGFeRD XML            │
                 │◄──────────────────────────────────────────────────┤
                 │                                                   │
                 │ 4. Webhook Notification (payment.changed)          │
                 │◄──────────────────────────────────────────────────┤
                 ▼                                                   ▼
```

1. **Two-Way Contact Synchronization:**
   - Synchronizes CRM `clients` with Lexware `contacts` (companies and individuals).
   - Bi-directionally maps customer numbers, VAT identification numbers (_USt-IdNr._), billing addresses, and contact persons.
2. **Invoice & Down-Payment Generation:**
   - Automatically generates draft or finalized invoices and down-payment invoices (_Anzahlungsrechnungen_) in Lexware upon proposal acceptance, contract signing, or shoot completion.
   - Accurately passes line items from packages/add-ons with applicable VAT rates (e.g., 19% standard, 7% copyright/licensing, or 0% §19 UStG note).
3. **Sealed Document Retrieval for Client Portal:**
   - Fetches the finalized, tamper-proof invoice PDF/A-3 (including embedded ZUGFeRD / XRechnung XML) from Lexware Office via API.
   - Stores the document reference and SHA-256 hash in Setline, exposing it read-only in the Client Portal (E9) for client download.
4. **Webhook Event Subscription & Payment Reconciliation:**
   - Subscribes to Lexware webhook event triggers:
     - `invoice.status.changed` (e.g. Draft -> Open -> Overdue)
     - `payment.changed` (e.g. Unpaid -> Paid -> Partially Paid)
   - Automatically updates shoot financial status and project timelines when payments match via Lexware's bank feeds, eliminating manual payment reconciliation.

### 2. Modular Architecture (`AccountingProvider`)

To ensure long-term flexibility and support non-German or alternative platforms, all accounting interactions are abstracted behind an interface:

```typescript
export interface AccountingProvider {
  syncContact(client: Client): Promise<ExternalContactRef>;
  createInvoice(payload: InvoiceDraftPayload): Promise<ExternalInvoiceRef>;
  createDownPaymentInvoice(payload: DownPaymentPayload): Promise<ExternalInvoiceRef>;
  getInvoiceDocument(externalId: string): Promise<InvoiceDocument>;
  handleWebhook(event: WebhookEvent): Promise<WebhookProcessResult>;
}
```

The Lexware Office connector implements this interface as `LexwareOfficeProvider`. Alternative connectors (e.g., SevDesk, QuickBooks, Stripe Invoicing) can be implemented in future iterations without altering CRM core logic.

### 3. Security & Privacy Architecture

1. **Encrypted Credentials at Rest:**
   - The studio's Lexware API key is stored encrypted in the database using **AES-256-GCM** with a dedicated instance encryption key (`ENCRYPTION_KEY`). Plaintext API tokens are never written to disk or logs.
2. **Webhook Verification:**
   - Webhook callback endpoints verify Lexware webhook signatures and token headers before accepting payloads.
   - Payloads are processed idempotently inside database transactions to guard against network retries or replay attacks.
3. **Data Minimization (GDPR Art. 5(1)(c)):**
   - Only data strictly necessary for legal tax invoicing is transmitted to Lexware (client name, billing address, email, line item descriptions, quantities, monetary amounts, and VAT classification).
   - Sensitive CRM data (personal shoot notes, questionnaire answers, family details, private image galleries) is never sent to the external accounting system.
4. **GDPR Erasure vs. Statutory Retention (§147 AO):**
   - Under GDPR Art. 17(3)(b), statutory retention obligations supersede client deletion requests.
   - When a client exercises their right to erasure in Setline, the operational CRM record is anonymized or soft-deleted, but linked accounting vouchers in Lexware remain preserved under GoBD statutory retention lock until the legal retention period expires.

## Alternatives Considered

- **Native In-House GoBD & E-Invoicing Engine:**
  - _Pros:_ Fully self-contained within the CRM with no external service dependency.
  - _Cons:_ Extremely high development and maintenance burden; requires implementing PDF/A-3 generation, EN 16931 XML compilation, atomic gapless sequence counters, financial correction workflows, banking account synchronization, and certified DATEV tax advisor export modules. High risk of legal non-compliance for German studios.
- **SevDesk Integration:**
  - _Pros:_ Popular German accounting solution with cloud API.
  - _Cons:_ Lexware Office currently holds a larger user base among freelance and commercial photographers in Germany and provides comprehensive webhook support for automated payment status synchronization. SevDesk can be added as an alternate provider in Phase 2 via the `AccountingProvider` interface.
- **Manual CSV/DATEV Export Only:**
  - _Pros:_ Simpler initial implementation.
  - _Cons:_ High operational friction for photographers; requires manual export/import steps, lacks real-time payment reconciliation, and cannot deliver sealed invoices directly to clients via the Client Portal.

## Consequences

- Resolves German GoBD and e-invoicing compliance cleanly for MVP Phase 1 with minimal legal risk.
- Requires studios wanting automated invoicing to possess an active Lexware Office account and configure their API key.
- Requires outbound HTTPS internet access from the Setline container to `api.lexoffice.io`.
- Studios that do not use Lexware Office can operate Setline with the accounting integration disabled (proposals and contracts function normally).

## Security & Privacy Impact

- API secrets protected via AES-256-GCM encryption.
- Webhook endpoints protected via authentication verification and rate limiting.
- Zero unnecessary PII exposure to external sub-processors.
- Audit logging records all sync actions with Lexware under `actor_type: 'system'` or `actor_type: 'agent'`.
