# ADR-0010: Client search with case-insensitive substring matching (ILIKE), trigram index deferred

- Status: Proposed
- Date: 2026-10-10
- Deciders: Architect (pending maintainer review in the TASK-0010 PR)

## Context

E1 requires "tags and search" over clients. The owner searches by client display name, contact given or family name, email, phone number and tag name, typically while on the phone with a client or between shoots on a mobile device. Ownlight is single-studio and self-hosted (ADR-0003): realistic data volumes are hundreds to a few thousand clients over a studio's lifetime, not millions.

Options inside PostgreSQL (no external search engine, ADR-0002, no third-party calls):

1. `ILIKE '%term%'` over the relevant columns (sequential scan or small join).
2. `pg_trgm` GIN indexes to accelerate `ILIKE` and offer similarity ranking.
3. Full-text search (`tsvector`/`tsquery`) with language configurations.

## Decision

1. Use **case-insensitive substring matching (`ILIKE`)** for E1, implemented in the clients repository with Drizzle parameterised queries.
2. The user-supplied term is trimmed, limited to 100 characters, and the LIKE metacharacters `%`, `_` and `\` are **escaped** before being wrapped in `%…%` (no user-controlled wildcards).
3. Matched fields: `clients.display_name`, `client_contacts.given_name`, `client_contacts.family_name`, `client_contacts.email_normalized`, `client_contacts.phone`, `tags.name`. A client matches if any of its fields match; each client appears at most once in results.
4. Performance budget, enforced by an integration test: **p95 ≤ 300 ms over 20 searches on 5,000 clients / 7,500 contacts** in the CI Postgres container.
5. Upgrade path: if the budget is ever exceeded, add `pg_trgm` GIN indexes in a migration (pg_trgm is a trusted extension since PostgreSQL 13) without changing the repository API. This requires a new ADR only if the extension cannot be created by the migrator role.
6. The search term is personal data. It is **never placed in a URL** (no `?q=`), never logged, and never written to audit metadata.

## Alternatives considered

- **pg_trgm now:** faster on large tables and allows fuzzy matching, but adds an extension dependency to migrations and the PGlite-based unit harness, for no measurable benefit at single-studio scale.
- **Full-text search:** language-specific stemming (en/de) is a poor fit for names, emails and phone numbers, and requires keeping `tsvector` columns in sync.
- **External engine (Meilisearch, OpenSearch):** extra service to operate and secure, duplicated personal data, conflicts with "simple self-hosting".

## Consequences

- Simple, dependency-free implementation; results are exact substring matches (no typo tolerance, no accent folding: "Müller" does not match "Mueller").
- The budget test protects against regressions; the trigram upgrade is a contained change.

## Security & privacy impact

- Escaping prevents wildcard injection and pathological patterns; parameterised queries prevent SQL injection (ASVS 5.0 V1).
- Keeping search terms out of URLs keeps client names and emails out of reverse-proxy access logs, browser history and `Referer` headers (GDPR Art. 5(1)(c), Art. 32).
