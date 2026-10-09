import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-5: Human operations guide for GitHub repository settings', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const guidePath = path.resolve(rootDir, 'docs/operations/github-settings.md');
  const readmePath = path.resolve(rootDir, 'README.md');

  it('AC-5: docs/operations/github-settings.md exists and is linked from README.md', () => {
    expect(fs.existsSync(guidePath)).toBe(true);
    const readme = fs.readFileSync(readmePath, 'utf8');
    expect(readme).toContain('docs/operations/github-settings.md');
  });

  it('AC-5: documents branch protection and rulesets for main with linear history and no force-push', () => {
    const content = fs.readFileSync(guidePath, 'utf8');

    expect(content).toMatch(/main/);
    expect(content).toMatch(/linear history/i);
    expect(content).toMatch(/force push/i);
    expect(content).toMatch(/Code Owners/i);
    expect(content).toMatch(/dismiss stale/i);
    expect(content).toMatch(/administrators|bypass/i);
  });

  it('AC-5: lists the exact status check names corresponding to workflow jobs', () => {
    const content = fs.readFileSync(guidePath, 'utf8');

    const expectedChecks = [
      'Quality Gate (full profile)',
      'CodeQL Security Analysis',
      'Dependency Review',
      'Scorecard Analysis',
      'Full-history Secret Scan',
      'OSV Lockfile Scan',
    ];

    for (const check of expectedChecks) {
      expect(content, `Must document exact status check name: "${check}"`).toContain(check);
    }
  });

  it('AC-5: documents secret scanning push protection and private vulnerability reporting', () => {
    const content = fs.readFileSync(guidePath, 'utf8');

    expect(content).toMatch(/secret scanning/i);
    expect(content).toMatch(/push protection/i);
    expect(content).toMatch(/private vulnerability reporting/i);
  });

  it('AC-5: documents least-privilege action permissions and local tooling installation', () => {
    const content = fs.readFileSync(guidePath, 'utf8');

    expect(content).toMatch(/contents:\s*read/i);
    expect(content).toContain('actionlint');
    expect(content).toContain('zizmor');
    expect(content).toContain('pnpm run lint:actions');
  });
});
