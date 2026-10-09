# Security Policy

## Reporting a Vulnerability

We take the security of this project and the personal data of photographers and their clients very seriously. If you discover a vulnerability, please report it responsibly and privately.

**Do NOT open a public GitHub issue, discussion, or pull request for security vulnerabilities.**

### How to Report

1. **GitHub Private Vulnerability Reporting:**  
   If enabled on the repository, submit via the **Security** tab → **Advisories** → **Report a vulnerability**.
2. **Email Disclosure:**  
   Alternatively, email the maintainer directly at the security contact address specified in the repository profile or project settings.

### What to Include

Please provide detailed information to help us understand and resolve the issue quickly:
- Description of the vulnerability and its potential impact.
- Affected component, route, server action, or dependency.
- Step-by-step reproduction instructions, Proof of Concept (PoC) code, or HTTP request traces (using synthetic/fake credentials only).
- Remediation recommendations if known.

### Response SLA

- **Acknowledgment:** Within 48 hours of receipt.
- **Initial Assessment & Triage:** Within 5 business days.
- **Patch & Release:** Typically within 14–30 days depending on severity and complexity. We will coordinate disclosure with you before publishing an advisory.

---

## Security Standards & Baselines

This project adheres to:
1. **OWASP ASVS 5.0 (Application Security Verification Standard) Level 2**
2. **OWASP Top 10**
3. **Privacy by Design & Default (GDPR Art. 25, CCPA/CPRA)**
4. **Supply-chain security:** commit SHA-pinned GitHub Actions, exact dependency pinning, lockfile enforcement, and automated dependency scanning.

For detailed technical controls and verification checklists, see [docs/security/security-baseline.md](docs/security/security-baseline.md) and [docs/security/threat-model.md](docs/security/threat-model.md).
