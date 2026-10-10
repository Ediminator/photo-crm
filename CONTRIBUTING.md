# Contributing to Ownlight

Thank you for your interest in contributing! This project is open source and built to serve independent photographers and videographers while maintaining rigorous safety, privacy, and quality standards.

## Developer Certificate of Origin (DCO)

We do not require a Contributor License Agreement (CLA). Instead, all contributions must be certified under the **Developer Certificate of Origin (DCO) Version 1.1**.

By adding a `Signed-off-by` line to your commit message, you certify that:

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

To sign your commit, use the `-s` flag:

```bash
git commit -s -m "feat(clients): add client note history"
```

---

## Commit Guidelines

We use **Conventional Commits**:

```text
<type>(<scope>): <short summary in imperative present tense> (<optional issue/task ref>)
```

Examples:

- `feat(leads): add honeypot spam protection (TASK-0012)`
- `fix(auth): invalidate sessions upon password change (TASK-0015)`
- `test(portal): add IDOR negative tests for contract signing (TASK-0020)`

Allowed types: `feat`, `fix`, `refactor`, `test`, `chore`, `ci`, `docs`, `sec`, `perf`.

---

## Development & Quality Gate

Every change must pass our deterministic Quality Gate:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run check:i18n
pnpm run test:coverage   # Enforces >= 85% coverage on all metrics
pnpm run build
pnpm run scan:secrets
pnpm run scan:sast
pnpm run scan:deps
pnpm run scan:licenses
pnpm run test:e2e
```

### Safety & Privacy Non-Negotiables

1. **No secrets in git:** Never commit `.env` or real API keys.
2. **Synthetic data only:** Never use real personal data or photos of identifiable people in test fixtures or seeds. Use `example.com` domains and fixed-seed generators.
3. **Privacy by design:** Every new personal-data field must be documented in `docs/privacy/data-inventory.md` with purpose, lawful basis, and retention period.
4. **No gate tampering:** Never use `@ts-ignore`, `@ts-nocheck`, `.only`, or disable lint rules without an approved `-- reason`.
