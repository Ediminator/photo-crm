import { describe, it, expect } from 'vitest';
import { validateCommitMessage } from '../../scripts/check-commit-msg.mjs';

describe('AC-9: Conventional Commit message validation', () => {
  it('AC-9: accepts valid conventional commit messages', () => {
    const validMessages = [
      'feat: add new client onboarding flow',
      'fix(auth): resolve session expiration race condition',
      'chore(toolchain): scaffold repository and complete quality toolchain (TASK-0001)',
      'docs: update security baseline references',
      'test(api): add IDOR boundary checks for proposals',
      'refactor(db): optimize connection pooling configuration',
    ];

    for (const msg of validMessages) {
      const res = validateCommitMessage(msg);
      expect(res.valid, `Expected "${msg}" to be valid`).toBe(true);
      expect(res.error).toBeUndefined();
    }
  });

  it('AC-9: rejects commit message without type', () => {
    const res = validateCommitMessage('updated readme with new instructions');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('does not match Conventional Commits format');
  });

  it('AC-9: rejects commit message without colon delimiter', () => {
    const res = validateCommitMessage('feat add login page');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('does not match Conventional Commits format');
  });

  it('AC-9: rejects commit message with empty description', () => {
    const res = validateCommitMessage('feat:    ');
    expect(res.valid).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('AC-9: allows merge and revert commits', () => {
    expect(validateCommitMessage('Merge branch "main" into develop').valid).toBe(true);
    expect(validateCommitMessage('Revert "feat: broken commit"').valid).toBe(true);
  });
});
