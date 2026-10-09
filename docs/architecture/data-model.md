# Data Model & Schema Conventions

This document establishes the architectural conventions and design rules for all database tables and entities in Photo CRM. Every later schema addition or migration must conform to these rules.

---

## 1. Primary Keys & Identifiers: UUIDv7

All primary keys use **UUIDv7** (RFC 9562), stored natively in PostgreSQL `uuid` columns.

### Rationale

- **Time-Ordered B-Tree Locality:** Standard random UUIDs (UUIDv4) cause severe B-Tree index fragmentation and cache eviction at scale due to random insertion positions. UUIDv7 embeds a 48-bit big-endian millisecond timestamp in the high-order bits, ensuring sequential append-friendly indexing with index write performance rivaling sequential integers.
- **Client & Agent Generation:** UUIDv7s can be securely generated in application layers, client sessions, or background jobs without requiring round-trip database sequence allocation (`SERIAL` / `IDENTITY`).
- **No PII or Enumeration Leakage:** Unlike sequential auto-incrementing integer IDs (`1, 2, 3`), UUIDv7 does not leak business metrics (total clients, invoice counts, shoot volumes) or enable URL enumeration attacks.
- **Privacy by Design:** IDs and slugs must **never** contain personal names, email fragments, or sensitive details.

### Implementation Standard

- Generated via `generateUuidV7()` in `src/lib/id.ts`.
- Drizzle schema definition:
  ```typescript
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7());
  ```

---

## 2. Timestamps: UTC timestamptz

Every table tracking persistent entities must maintain two standard audit timestamps:

- `created_at`: Point in time of row creation.
- `updated_at`: Point in time of the most recent modification.

### Conventions

- Column type: `timestamp with time zone` (`timestamptz` in PostgreSQL, `timestamp({ withTimezone: true, mode: 'date' })` in Drizzle).
- Default value: `now()` (`DEFAULT now()`).
- Time zone storage: Strictly UTC. Application layer renders dates according to the configured studio time zone (`studio_settings.timezone`) or event location time zone.

---

## 3. Money Representation: Integer Minor Units & ISO Currency

To eliminate floating-point rounding errors and multi-currency ambiguity:

- **Amount:** All monetary values are represented as 64-bit integer minor units (e.g. Euro cents: `€150.00` = `15000`, `¥1000` = `1000`).
- **Currency:** Explicit 3-letter ISO 4217 currency code (e.g. `'EUR'`, `'USD'`, `'GBP'`, `'CHF'`).
- In multi-currency transactions, the currency code is co-located with the amount column (e.g. `package_price_cents` + `package_currency`).

---

## 4. Deletion Policy: GDPR Hard Delete by Default

Data retention and deletion align strictly with GDPR Article 17 (Right to Erasure) and data minimisation principles (Article 5(1)(c)).

### Rules

1. **Hard Delete by Default:** When a client or lead requests erasure or when transient records expire, records are permanently deleted via `DELETE FROM ...`.
2. **Short Undo Window (Optional):** Where user experience requires an undo window for accidental deletion (e.g. client project or shoot), a `deleted_at timestamptz` column may be used temporarily.
3. **Automated Purge:** Soft-deleted records are strictly bounded and automatically hard-deleted after the configured grace period (default: 30 days) by the retention framework (TASK-0007).
4. **Legal Holds:** Entities subject to statutory retention obligations (e.g. invoices under §147 AO / GoBD requiring 8 years retention) cannot be deleted until the statutory retention period expires, even upon erasure request.

---

## 5. Foreign Key Integrity: Explicit ON DELETE Actions

Every foreign key constraint must explicitly define its `ON DELETE` behaviour:

- **`ON DELETE RESTRICT` (Default for critical relations):** Prevents deletion of parent entities when active dependent children exist (e.g. cannot delete a client while unpaid invoices exist).
- **`ON DELETE CASCADE` (Only for strictly owned compositions):** Permitted only when children have no lifecycle independent of the parent (e.g. shoot questionnaire responses when a shoot inquiry is deleted).
- `ON DELETE SET NULL`: Permitted only for non-mandatory references (e.g. assigning a secondary tag or non-critical category).

---

## 6. Initial Core Table: `studio_settings`

The `studio_settings` table stores singleton tenant configuration for the photography studio instance:

| Column           | Type           | Constraints               | Description                                    |
| ---------------- | -------------- | ------------------------- | ---------------------------------------------- |
| `id`             | `uuid`         | `PRIMARY KEY`             | UUIDv7 primary key                             |
| `studio_name`    | `varchar(255)` | `NOT NULL`                | Studio trading name (may identify sole trader) |
| `default_locale` | `varchar(10)`  | `NOT NULL, DEFAULT 'en'`  | Default UI locale (`en` or `de`)               |
| `timezone`       | `varchar(64)`  | `NOT NULL, DEFAULT 'UTC'` | Studio IANA time zone identifier               |
| `currency`       | `varchar(3)`   | `NOT NULL, DEFAULT 'EUR'` | Studio default ISO 4217 currency code          |
| `created_at`     | `timestamptz`  | `NOT NULL, DEFAULT now()` | UTC creation timestamp                         |
| `updated_at`     | `timestamptz`  | `NOT NULL, DEFAULT now()` | UTC last update timestamp                      |
