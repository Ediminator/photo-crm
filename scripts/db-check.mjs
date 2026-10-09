#!/usr/bin/env node
/**
 * scripts/db-check.mjs
 * Validates that migration files are intact (drizzle-kit check) and that the
 * schema definitions in src/server/db/schema have not drifted from committed migrations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const drizzleDir = path.resolve(rootDir, 'drizzle');
const metaDir = path.resolve(drizzleDir, 'meta');

/**
 * Checks for schema and migration drift.
 * @returns {{ valid: boolean, error?: string }}
 */
export function checkSchemaDrift() {
  if (!fs.existsSync(drizzleDir)) {
    return {
      valid: false,
      error: 'Migrations directory "drizzle/" does not exist. Run "pnpm db:generate" first.',
    };
  }

  // 1. Verify migration sequence integrity
  try {
    execSync('pnpm exec drizzle-kit check', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    return {
      valid: false,
      error: `Migration integrity check failed: ${err.message}`,
    };
  }

  // 2. Snapshot current migration directory
  const filesBefore = new Set(fs.readdirSync(drizzleDir));
  let journalBefore = '';
  const journalPath = path.resolve(metaDir, '_journal.json');
  if (fs.existsSync(journalPath)) {
    journalBefore = fs.readFileSync(journalPath, 'utf8');
  }

  let generateOutput = '';
  try {
    generateOutput = execSync('pnpm exec drizzle-kit generate', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    return {
      valid: false,
      error: `Failed to evaluate schema drift: ${err.message}`,
    };
  }

  // Clean up any files created by generate during drift check
  const filesAfter = fs.readdirSync(drizzleDir);
  let drifted = false;
  for (const file of filesAfter) {
    if (!filesBefore.has(file)) {
      drifted = true;
      const fullPath = path.resolve(drizzleDir, file);
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  }

  if (journalBefore && fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, journalBefore, 'utf8');
  }

  if (drifted || !generateOutput.includes('No schema changes, nothing to migrate')) {
    return {
      valid: false,
      error:
        'Schema drift detected: TypeScript schema in src/server/db/schema has uncommitted changes not reflected in drizzle/ migrations. Run "pnpm db:generate" and commit the migration files.',
    };
  }

  return { valid: true };
}

if (process.argv[1] === __filename) {
  const result = checkSchemaDrift();
  if (!result.valid) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }
  console.log('✅ Schema and migrations are in sync. No drift detected.');
  process.exit(0);
}
