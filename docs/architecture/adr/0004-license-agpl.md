# ADR-0004: License AGPL-3.0-or-later

- Status: Accepted (maintainer decision, 2026-10-09)
- Date: 2026-10-09

## Context

The project is fully open source. Hosting companies could offer a modified version as a paid service without contributing back.

## Decision

The code is licensed under **GNU AGPL-3.0-or-later**. Contributions use the Developer Certificate of Origin (DCO, `Signed-off-by`) instead of a CLA. Source files may carry `SPDX-License-Identifier: AGPL-3.0-or-later`. The running app links to its source code (AGPL §13) from the footer and the about page.

## Consequences

- Dependencies must be AGPL-compatible. The allowlist lives in `docs/security/security-baseline.md` §Licence policy and is enforced by `scan:licenses`.
- Bundled assets (fonts, icons, images) must be under compatible licences (OFL, MIT, CC0, CC-BY with attribution), with their licence files committed.

## Security & Privacy impact

None directly. Transparency supports independent security review.
