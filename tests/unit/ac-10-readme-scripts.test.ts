import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-10: README documentation completeness for package scripts', () => {
  it('AC-10: every script in package.json is documented in README.md', () => {
    const pkgPath = path.resolve(import.meta.dirname, '../../package.json');
    const readmePath = path.resolve(import.meta.dirname, '../../README.md');

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const readme = fs.readFileSync(readmePath, 'utf8');

    const scripts = Object.keys(pkg.scripts ?? {});
    expect(scripts.length).toBeGreaterThan(0);

    const undocumented: string[] = [];

    for (const script of scripts) {
      // Check for exact script mention in README (e.g. `pnpm run <script>` or `pnpm <script>`)
      const pattern = new RegExp(`\`(pnpm (run )?)?${script}\``);
      if (!pattern.test(readme)) {
        undocumented.push(script);
      }
    }

    expect(
      undocumented,
      `Found undocumented scripts in README.md: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});
