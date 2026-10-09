import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { seedDemo } from '../../scripts/seed-demo.mjs';
import { getStudioSettings } from '@/server/settings/repo';

describe('AC-6: Seed demo production safety guards', () => {
  let testDb: TestDatabaseInstance;
  const seedScript = path.resolve(import.meta.dirname, '../../scripts/seed-demo.mjs');

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  });

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-6: given NODE_ENV=production, refuses to run without --force-demo and writes nothing', async () => {
    const initial = await getStudioSettings(testDb.db);

    await expect(
      seedDemo({
        dbClient: testDb.db,
        nodeEnv: 'production',
        forceDemo: false,
      }),
    ).rejects.toThrow(/refused to run in production environment without explicit --force-demo/);

    // Verify database was untouched
    const current = await getStudioSettings(testDb.db);
    expect(current.studio_name).toBe(initial.studio_name);
    expect(current.updated_at.getTime()).toBe(initial.updated_at.getTime());
  });

  it('AC-6: given NODE_ENV=production with --force-demo, seeding succeeds', async () => {
    const result = await seedDemo({
      dbClient: testDb.db,
      nodeEnv: 'production',
      forceDemo: true,
      seed: 42,
    });

    expect(result.success).toBe(true);
    const persisted = await getStudioSettings(testDb.db);
    expect(persisted.studio_name).toBe('Lumière Photo & Film Studio');
  });

  it('AC-6: CLI execution with NODE_ENV=production and no --force-demo exits with non-zero code', () => {
    const res = spawnSync(process.execPath, [seedScript], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
      encoding: 'utf8',
    });

    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('FATAL: db:seed:demo refused to run in production');
  });
});
