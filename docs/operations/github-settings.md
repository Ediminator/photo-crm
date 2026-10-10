# GitHub Repository Settings & Security Checklist

This document is the operational guide for the human repository administrator to configure GitHub repository security, branch protection rulesets, secret scanning, code scanning, and dependency automation for `setline`.

> [!IMPORTANT]
> **Human Authority Directive:** Autonomous agents must never modify repository settings, secrets, webhooks, or branch protection via the GitHub API or CLI. The human repository owner applies these configurations manually.

---

## 1. Branch Protection & Repository Rulesets (`main`)

Navigate to **Settings > Rules > Rulesets** (or **Settings > Branches** for classic branch protection) and create a ruleset targeting `refs/heads/main`.

### A. Target Branches

- **Enforcement status:** `Active`
- **Target:** Branch pattern `main`

### B. Pull Request Rules

- [x] **Require a pull request before merging**
  - **Required approvals:** `1` (minimum)
  - [x] **Dismiss stale pull request approvals when new commits are pushed**
  - [x] **Require review from Code Owners** (enforces `.github/CODEOWNERS`)
  - [x] **Require conversation resolution before merging**

### C. Required Status Checks

- [x] **Require status checks to pass before merging**
- [x] **Require branches to be up to date before merging** (strict linear validation against HEAD of `main`)
- **Required checks (exact status names reported by GitHub Actions):**
  1. `Quality Gate (full profile)` (defined in `.github/workflows/ci.yml`)
  2. `CodeQL Security Analysis` (defined in `.github/workflows/codeql.yml`)
  3. `Dependency Review` (defined in `.github/workflows/dependency-review.yml`)
  4. `Scorecard Analysis` (defined in `.github/workflows/scorecard.yml`)
  5. `Full-history Secret Scan` (defined in `.github/workflows/gitleaks.yml`)
  6. `OSV Lockfile Scan` (defined in `.github/workflows/osv-scanner.yml`)

### D. Commit & History Constraints

- [x] **Require linear history** (prevent merge commits; allow only squash or rebase merges)
- [x] **Require signed commits** (GPG/SSH/S/MIME verification or DCO sign-off compliance)
- [x] **Block force pushes** (prevent history rewrites on `main`)
- [x] **Block branch deletions** (prevent accidental deletion of `main`)
- [x] **Do not allow bypass** (enforce all rules for repository administrators and owners)

---

## 2. Advanced Security & Secret Scanning

Navigate to **Settings > Code security and analysis**:

- [x] **Secret scanning:** Enable
- [x] **Push protection for secret scanning:** Enable
  - Blocks any developer or agent from pushing commits containing recognized tokens, credentials, or private keys before they reach the remote repository.
- [x] **Private vulnerability reporting:** Enable
  - Allows external security researchers and users to report vulnerabilities confidentially through GitHub Security Advisories without public disclosure (integrated with `.github/ISSUE_TEMPLATE/config.yml` and `SECURITY.md`).

---

## 3. Dependency Security & Dependabot

Navigate to **Settings > Code security and analysis**:

- [x] **Dependency graph:** Enable
- [x] **Dependabot alerts:** Enable
- [x] **Dependabot security updates:** Enable (automated pull requests for security vulnerabilities)
- [x] **Dependabot version updates:** Driven by `.github/dependabot.yml` (weekly grouped updates for `npm`, `github-actions`, `docker`, and `docker-compose` with a mandatory ≥ 3-day cooldown on new releases).

---

## 4. GitHub Actions Workflow Permissions

Navigate to **Settings > Actions > General**:

### A. Workflow Permissions

- [x] Select: **Read repository contents and packages permissions** (`contents: read` default token).
  - Workflows must explicitly declare any additional scopes needed (e.g. `security-events: write`).
- [ ] Ensure **"Allow GitHub Actions to create and approve pull requests"** is **UNCHECKED**.

### B. Fork Pull Request Workflows

- [x] **Require approval for all outside collaborators** before running workflows on pull requests.

### C. Allowed Actions

- [x] Select: **Allow select actions and reusable workflows**
  - Allow actions created by GitHub (`actions/*`)
  - Allow actions verified on GitHub Marketplace (`github/codeql-action/*`, `ossf/scorecard-action/*`, `gitleaks/*`, `google/osv-scanner-action/*`, `pnpm/*`)
  - Ensure all workflows use full 40-character commit SHAs.

---

## 5. Tag Protection

Navigate to **Settings > Tags** (or Rulesets):

- [x] Add tag protection rule for `v*`
- Restrict tag creation and modification to repository administrators.

---

## 6. Local Workflow Tooling Setup

To validate GitHub Actions workflows locally before pushing, install the pinned auditing tools:

### `actionlint` (v1.7.12)

- **Linux/macOS:**
  ```bash
  # Using Homebrew:
  brew install actionlint
  # Or download standalone binary from GitHub releases:
  gh release download v1.7.12 --repo rhysd/actionlint
  ```
- **Windows:**
  ```powershell
  gh release download v1.7.12 --repo rhysd/actionlint --pattern "*windows_amd64.zip"
  Expand-Archive actionlint_1.7.12_windows_amd64.zip
  ```

### `zizmor` (v1.30.1)

- **Cross-platform via Python pip:**
  ```bash
  pip install --user zizmor==1.30.1
  ```
- **Cross-platform via Cargo:**
  ```bash
  cargo install zizmor@1.30.1
  ```

### Running Validation

Run the unified action linter script:

```bash
pnpm run lint:actions
```

Or run the full lint suite:

```bash
pnpm run lint
```
