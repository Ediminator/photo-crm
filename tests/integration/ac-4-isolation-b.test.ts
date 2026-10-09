import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import { getStudioSettings, updateStudioSettings } from '@/server/settings/repo';

describe('AC-4: Parallel integration test isolation (File B)', () => {
  let testDb: TestDatabaseInstance;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
  }, 30000);

  afterEach(async () => {
    await testDb.destroy();
  });

  it('AC-4: File B writes isolated data and does not observe File A writes', async () => {
    // Write unique tenant data for File B
    await updateStudioSettings(
      {
        studio_name: 'Isolated Studio File Beta',
        default_locale: 'de',
        timezone: 'Europe/Zurich',
        currency: 'CHF',
      },
      testDb.db,
    );

    // Artificial delay to allow interleaved execution with File A in parallel
    await new Promise((resolve) => setTimeout(resolve, 50));

    const settings = await getStudioSettings(testDb.db);
    expect(settings.studio_name).toBe('Isolated Studio File Beta');
    expect(settings.currency).toBe('CHF');
    expect(settings.studio_name).not.toBe('Isolated Studio File Alpha');
  });
});
