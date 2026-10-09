# ADR-0003: Self-hosted, single-studio deployment

- Status: Accepted (maintainer decision, 2026-10-09)
- Date: 2026-10-09

## Context

Photographers' client data is sensitive: wedding dates, addresses, family details, photos of minors. A central multi-tenant service would make the project a data processor for thousands of studios and a high-value target.

## Decision

One instance serves exactly one studio. The reference deployment is Docker Compose: app, worker, PostgreSQL, S3-compatible storage and Caddy, with optional SMTP relay. There is no tenant ID in the data model. Authorisation still scopes every query by the actor (owner vs. portal client vs. anonymous) and keeps the model ready for future team roles.

## Alternatives

Multi-tenant SaaS from day one (complex isolation, compliance burden, operational cost); a desktop or local-first app (no client portal without a server).

## Consequences

- Each studio is the controller of its data; the project ships tooling (export, erasure, retention, ROPA draft), not a hosted service.
- Install, backup, restore and update UX are first-class features (Phase 2).
- A multi-tenant mode would need a new ADR and a security review.

## Security & Privacy impact

Smaller blast radius per breach; no cross-tenant leakage class of bugs. Operators need secure defaults, which is why the app refuses to start with weak secrets, binds dev services to localhost, and ships hardened compose files.
