#!/usr/bin/env node
/**
 * scripts/db-check.mjs
 * Validates that migration files are intact (drizzle-kit check) and that the
 * schema definitions in src/server/db/schema have not drifted from committed migrations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const drizzleDir = path.resolve(rootDir, 'drizzle');
const metaDir = path.resolve(drizzleDir, 'meta');

/**
 * Checks for schema and migration drift.
 * @param {object} [options]
 * @param {string} [options.rootDir]
 * @param {string} [options.drizzleDir]
 * @param {string} [options.config]
 * @returns {{ valid: boolean, error?: string }}
 */
export function checkSchemaDrift(options = {}) {
  const targetRootDir = options.rootDir || rootDir;
  const targetDrizzleDir = options.drizzleDir || path.resolve(targetRootDir, 'drizzle');
  const targetMetaDir = path.resolve(targetDrizzleDir, 'meta');
  if (!fs.existsSync(targetDrizzleDir)) {
    return {
      valid: false,
      error: `Migrations directory "${targetDrizzleDir}" does not exist. Run "pnpm db:generate" first.`,
    };
  }

  const drizzleKitBin = path.resolve(targetRootDir, 'node_modules/drizzle-kit/bin.cjs');
  const checkArgs = [drizzleKitBin, 'check'];
  if (options.config && typeof options.config === 'string') {
    checkArgs.push(`--config=${options.config}`);
  }

  // 1. Verify migration sequence integrity
  try {
    execFileSync(process.execPath, checkArgs, {
      cwd: targetRootDir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    return {
      valid: false,
      error: `Migration integrity check failed: ${err.message}`,
    };
  }

  // 2. Snapshot current migration directory and meta directory
  const filesBefore = new Set(fs.readdirSync(targetDrizzleDir));
  const metaFilesBefore = fs.existsSync(targetMetaDir)
    ? new Set(fs.readdirSync(targetMetaDir))
    : new Set();
  let journalBefore = '';
  const journalPath = path.resolve(targetMetaDir, '_journal.json');
  if (fs.existsSync(journalPath)) {
    journalBefore = fs.readFileSync(journalPath, 'utf8');
  }

  const generateArgs = [drizzleKitBin, 'generate'];
  if (options.config && typeof options.config === 'string') {
    generateArgs.push(`--config=${options.config}`);
  }

  let generateOutput = '';
  try {
    generateOutput = execFileSync(process.execPath, generateArgs, {
      cwd: targetRootDir,
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
  const filesAfter = fs.readdirSync(targetDrizzleDir);
  let drifted = false;
  for (const file of filesAfter) {
    if (!filesBefore.has(file)) {
      drifted = true;
      const fullPath = path.resolve(targetDrizzleDir, file);
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  }

  // Clean up any new snapshot files created in meta during drift check
  if (fs.existsSync(targetMetaDir)) {
    const metaFilesAfter = fs.readdirSync(targetMetaDir);
    for (const file of metaFilesAfter) {
      if (!metaFilesBefore.has(file)) {
        drifted = true;
        try {
          fs.rmSync(path.resolve(targetMetaDir, file), { recursive: true, force: true });
        } catch {
          // ignore cleanup error
        }
      }
    }
  }

  if (journalBefore) {
    try {
      fs.writeFileSync(journalPath, journalBefore, 'utf8');
    } catch {
      // ignore cleanup error
    }
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
  let config;
  let drizzleDirArg;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--config=')) {
      config = arg.slice('--config='.length);
    }
    if (arg.startsWith('--drizzle-dir=')) {
      drizzleDirArg = arg.slice('--drizzle-dir='.length);
    }
  }
  const configIdx = process.argv.indexOf('--config');
  if (!config && configIdx !== -1 && process.argv[configIdx + 1]) {
    config = process.argv[configIdx + 1];
  }
  const drizzleDirIdx = process.argv.indexOf('--drizzle-dir');
  if (!drizzleDirArg && drizzleDirIdx !== -1 && process.argv[drizzleDirIdx + 1]) {
    drizzleDirArg = process.argv[drizzleDirIdx + 1];
  }

  const result = checkSchemaDrift({ config, drizzleDir: drizzleDirArg });
  if (!result.valid) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }
  console.log('✅ Schema and migrations are in sync. No drift detected.');
  process.exit(0);
}
