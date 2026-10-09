## Summary
<!-- 2-4 sentences explaining what changed and why -->

## Linked Task / Contract
- Task: `TASK-####`
- Contract: `control/photo-crm/backlog/TASK-####-slug.md`

## Acceptance Criteria & Test Evidence
<!-- List each AC and the test(s) that verify it -->
- [ ] **AC-1:** <evidence test file:line>
- [ ] **AC-2:** <evidence test file:line>

## Quality Gate & Verification
- [ ] All automated gate checks pass (`pnpm run test:coverage` ≥ 85%)
- [ ] Validator verdict: PASS (`verdict-validator.json`)
- [ ] Security & Privacy Auditor verdict: PASS (if risk R1/R2)
- [ ] UX & A11y Reviewer verdict: PASS (if `ui: true`)
- [ ] Iterations used: X / 5

## Security & Privacy Checklist
- [ ] No secrets or real credentials committed
- [ ] Synthetic test data only (no real personal data or photos of identifiable people)
- [ ] Server-side authentication and authorization enforced on all actions/routes
- [ ] Any new personal data fields added to `docs/privacy/data-inventory.md`
- [ ] Logging is PII-free (redaction verified)
- [ ] Dependencies exact-pinned and licences compatible with AGPL-3.0

## Screenshots / Multimodal Artifacts (if UI change)
<!-- Link to screenshots captured at 375px, 768px, 1440px in light and dark mode -->
