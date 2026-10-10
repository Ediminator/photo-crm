import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('AC-4: Secret scanner (secretlint) detection in isolated directory', () => {
  it('AC-4: reports a finding when scanning a file containing a secret fixture in a temp dir', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-secret-test-'));
    const tempFile = path.join(tempDir, 'aws-credentials.env');

    try {
      // Fake AWS Access Key fixture constructed dynamically so test source is not flagged
      const prefix = 'AKIA';
      const suffix = '1234567890ABCDEF';
      fs.writeFileSync(tempFile, `AWS_ACCESS_KEY_ID=${prefix}${suffix}\n`, 'utf8');

      // Run secretlint on the temporary fixture file with explicit config and no-gitignore
      const result = spawnSync(
        'pnpm',
        ['exec', 'secretlint', '--no-gitignore', '--secretlintrc', '.secretlintrc.json', tempFile],
        {
          encoding: 'utf8',
          shell: true,
        },
      );

      const output = `${result.stdout || ''}\n${result.stderr || ''}`;

      // Secretlint should detect the AWS token and exit non-zero
      expect(result.status).not.toBe(0);
      expect(output).toMatch(/AWSAccessKeyID|AWS/i);
    } finally {
      // Ensure the fixture is never left behind
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Confirm cleanup
    expect(fs.existsSync(tempFile)).toBe(false);
    expect(fs.existsSync(tempDir)).toBe(false);
  }, 60000);

  it('AC-4: reports no findings for clean files and leaves no fixture behind', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-clean-test-'));
    const tempFile = path.join(tempDir, 'clean-config.env');

    try {
      fs.writeFileSync(tempFile, 'APP_ENV=test\nAPP_NAME=photo-crm\n', 'utf8');

      const result = spawnSync(
        'pnpm',
        ['exec', 'secretlint', '--no-gitignore', '--secretlintrc', '.secretlintrc.json', tempFile],
        {
          encoding: 'utf8',
          shell: true,
        },
      );

      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    expect(fs.existsSync(tempFile)).toBe(false);
    expect(fs.existsSync(tempDir)).toBe(false);
  }, 60000);
});
