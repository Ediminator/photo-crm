# Invoicing Compliance Blueprint: GoBD & §14 UStG (Post-MVP)

This document outlines the architectural blueprint and legal requirements for German financial compliance when invoicing, deposit handling, and payment plans are added to Photo CRM in post-MVP phases.

---

## 1. Regulatory Framework

1. **GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff):**
   - Immutability of accounting records.
   - Traceability, completeness, and audit-readiness.
2. **Umsatzsteuergesetz (§14 UStG):**
   - Mandatory invoice contents, sequential unique invoice numbers.
3. **Abgabenordnung (§147 AO) & Handelsgesetzbuch (§257 HGB):**
   - Statutory retention periods for accounting vouchers (currently 8 years under BEG IV 2025; 10 years for books and balance sheets; 6 years for business correspondence).
4. **Electronic Invoicing (E-Rechnung / EN 16931):**
   - B2B structured electronic invoicing mandate in Germany (ZUGFeRD 2.x and XRechnung).

---

## 2. Architectural Blueprint

### Immutability & Correction Process
- **Never UPDATE or DELETE an Issued Invoice:** Once an invoice is finalized and assigned a sequential number, the database row is locked.
- **Storno / Credit Note Workflow:** Corrections are made exclusively via a cancellation invoice (*Stornorechnung*) or a credit memo (*Gutschrift*), referencing the original invoice number.
- **Sealed PDF & XML:** The generated invoice PDF/A-3 and structured XML (ZUGFeRD) are hashed (SHA-256) at generation and stored in immutable object storage.

### Sequential Invoice Numbering (§14(4) Nr. 4 UStG)
- Invoice numbers must be sequential and gapless per calendar year or series.
- Generation must occur within an atomic database transaction with table/sequence locking to prevent collisions during concurrent checkouts.

### Electronic Invoicing (ZUGFeRD & XRechnung)
- Invoices must embed a machine-readable XML payload conformant to standard EN 16931 inside a PDF/A-3 container.
- Both B2B (XRechnung profile) and B2C (standard PDF with Kleinunternehmer note per §19 UStG where applicable) must be supported.

### Statutory Retention vs. GDPR Erasure
- Under GDPR Art. 17(3)(b), the right to erasure does not override statutory record retention obligations (§147 AO).
- Invoices under retention are placed under a `legalHold`. Operational search by client name is disabled, but tax audit export remains intact until the statutory period ends.
