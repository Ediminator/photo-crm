import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

interface PortMapping {
  raw: string;
  hostIp: string;
  hostPort: string;
  containerPort: string;
}

export function parseComposePortString(portStr: string): PortMapping {
  const trimmed = portStr.replace(/['"]/g, '').trim();

  // Pattern with host_ip:host_port:container_port
  // host_port can contain ${VAR:-default}
  const threePartMatch = /^([^:]+):(.+):([^:]+)$/.exec(trimmed);
  if (threePartMatch) {
    return {
      raw: trimmed,
      hostIp: threePartMatch[1] ?? '',
      hostPort: threePartMatch[2] ?? '',
      containerPort: threePartMatch[3] ?? '',
    };
  }

  const twoPartMatch = /^(.+):([^:]+)$/.exec(trimmed);
  if (twoPartMatch) {
    return {
      raw: trimmed,
      hostIp: '',
      hostPort: twoPartMatch[1] ?? '',
      containerPort: twoPartMatch[2] ?? '',
    };
  }

  return {
    raw: trimmed,
    hostIp: '',
    hostPort: '',
    containerPort: trimmed,
  };
}

describe('AC-2: Port binding security (strict 127.0.0.1 localhost isolation)', () => {
  const composePath = path.resolve(import.meta.dirname, '../../compose.dev.yml');

  it('AC-2: every published port in compose.dev.yml binds strictly to 127.0.0.1', () => {
    const content = fs.readFileSync(composePath, 'utf8');
    const portLines: string[] = [];

    let inPortsBlock = false;
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('ports:')) {
        inPortsBlock = true;
        continue;
      }

      if (inPortsBlock) {
        if (line.startsWith('-')) {
          portLines.push(line.replace(/^-\s*/, ''));
        } else if (line.length > 0 && !line.startsWith('#')) {
          inPortsBlock = false;
        }
      }
    }

    expect(portLines.length).toBeGreaterThanOrEqual(5);

    for (const portEntry of portLines) {
      const parsed = parseComposePortString(portEntry);

      // Must explicitly declare 127.0.0.1 host IP
      expect(parsed.hostIp, `Port mapping "${portEntry}" does not specify 127.0.0.1 host IP`).toBe(
        '127.0.0.1',
      );

      // Never bind to all interfaces (0.0.0.0)
      expect(parsed.hostIp, `Port mapping "${portEntry}" must never bind to 0.0.0.0`).not.toBe(
        '0.0.0.0',
      );

      // Raw entry must start with 127.0.0.1
      expect(
        portEntry.replace(/['"]/g, ''),
        `Port entry "${portEntry}" must start with 127.0.0.1:`,
      ).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('AC-2: covers all expected dev services on 127.0.0.1 (Postgres, Mailpit, MinIO)', () => {
    const content = fs.readFileSync(composePath, 'utf8');

    // Postgres default 5432
    expect(content).toMatch(/127\.0\.0\.1:\$\{POSTGRES_PORT:-5432\}:5432/);

    // Mailpit SMTP 1025 and Web UI 8025
    expect(content).toMatch(/127\.0\.0\.1:\$\{MAILPIT_SMTP_PORT:-1025\}:1025/);
    expect(content).toMatch(/127\.0\.0\.1:\$\{MAILPIT_HTTP_PORT:-8025\}:8025/);

    // MinIO S3 API 9000 and Console 9001
    expect(content).toMatch(/127\.0\.0\.1:\$\{MINIO_PORT:-9000\}:9000/);
    expect(content).toMatch(/127\.0\.0\.1:\$\{MINIO_CONSOLE_PORT:-9001\}:9001/);
  });

  it('AC-2: verifies resolved docker compose config binds all published ports to host_ip 127.0.0.1 when docker is present', () => {
    const dockerCheck = spawnSync('docker compose version', { shell: true });
    if (dockerCheck.status !== 0) {
      // Docker is not installed on this host environment
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

    const result = spawnSync(`docker compose -f "${composePath}" config --format json`, {
      env: dummyEnv,
      shell: true,
      encoding: 'utf8',
    });

    if (result.status === 0 && result.stdout) {
      const parsedConfig = JSON.parse(result.stdout) as {
        services?: Record<
          string,
          { ports?: { host_ip?: string; published?: string; target?: number }[] }
        >;
      };

      const services = parsedConfig.services ?? {};
      for (const [serviceName, service] of Object.entries(services)) {
        for (const port of service.ports ?? []) {
          const hostIp = port.host_ip ?? 'missing';
          expect(
            port.host_ip,
            `Service ${serviceName} published port on non-localhost IP ${hostIp}`,
          ).toBe('127.0.0.1');
        }
      }
    }
  }, 15000);
});
