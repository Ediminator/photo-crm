import { describe, it, expect, vi } from 'vitest';
import { safeCompareTokens } from '@/server/auth/setup';
import { hasRequiredScopes } from '@/server/auth/api-keys';
import {
  signOutAction,
  requestPasswordResetAction,
  resetPasswordAction,
} from '@/server/auth/actions';

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () =>
    Promise.resolve({
      get: () => null,
    }),
}));

describe('Auth Unit Branch Coverage', () => {
  describe('safeCompareTokens branches', () => {
    it('returns false when either argument is not a string', () => {
      expect(safeCompareTokens(null, 'valid')).toBe(false);
      expect(safeCompareTokens('valid', undefined)).toBe(false);
      expect(safeCompareTokens(123, 'valid')).toBe(false);
      expect(safeCompareTokens('valid', {})).toBe(false);
      expect(safeCompareTokens(null, null)).toBe(false);
    });

    it('returns false for length mismatches while executing equal work', () => {
      expect(safeCompareTokens('short', 'much_longer_string')).toBe(false);
      expect(safeCompareTokens('abc', 'abcd')).toBe(false);
    });

    it('returns true for identical strings and false for differing strings', () => {
      expect(safeCompareTokens('identical-token', 'identical-token')).toBe(true);
      expect(safeCompareTokens('identical-token-a', 'identical-token-b')).toBe(false);
    });
  });

  describe('API key hasRequiredScopes branches', () => {
    it('handles undefined or empty required scopes, wildcard, and matching sets', () => {
      expect(hasRequiredScopes(['clients:read'])).toBe(true);
      expect(hasRequiredScopes(['clients:read'], [])).toBe(true);
      expect(hasRequiredScopes(['*'], ['clients:read', 'settings:write'])).toBe(true);
      expect(hasRequiredScopes(['clients:read', 'clients:write'], ['clients:read'])).toBe(true);
      expect(hasRequiredScopes(['clients:read'], ['clients:write'])).toBe(false);
    });
  });

  describe('Server Actions edge cases and error handling', () => {
    it('signOutAction cleanly handles missing session cookie', async () => {
      const res = await signOutAction();
      expect(res.success).toBe(true);
    });

    it('requestPasswordResetAction returns failure when email format is invalid', async () => {
      const res = await requestPasswordResetAction({ email: 'not-an-email' });
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('resetPasswordAction returns failure when password violates policy', async () => {
      const res = await resetPasswordAction({
        email: 'user@example.com',
        token: 'any-token',
        newPassword: 'short',
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Password must be at least 12 characters long.');
    });
  });
});
