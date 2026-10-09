# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-10-09

## Context

Agents and human contributors need a durable, reviewable record of why the system looks the way it does.

## Decision

We use lightweight ADRs in `docs/architecture/adr/NNNN-kebab-title.md` with the sections Status, Date, Context, Decision, Alternatives, Consequences, and Security & Privacy impact. New ADRs start as **Proposed**; the maintainer accepts or rejects them. An accepted ADR is never edited in substance. It is superseded by a new ADR that links back to it.

## Consequences

Every significant technology, data-model, security or privacy decision is traceable. Reviewers can reject changes that contradict an accepted ADR.
