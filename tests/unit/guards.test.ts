import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { extractBearerToken, requireAuth } from '@/server/auth/guards';
import type { DbClient } from '@/server/db/client';

describe('Authentication and authorization guards (guards.ts)', () => {
  describe('extractBearerToken', () => {
    it('extracts Bearer token from Headers instance', () => {
      const h = new Headers();
      h.set('authorization', 'Bearer pcrm_live_123456');
      expect(extractBearerToken(h)).toBe('pcrm_live_123456');
    });

    it('extracts Bearer token from plain Record with Authorization key', () => {
      expect(extractBearerToken({ Authorization: 'Bearer pcrm_live_654321' })).toBe(
        'pcrm_live_654321',
      );
    });

    it('returns null when header is absent, non-Bearer, or empty', () => {
      expect(extractBearerToken(undefined)).toBeNull();
      expect(extractBearerToken({})).toBeNull();
      expect(extractBearerToken({ authorization: 'Basic dXNlcjpwYXNz' })).toBeNull();
      expect(extractBearerToken({ authorization: 'Bearer' })).toBeNull();
    });
  });

  describe('requireAuth and requireOwner error branches', () => {
    it('throws UnauthorizedError when API key format is malformed', async () => {
      await expect(
        requireAuth({
          headers: { authorization: 'Bearer invalid_format_key' },
          client: {} as DbClient,
        }),
      ).rejects.toThrow('Malformed API key format.');
    });

    it('throws UnauthorizedError when neither API key nor session cookie is provided', async () => {
      await expect(
        requireAuth({
          headers: {},
          client: {} as DbClient,
        }),
      ).rejects.toThrow('Authentication required. No session or API key provided.');
    });

    it('extracts session cookie from headers object and throws when invalid', async () => {
      await expect(
        requireAuth({
          headers: { cookie: 'photo_crm_session=cookie-session-token' },
          client: {
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => ({
                    limit: () => [],
                  }),
                }),
              }),
            }),
          } as unknown as DbClient,
        }),
      ).rejects.toThrow('Invalid or expired session.');
    });
  });
});
