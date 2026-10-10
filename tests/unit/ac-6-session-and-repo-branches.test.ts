import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  getSessionCookieAttributes,
  verifySession,
  createSession,
  rotateSession,
  revokeSession,
  signOutEverywhere,
  SESSION_COOKIE_NAME,
  SECURE_SESSION_COOKIE_NAME,
} from '@/server/auth/session';
import { getStudioSettings, updateStudioSettings } from '@/server/settings/repo';
import type { DbClient } from '@/server/db/client';

describe('AC-6: session management branches', () => {
  it('getSessionCookieAttributes returns appropriate flags for prod and non-prod', () => {
    const devAttrs = getSessionCookieAttributes(false);
    expect(devAttrs.name).toBe(SESSION_COOKIE_NAME);
    expect(devAttrs.secure).toBe(false);
    expect(devAttrs.httpOnly).toBe(true);
    expect(devAttrs.sameSite).toBe('lax');

    const prodAttrs = getSessionCookieAttributes(true);
    expect(prodAttrs.name).toBe(SECURE_SESSION_COOKIE_NAME);
    expect(prodAttrs.secure).toBe(true);
  });

  it('verifySession returns null if token is empty or invalid type', async () => {
    expect(await verifySession('')).toBeNull();
    expect(await verifySession(null as unknown as string)).toBeNull();
    expect(await verifySession(undefined as unknown as string)).toBeNull();
  });

  it('verifySession returns row when found and null when not found', async () => {
    const mockRow = {
      session: { id: 's-1', token: 'valid-token' },
      user: { id: 'u-1', email: 'test@example.com' },
    };

    const mockClientWithMatch = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () => Promise.resolve([mockRow]),
            }),
          }),
        }),
      }),
    } as unknown as DbClient;

    const result = await verifySession('valid-token', mockClientWithMatch);
    expect(result).toEqual(mockRow);

    const mockClientNoMatch = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
    } as unknown as DbClient;

    expect(await verifySession('valid-token', mockClientNoMatch)).toBeNull();
  });

  it('createSession throws if insert returns empty array', async () => {
    const mockClientFailingInsert = {
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    } as unknown as DbClient;

    await expect(createSession('user-1', mockClientFailingInsert)).rejects.toThrow(
      'Failed to create session',
    );
  });

  it('rotateSession deletes old token if present, and creates a new session', async () => {
    let deletedToken: string | null = null;
    const newSessionRecord = {
      id: 's-new',
      userId: 'user-1',
      token: 'new-token-123',
      expiresAt: new Date(Date.now() + 100000),
    };

    const mockClient = {
      delete: () => ({
        where: vi.fn(() => {
          deletedToken = 'old-token';
          return Promise.resolve();
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([newSessionRecord]),
        }),
      }),
    } as unknown as DbClient;

    // With old token
    const res1 = await rotateSession('old-token', 'user-1', mockClient);
    expect(deletedToken).toBe('old-token');
    expect(res1.token).toBe('new-token-123');

    // Without old token
    deletedToken = null;
    const res2 = await rotateSession(null, 'user-1', mockClient);
    expect(deletedToken).toBeNull();
    expect(res2.token).toBe('new-token-123');
  });

  it('revokeSession returns early on empty token and deletes on valid token', async () => {
    let deleted = false;
    const mockClient = {
      delete: () => ({
        where: vi.fn(() => {
          deleted = true;
          return Promise.resolve();
        }),
      }),
    } as unknown as DbClient;

    await revokeSession('', mockClient);
    expect(deleted).toBe(false);

    await revokeSession('token-to-delete', mockClient);
    expect(deleted).toBe(true);
  });

  it('signOutEverywhere returns early on empty userId and deletes on valid userId', async () => {
    let deleted = false;
    const mockClient = {
      delete: () => ({
        where: vi.fn(() => {
          deleted = true;
          return Promise.resolve();
        }),
      }),
    } as unknown as DbClient;

    await signOutEverywhere('', mockClient);
    expect(deleted).toBe(false);

    await signOutEverywhere('u-123', mockClient);
    expect(deleted).toBe(true);
  });
});

describe('AC-3 & AC-8: studio settings repository branches', () => {
  it('getStudioSettings returns first record when present', async () => {
    const existing = {
      id: 'settings-1',
      studio_name: 'Existing Studio',
      default_locale: 'de' as const,
      timezone: 'Europe/Berlin',
      currency: 'EUR' as const,
      mfa_required: true,
      mfa_postponed_until: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockClient = {
      select: () => ({
        from: () => ({
          limit: () => Promise.resolve([existing]),
        }),
      }),
    } as unknown as DbClient;

    const result = await getStudioSettings(mockClient);
    expect(result).toEqual(existing);
  });

  it('getStudioSettings throws if default settings insert returns empty array', async () => {
    const mockClient = {
      select: () => ({
        from: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    } as unknown as DbClient;

    await expect(getStudioSettings(mockClient)).rejects.toThrow(
      'Failed to create default studio settings',
    );
  });

  it('updateStudioSettings sets mfa_required and mfa_postponed_until when defined', async () => {
    const current = {
      id: 'settings-1',
      studio_name: 'Studio',
      default_locale: 'en' as const,
      timezone: 'Europe/Berlin',
      currency: 'EUR' as const,
      mfa_required: false,
      mfa_postponed_until: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    let setPayload: Record<string, unknown> = {};

    const postponedDate = new Date(Date.now() + 86400000);

    const mockClient = {
      select: () => ({
        from: () => ({
          limit: () => Promise.resolve([current]),
        }),
      }),
      update: () => ({
        set: (payload: Record<string, unknown>) => {
          setPayload = payload;
          return {
            where: () => ({
              returning: () => Promise.resolve([{ ...current, ...payload }]),
            }),
          };
        },
      }),
    } as unknown as DbClient;

    const result = await updateStudioSettings(
      {
        studio_name: 'Updated Studio',
        default_locale: 'en',
        timezone: 'Europe/Berlin',
        currency: 'EUR',
        mfa_required: true,
        mfa_postponed_until: postponedDate,
      },
      mockClient,
    );

    expect(result.mfa_required).toBe(true);
    expect(setPayload.mfa_required).toBe(true);
    expect(setPayload.mfa_postponed_until).toEqual(postponedDate);
  });

  it('updateStudioSettings throws if update returns empty array', async () => {
    const current = {
      id: 'settings-1',
      studio_name: 'Studio',
      default_locale: 'en' as const,
      timezone: 'Europe/Berlin',
      currency: 'EUR' as const,
      mfa_required: false,
      mfa_postponed_until: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockClient = {
      select: () => ({
        from: () => ({
          limit: () => Promise.resolve([current]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      }),
    } as unknown as DbClient;

    await expect(
      updateStudioSettings(
        {
          studio_name: 'Updated Studio',
          default_locale: 'en',
          timezone: 'Europe/Berlin',
          currency: 'EUR',
        },
        mockClient,
      ),
    ).rejects.toThrow('Failed to update studio settings');
  });
});
