#!/usr/bin/env node
/**
 * check-commit-msg.mjs
 * Validates commit messages against the Conventional Commits specification.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const CONVENTIONAL_COMMIT_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9\-._/]+\))?(!)?:\s+[^\s].+$/;

/**
 * Validates a commit message string.
 * @param {string} rawMsg
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateCommitMessage(rawMsg) {
  if (!rawMsg || typeof rawMsg !== 'string') {
    return {
      valid: false,
      error: 'Commit message must not be empty.',
    };
  }

  // Get first non-comment, non-empty line
  const lines = rawMsg.split(/\r?\n/).map((l) => l.trim());
  const header = lines.find((l) => l.length > 0 && !l.startsWith('#'));

  if (!header) {
    return {
      valid: false,
      error: 'Commit message must contain a non-empty header line.',
    };
  }

  // Allow automatic merge commits
  if (header.startsWith('Merge ') || header.startsWith('Revert "')) {
    return { valid: true };
  }

  if (!CONVENTIONAL_COMMIT_REGEX.test(header)) {
    return {
      valid: false,
      error:
        `Commit message header "${header}" does not match Conventional Commits format.\n` +
        'Expected format: <type>(<optional-scope>): <description>\n' +
        'Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n' +
        'Example: feat(auth): add TOTP two-factor authentication (TASK-0012)',
    };
  }

  return { valid: true };
}

// CLI entry point
if (process.argv[1] === __filename) {
  const target = process.argv[2];
  if (!target) {
    console.error('Error: Please provide commit message string or file path.');
    process.exit(1);
  }

  let message = target;
  if (fs.existsSync(target)) {
    message = fs.readFileSync(target, 'utf8');
  }

  const result = validateCommitMessage(message);
  if (!result.valid) {
    console.error(`Invalid commit message: ${result.error}`);
    process.exit(1);
  }

  process.exit(0);
}
