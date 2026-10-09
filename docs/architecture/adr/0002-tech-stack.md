# ADR-0002: Technology stack

- Status: Accepted (maintainer decision, 2026-10-09)
- Date: 2026-10-09

## Context

We need a stack that a small open-source community can maintain, that self-hosters can run on modest hardware, and that supports strong security, i18n and accessibility, along with good tooling for autonomous agents (types, fast tests).

## Decision

| Concern          | Choice                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| Language         | TypeScript (strict) on Node.js 24 LTS                                                  |
| Web framework    | Next.js (App Router, RSC, server actions), single deployable app plus a worker process |
| Database         | PostgreSQL (current stable major)                                                      |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL-first, typed)                                           |
| Auth             | Better-Auth (self-hosted, Drizzle adapter, 2FA and passkey plugins)                    |
| UI               | Tailwind CSS + shadcn/ui (Radix primitives), self-hosted fonts                         |
| i18n             | next-intl (en, de)                                                                     |
| Validation       | zod                                                                                    |
| Jobs             | Postgres-backed queue (pg-boss or equivalent, decided in TASK-0007)                    |
| Logging          | pino with redaction                                                                    |
| Testing          | Vitest (unit and integration), Playwright + axe (E2E and a11y)                         |
| Package manager  | pnpm (exact pins, lockfile, build-script allowlist)                                    |
| Packaging        | Docker images + Docker Compose (Caddy reverse proxy for TLS)                           |

## Alternatives

SvelteKit (smaller ecosystem for accessible component primitives), Django + HTMX (strong admin, but a second language for the frontend and weaker typed end-to-end safety), Prisma (heavier runtime, less SQL control), Auth.js (less complete MFA and passkey support at decision time).

## Consequences

- Server actions are public endpoints, so the authorisation patterns in `AGENTS.md` are mandatory.
- A single TypeScript codebase keeps agent context small and enables end-to-end types.
- Versions are pinned exactly, and upgrades flow through dependency-update PRs with the full gate.

## Security & Privacy impact

The whole stack is self-hostable with no mandatory external services. Better-Auth keeps credentials in our own database. All libraries are under AGPL-compatible licences (verified by `scan:licenses`).
