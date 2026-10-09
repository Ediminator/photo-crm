# ADR-0006: Agentic interface via CLI and Model Context Protocol (MCP)

- Status: Proposed
- Date: 2026-10-09

## Context

Photographers and studio operators increasingly use AI agents (such as Antigravity, Claude, Cursor, and custom local assistants) and command-line automation for routine business workflows:
- Triaging inbound inquiries and questionnaire responses
- Checking shoot schedules and calendar conflicts
- Triggering client follow-ups and status transitions
- Initiating invoice and down-payment creation via Lexware Office
- Reconciling banking and payment records

To support both human terminal power-users and autonomous/semi-autonomous AI agents, Photo CRM requires a first-class programmatic interface. However, providing raw database access or an unstructured API exposes high security and privacy risks (accidental PII exfiltration to LLMs, unauthorized modifications, lack of audit accountability).

## Decision

We will implement **both** a headless TypeScript CLI tool (`pcrm`) and a Model Context Protocol (MCP) server (`@photo-crm/mcp`), built on top of a shared, typed domain service SDK.

### 1. Architectural Layers

```text
┌─────────────────────────────────┐   ┌──────────────────────────────────┐
│          CLI (`pcrm`)           │   │    MCP Server (`@photo-crm/mcp`) │
│     Human / Script Automation   │   │       AI Agent Assistants        │
└────────────────┬────────────────┘   └─────────────────┬────────────────┘
                 │                                      │
                 └──────────────┬───────────────────────┘
                                │
                 ┌──────────────▼───────────────────────┐
                 │    Photo CRM Core Domain SDK         │
                 │   (Typed validation, services, Zod)  │
                 └──────────────┬───────────────────────┘
                                │
                 ┌──────────────▼───────────────────────┐
                 │       Server Actions / REST API      │
                 │   (Auth, Scopes, Rate Limits, Audit) │
                 └──────────────┬───────────────────────┘
                                │
                 ┌──────────────▼───────────────────────┐
                 │          PostgreSQL Database         │
                 └──────────────────────────────────────┘
```

1. **Photo CRM Core SDK:** Domain operations (clients, shoots, proposals, invoices, questionnaires) are encapsulated into reusable, typed TypeScript services with strict Zod schema validation.
2. **Headless CLI (`pcrm`):** A command-line client supporting human-friendly text tables as well as machine-readable `--json` output, exit codes, and piping.
3. **MCP Server (`@photo-crm/mcp`):** Exposes CRM capabilities as standardized MCP Tools and Resources conformant to the Model Context Protocol specification.

### 2. Transports

- **stdio:** For local AI agents (e.g. desktop Claude, Cursor, local agent runners) and standard CLI executions running on the same host or local workstation. Zero external network surface; communication occurs over standard input/output.
- **SSE / HTTP (Server-Sent Events):** For remote agents, hosted automation, or container-to-container agent workflows. Implements token-authenticated HTTP with SSE streaming.

### 3. Security & Privacy Architecture

1. **Scoped API Tokens:**
   - Agent and CLI access requires dedicated, cryptographically secure API tokens (`pcrm_live_...`), separate from web user session cookies.
   - Tokens are hashed at rest (SHA-256) and displayed to the owner only once upon creation.
   - Granular, least-privilege permission scopes are enforced on every operation (e.g., `clients:read`, `clients:write`, `shoots:read`, `shoots:write`, `proposals:read`, `lexware:sync`, `invoices:read`).
2. **PII Redaction by Default:**
   - Tool outputs and CLI summaries redact sensitive personal data (e.g. masking client emails, phone numbers, home addresses, and private notes) unless the token explicitly holds full read privileges and the operation specifically requests unmasked data.
   - Raw database dumps and bulk personal data extractions are blocked over the agentic interface.
3. **Immutable Audit Logging with Agent Attribution:**
   - Every CLI command and MCP tool execution generates an immutable audit record in `audit_events`.
   - The actor is recorded with `actor_type: 'agent'`, referencing the specific `token_id`, the invoked tool/command name, parameters hash, client IP/transport, and outcome.
4. **Rate Limiting & Safety Guardrails:**
   - Database-backed token rate limits prevent runaway agent loops.
   - Destructive operations (e.g. client deletion, contract cancellation, invoice sealing) require explicit confirmation flags (`--confirm` or interactive confirmation parameter).

## Alternatives Considered

- **CLI-only:**
  - *Pros:* Simple to build with standard Node CLI libraries (`commander`, `citty`).
  - *Cons:* AI agents must run shell commands and parse unstructured or semi-structured stdout, leading to hallucinated arguments, brittle tool definitions, and weak context negotiation.
- **REST API only:**
  - *Pros:* Industry standard, straightforward HTTP endpoints.
  - *Cons:* Leaves terminal users without a streamlined workflow and requires agent developers to build custom client wrappers rather than plugging directly into the standardized Model Context Protocol ecosystem.
- **MCP Server only:**
  - *Pros:* Native integration with modern AI agent clients.
  - *Cons:* Excludes standard bash scripts, cron jobs, CI/CD pipelines, and human terminal users who need fast command-line access without running an LLM.
- **Chosen: Shared SDK with CLI and MCP:**
  - Provides maximum versatility with zero duplication of business logic and authorization rules.

## Consequences

- Domain logic must remain cleanly decoupled from web presentation components and server-rendered HTML.
- Auth system (TASK-0005) must incorporate API key management and scope validation.
- Audit logging (TASK-0007) must record `agent` actor types and token identities.
- Testing must include stdio MCP tool calls, CLI argument parsing, scope enforcement, and redaction verification.

## Security & Privacy Impact

- Protects client PII from unintended LLM prompt exposure via default masking.
- Enables complete traceability of agent-driven actions in case of automated errors.
- Adheres to OWASP ASVS 5.0 V8 (Authorization) and GDPR Art. 25 (Privacy by Design).
