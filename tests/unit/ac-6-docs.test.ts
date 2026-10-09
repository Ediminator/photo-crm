import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-6: Local development documentation completeness', () => {
  const docsPath = path.resolve(import.meta.dirname, '../../docs/operations/local-development.md');

  it('AC-6: docs/operations/local-development.md exists and is readable', () => {
    expect(fs.existsSync(docsPath)).toBe(true);
    const content = fs.readFileSync(docsPath, 'utf8');
    expect(content.length).toBeGreaterThan(500);
  });

  it('AC-6: documents service startup, Mailpit access, and storage console access', () => {
    const content = fs.readFileSync(docsPath, 'utf8');

    // Service startup command
    expect(content).toContain('pnpm services:up');

    // Mailpit web UI port and URL
    expect(content).toMatch(/8025/);
    expect(content).toMatch(/Mailpit/i);

    // Storage console (MinIO) port and URL
    expect(content).toMatch(/9001/);
    expect(content).toMatch(/MinIO/i);

    // Storage S3 API port
    expect(content).toMatch(/9000/);
  });

  it('AC-6: documents database role separation (photo_crm_app vs photo_crm_migrator)', () => {
    const content = fs.readFileSync(docsPath, 'utf8');

    expect(content).toContain('photo_crm_app');
    expect(content).toContain('photo_crm_migrator');
    expect(content).toMatch(/least-privilege/i);
    expect(content).toMatch(/denied DDL|cannot CREATE/i);
  });

  it('AC-6: includes dedicated guide for Synology NAS Docker setup via .env.local', () => {
    const content = fs.readFileSync(docsPath, 'utf8');

    expect(content).toMatch(/Synology/i);
    expect(content).toContain('.env.local');
    expect(content).toMatch(/DATABASE_URL=/);
    expect(content).toMatch(/STORAGE_ENDPOINT=/);
  });

  it('AC-6: documents full lifecycle commands (up, down, reset, logs)', () => {
    const content = fs.readFileSync(docsPath, 'utf8');

    expect(content).toContain('pnpm services:up');
    expect(content).toContain('pnpm services:down');
    expect(content).toContain('pnpm services:reset');
    expect(content).toContain('pnpm services:logs');
  });
});
