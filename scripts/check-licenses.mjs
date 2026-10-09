#!/usr/bin/env node
/**
 * check-licenses.mjs
 * Validates dependencies from `pnpm licenses list --json` against `license-policy.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Strips outer parentheses from a license expression.
 * @param {string} str
 * @returns {string}
 */
function unwrap(str) {
  let s = str.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Evaluates a single license identifier against allowed list and exceptions.
 * @param {string} packageName
 * @param {string | undefined | null} licenseString
 * @param {{ allowedLicenses: string[], exceptions?: Record<string, { license: string, reason: string }> }} policy
 * @returns {{ allowed: boolean, status: 'ALLOWED' | 'EXCEPTION' | 'DENIED' | 'UNKNOWN', reason: string }}
 */
export function evaluateLicense(packageName, licenseString, policy) {
  if (
    !licenseString ||
    typeof licenseString !== 'string' ||
    !licenseString.trim() ||
    licenseString === 'UNKNOWN'
  ) {
    return {
      allowed: false,
      status: 'UNKNOWN',
      reason: `Package "${packageName}" has an unknown or missing license.`,
    };
  }

  const raw = unwrap(licenseString);

  // Check exceptions first
  const exception = policy.exceptions?.[packageName];
  if (exception) {
    if (exception.license === '*' || exception.license === raw || raw.includes(exception.license)) {
      return {
        allowed: true,
        status: 'EXCEPTION',
        reason: `Justified exception: ${exception.reason}`,
      };
    }
  }

  // Exact match
  if (policy.allowedLicenses.includes(raw)) {
    return {
      allowed: true,
      status: 'ALLOWED',
      reason: `License "${raw}" is in the allowlist.`,
    };
  }

  // Handle compound OR expression
  if (raw.includes(' OR ')) {
    const parts = raw.split(' OR ').map((p) => p.trim());
    const anyAllowed = parts.some((p) => {
      const sub = evaluateLicense(packageName, p, policy);
      return sub.allowed;
    });
    if (anyAllowed) {
      return {
        allowed: true,
        status: 'ALLOWED',
        reason: `Compound expression "${raw}" contains an allowed alternative.`,
      };
    }
  }

  // Handle compound AND expression
  if (raw.includes(' AND ')) {
    const parts = raw.split(' AND ').map((p) => p.trim());
    const allAllowed = parts.every((p) => {
      const sub = evaluateLicense(packageName, p, policy);
      return sub.allowed;
    });
    if (allAllowed) {
      return {
        allowed: true,
        status: 'ALLOWED',
        reason: `All components of compound expression "${raw}" are allowed.`,
      };
    }
  }

  return {
    allowed: false,
    status: 'DENIED',
    reason: `License "${raw}" is not permitted by license-policy.json.`,
  };
}

/**
 * Checks an entire license map from pnpm against policy.
 * @param {Record<string, Array<{ name: string, versions?: string[] }>>} licenseData
 * @param {{ allowedLicenses: string[], exceptions?: Record<string, { license: string, reason: string }> }} policy
 * @returns {{ valid: boolean, violations: Array<{ name: string, license: string, status: string, reason: string }>, count: number }}
 */
export function checkLicenses(licenseData, policy) {
  const violations = [];
  let count = 0;

  for (const [license, packages] of Object.entries(licenseData)) {
    if (!Array.isArray(packages)) continue;
    for (const pkg of packages) {
      count++;
      const result = evaluateLicense(pkg.name, license, policy);
      if (!result.allowed) {
        violations.push({
          name: pkg.name,
          license,
          status: result.status,
          reason: result.reason,
        });
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    count,
  };
}

// CLI entry point
if (process.argv[1] === __filename) {
  try {
    const policyPath = path.resolve(__dirname, '../license-policy.json');
    if (!fs.existsSync(policyPath)) {
      console.error(`Error: Policy file not found at ${policyPath}`);
      process.exit(1);
    }
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

    const rawOutput = execSync('pnpm licenses list --json', {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      cwd: path.resolve(__dirname, '..'),
    });
    const licenseData = JSON.parse(rawOutput);

    const result = checkLicenses(licenseData, policy);
    if (!result.valid) {
      console.error(`License policy check failed with ${result.violations.length} violation(s):`);
      for (const v of result.violations) {
        console.error(`  - ${v.name} (${v.license}): [${v.status}] ${v.reason}`);
      }
      process.exit(1);
    }

    console.log(`License check PASSED: verified ${result.count} package instances against policy.`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to run license check:', err.message);
    process.exit(1);
  }
}
