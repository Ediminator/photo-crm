import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  escapeLikeWildcards,
  setClientTagsInputSchema,
  listClientsInputSchema,
} from '@/server/clients/schema';
import { validateAndSanitizeMetadata, AuditMetadataValidationError } from '@/server/audit';

describe('Unit: Tag schemas, LIKE wildcard escaping, and audit allowlist (AC-7, AC-8, AC-12)', () => {
  describe('escapeLikeWildcards (AC-7)', () => {
    it('AC-7: escapes percent symbol (%) with backslash', () => {
      expect(escapeLikeWildcards('100%')).toBe('100\\%');
      expect(escapeLikeWildcards('%')).toBe('\\%');
      expect(escapeLikeWildcards('10% and 20%')).toBe('10\\% and 20\\%');
    });

    it('AC-7: escapes underscore symbol (_) with backslash', () => {
      expect(escapeLikeWildcards('user_name')).toBe('user\\_name');
      expect(escapeLikeWildcards('_')).toBe('\\_');
      expect(escapeLikeWildcards('a_b_c')).toBe('a\\_b\\_c');
    });

    it('AC-7: escapes backslash symbol (\\) with backslash', () => {
      expect(escapeLikeWildcards('C:\\Users')).toBe('C:\\\\Users');
      expect(escapeLikeWildcards('\\')).toBe('\\\\');
    });

    it('AC-7: handles mixed metacharacters (%_\\) together in correct sequence', () => {
      expect(escapeLikeWildcards('100%\\_Studio_')).toBe('100\\%\\\\\\_Studio\\_');
    });

    it('AC-7: returns regular strings unaltered', () => {
      expect(escapeLikeWildcards('Anna Schmidt')).toBe('Anna Schmidt');
      expect(escapeLikeWildcards('')).toBe('');
      expect(escapeLikeWildcards('wedding-2026')).toBe('wedding-2026');
    });
  });

  describe('Validation schemas (AC-2, AC-8)', () => {
    const validClientId = '01912345-6789-7abc-8def-012345678901';

    it('AC-2: setClientTagsInputSchema rejects empty tag names and tags > 50 characters', () => {
      // Empty string
      const emptyRes = setClientTagsInputSchema.safeParse({
        clientId: validClientId,
        tagNames: ['Wedding', ''],
      });
      expect(emptyRes.success).toBe(false);

      // Whitespace only
      const wsRes = setClientTagsInputSchema.safeParse({
        clientId: validClientId,
        tagNames: ['   '],
      });
      expect(wsRes.success).toBe(false);

      // > 50 characters
      const longRes = setClientTagsInputSchema.safeParse({
        clientId: validClientId,
        tagNames: ['a'.repeat(51)],
      });
      expect(longRes.success).toBe(false);

      // 50 characters valid
      const exact50Res = setClientTagsInputSchema.safeParse({
        clientId: validClientId,
        tagNames: ['a'.repeat(50)],
      });
      expect(exact50Res.success).toBe(true);

      // Control characters rejected
      const ctrlRes = setClientTagsInputSchema.safeParse({
        clientId: validClientId,
        tagNames: ['Wedding\x00Tag'],
      });
      expect(ctrlRes.success).toBe(false);
    });

    it('AC-8: listClientsInputSchema rejects q > 100 characters and non-UUID tagId', () => {
      // 101 characters rejected
      const longQ = listClientsInputSchema.safeParse({
        q: 'a'.repeat(101),
      });
      expect(longQ.success).toBe(false);

      // 100 characters valid
      const exact100Q = listClientsInputSchema.safeParse({
        q: 'a'.repeat(100),
      });
      expect(exact100Q.success).toBe(true);

      // Non-UUID tagId rejected
      const badTagId = listClientsInputSchema.safeParse({
        tagId: 'not-a-uuid-string',
      });
      expect(badTagId.success).toBe(false);

      // Valid UUID tagId accepted
      const validTagId = listClientsInputSchema.safeParse({
        tagId: validClientId,
      });
      expect(validTagId.success).toBe(true);
    });
  });

  describe('Audit metadata allowlist (AC-12)', () => {
    it('AC-12: permits tag_count and created_tag_count for client.tags.changed', () => {
      const metadata = {
        tag_count: 5,
        created_tag_count: 2,
      };
      const result = validateAndSanitizeMetadata('client.tags.changed', 'owner', metadata);
      expect(result).toEqual(metadata);
    });

    it('AC-12: rejects tag names or search terms in client.tags.changed metadata', () => {
      expect(() => {
        validateAndSanitizeMetadata('client.tags.changed', 'owner', {
          tag_count: 1,
          created_tag_count: 1,
          tag_name: 'Wedding',
          q: 'test',
        });
      }).toThrow(AuditMetadataValidationError);
    });
  });
});
