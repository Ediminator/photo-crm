#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

console.warn(
  '\x1b[33m%s\x1b[0m',
  '⚠️  WARNING: Resetting development services will permanently DESTROY all PostgreSQL, Mailpit, and Object Storage data volumes!',
);

const result = spawnSync('docker compose -f compose.dev.yml down -v', {
  stdio: 'inherit',
  shell: true,
});

if (result.error) {
  if (result.error.message.includes('ENOENT')) {
    console.error('❌ Error: Docker CLI is not installed or not in PATH.');
  } else {
    console.error('❌ Error executing docker compose down -v:', result.error.message);
  }
  process.exit(1);
}

process.exit(result.status ?? 0);
