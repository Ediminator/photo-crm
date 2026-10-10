import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('AC-1: Docker Compose dev configuration security and integrity', () => {
  const composePath = path.resolve(import.meta.dirname, '../../compose.dev.yml');

  it('AC-1: compose.dev.yml exists and has valid structure', () => {
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, 'utf8');
    expect(content).toContain('services:');
    expect(content).toContain('postgres:');
    expect(content).toContain('mailpit:');
    expect(content).toContain('storage:');
    expect(content).toContain('volumes:');
  });

  it('AC-1: compose.dev.yml contains zero hardcoded plaintext secrets or default passwords', () => {
    const content = fs.readFileSync(composePath, 'utf8');
    const lines = content.split('\n');

    const sensitiveKeyPattern = /(PASSWORD|SECRET|KEY|TOKEN)/i;

    for (const [index, rawLine] of lines.entries()) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      if (sensitiveKeyPattern.test(line)) {
        const lineNum = String(index + 1);
        // Line defines a sensitive key in environment:
        // Must use ${VAR...} interpolation and NOT a hardcoded fallback secret
        expect(
          line,
          `Line ${lineNum} appears to contain hardcoded secret without variable interpolation: "${line}"`,
        ).toMatch(/\$\{[A-Z0-9_]+/);

        // Disallow default fallback passwords like ${PASSWORD:-changeme}
        expect(
          line,
          `Line ${lineNum} contains an insecure fallback password default: "${line}"`,
        ).not.toMatch(/\$\{[A-Z0-9_]+:-/);
      }
    }
  });

  it('AC-1: all services have healthchecks defined with interval, timeout, and retries', () => {
    const content = fs.readFileSync(composePath, 'utf8');

    // All 3 services must declare healthcheck blocks
    const healthcheckCount = (content.match(/healthcheck:/g) ?? []).length;
    expect(healthcheckCount).toBe(3);

    // Verify healthcheck commands
    expect(content).toContain('pg_isready');
    expect(content).toContain('wget -q --spider http://127.0.0.1:8025');
    expect(content).toContain('curl -f http://127.0.0.1:9000/minio/health/live');

    // Verify interval and timeouts
    expect(content).toMatch(/interval:\s*5s/);
    expect(content).toMatch(/timeout:\s*5s/);
    expect(content).toMatch(/retries:\s*5/);
  });

  it('AC-1: all service images use strictly pinned version tags (no :latest)', () => {
    const content = fs.readFileSync(composePath, 'utf8');
    const imageMatches = [...content.matchAll(/image:\s*([^\s]+)/g)];

    expect(imageMatches.length).toBe(3);

    for (const match of imageMatches) {
      const image = match[1];
      expect(image).toBeDefined();
      expect(image).not.toContain(':latest');
      // Must contain a version tag
      expect(image).toMatch(/:[a-zA-Z0-9._-]+$/);
    }
  });

  it('AC-1: named volumes are declared for persistent service data', () => {
    const content = fs.readFileSync(composePath, 'utf8');

    expect(content).toContain('postgres_data:');
    expect(content).toContain('mailpit_data:');
    expect(content).toContain('minio_data:');
    expect(content).toContain('ownlight_postgres_data');
    expect(content).toContain('ownlight_mailpit_data');
    expect(content).toContain('ownlight_minio_data');
  });

  it('AC-1: docker compose config executes cleanly when docker is available', () => {
    const dockerCheck = spawnSync('docker compose version', { shell: true });
    if (dockerCheck.status !== 0) {
      // Docker is not installed in the current environment
      return;
    }

    const dummyEnv = {
      ...process.env,
      POSTGRES_PASSWORD: 'dummy_postgres_password_123',
      POSTGRES_APP_PASSWORD: 'dummy_app_password_123',
      POSTGRES_MIGRATOR_PASSWORD: 'dummy_migrator_password_123',
      STORAGE_ACCESS_KEY: 'dummy_storage_access_key',
      STORAGE_SECRET_KEY: 'dummy_storage_secret_key_123',
    };

    const result = spawnSync(`docker compose -f "${composePath}" config`, {
      env: dummyEnv,
      shell: true,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('services:');
  }, 15000);
});
