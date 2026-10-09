import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock postgres client to test client creation without opening actual sockets
const mockSql = Object.assign(
  vi.fn(() => Promise.resolve([])),
  {
    end: vi.fn(() => Promise.resolve()),
    options: {
      parsers: {},
      serializers: {},
    },
  },
);

vi.mock('postgres', () => {
  return {
    default: vi.fn((_url: string, options: unknown) => {
      mockSql.options = { ...(options as object), parsers: {}, serializers: {} };
      return mockSql;
    }),
  };
});

import { createPostgresClient, getRawSql, getDb, rawSql, db } from '@/server/db/client';
import { studioSettings } from '@/server/db/schema';
import { isUuidV7 } from '@/lib/id';
import { resetEnvCache } from '@/env';

describe('Database client and schema helper', () => {
  const mockValidEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    AUTH_URL: 'http://localhost:3000',
    AUTH_SECRET: '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a',
    DATABASE_URL: 'postgres://photo_crm_app:password@127.0.0.1:5432/photo_crm_dev',
    STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
    STORAGE_PORT: '9000',
    STORAGE_REGION: 'us-east-1',
    STORAGE_ACCESS_KEY: 'valid_access_key_123',
    STORAGE_SECRET_KEY: '8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b',
    STORAGE_BUCKET_UPLOADS: 'photo-crm-uploads',
    STORAGE_USE_SSL: 'false',
  };

  beforeEach(() => {
    Object.assign(process.env, mockValidEnv);
    resetEnvCache();
  });

  it('createPostgresClient respects custom configuration options', () => {
    const client = createPostgresClient({
      url: 'postgres://test:pw@127.0.0.1:5432/test_db',
      maxConnections: 5,
      statementTimeout: 15,
      ssl: 'require',
    });

    expect(client).toBeDefined();
    expect((mockSql.options as { max?: number }).max).toBe(5);
    expect((mockSql.options as { timeout?: number }).timeout).toBe(15);
    expect((mockSql.options as { ssl?: unknown }).ssl).toBe('require');
  });

  it('createPostgresClient uses environment defaults when options are omitted', () => {
    const client = createPostgresClient();
    expect(client).toBeDefined();
  });

  it('getRawSql and getDb return singletons', () => {
    const raw1 = getRawSql();
    const raw2 = getRawSql();
    expect(raw1).toBe(raw2);

    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it('rawSql proxy forwards calls and property accesses', async () => {
    expect('end' in rawSql).toBe(true);
    expect(typeof rawSql.end).toBe('function');
    await rawSql`SELECT 1`;
  });

  it('db proxy forwards Drizzle query builders', () => {
    expect('select' in db).toBe(true);
    expect(typeof db.select).toBe('function');
  });

  it('studioSettings column defaultFn generates a valid UUIDv7', () => {
    const defaultFn = studioSettings.id.defaultFn;
    expect(defaultFn).toBeDefined();
    if (defaultFn) {
      const generated = defaultFn();
      expect(isUuidV7(generated)).toBe(true);
    }
  });
});
