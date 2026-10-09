import { describe, it, expect } from 'vitest';
import {
  flattenKeys,
  validateIcuSyntax,
  compareLocaleCatalogues,
} from '../../scripts/check-i18n.mjs';

describe('AC-6: i18n completeness and ICU syntax validator', () => {
  it('AC-6: passes when both locales are complete, non-empty, and have valid ICU', () => {
    const en = {
      greeting: 'Hello, {name}!',
      app: {
        title: 'Studio CRM',
        counts: 'You have {count, plural, one {# shoot} other {# shoots}} scheduled.',
      },
    };
    const de = {
      greeting: 'Hallo, {name}!',
      app: {
        title: 'Studio CRM',
        counts: 'Sie haben {count, plural, one {# Termin} other {# Termine}} geplant.',
      },
    };

    const result = compareLocaleCatalogues({ en, de });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.keyCount).toBe(3);
  });

  it('AC-6: detects and names missing keys in either locale', () => {
    const en = {
      common: {
        save: 'Save',
        cancel: 'Cancel',
      },
    };
    const de = {
      common: {
        save: 'Speichern',
        // 'cancel' is missing in de
      },
    };

    const result = compareLocaleCatalogues({ en, de });
    expect(result.valid).toBe(false);
    const missing = result.errors.find((e) => e.type === 'MISSING_KEY');
    expect(missing).toBeDefined();
    expect(missing?.key).toBe('common.cancel');
    expect(missing?.locale).toBe('de');
    expect(missing?.message).toContain('Key "common.cancel" is missing in locale "de"');
  });

  it('AC-6: detects and names empty or whitespace-only values in either locale', () => {
    const en = {
      emptyKey: '  ',
    };
    const de = {
      emptyKey: 'Gültig',
    };

    const result = compareLocaleCatalogues({ en, de });
    expect(result.valid).toBe(false);
    const emptyErr = result.errors.find((e) => e.type === 'EMPTY_VALUE');
    expect(emptyErr).toBeDefined();
    expect(emptyErr?.key).toBe('emptyKey');
    expect(emptyErr?.locale).toBe('en');
    expect(emptyErr?.message).toContain('Key "emptyKey" in locale "en" has an empty value');
  });

  it('AC-6: detects and names malformed ICU message syntax', () => {
    const en = {
      broken: 'Unclosed bracket {name',
    };
    const de = {
      broken: 'Nicht geschlossene Klammer {name',
    };

    const result = compareLocaleCatalogues({ en, de });
    expect(result.valid).toBe(false);
    const icuErrors = result.errors.filter((e) => e.type === 'MALFORMED_ICU');
    expect(icuErrors.length).toBeGreaterThanOrEqual(1);
    expect(icuErrors[0]?.key).toBe('broken');
    expect(icuErrors[0]?.message).toContain('malformed ICU message syntax');
  });

  it('AC-6: correctly flattens deeply nested translation keys', () => {
    const nested = {
      level1: {
        level2: {
          key: 'value',
        },
      },
    };

    const flat = flattenKeys(nested);
    expect(flat).toEqual({ 'level1.level2.key': 'value' });
  });

  it('AC-6: validateIcuSyntax handles both valid and invalid patterns', () => {
    expect(validateIcuSyntax('test.valid', 'Hello {name}').valid).toBe(true);
    expect(
      validateIcuSyntax('test.plural', '{count, plural, one {# item} other {# items}}').valid,
    ).toBe(true);

    const broken = validateIcuSyntax('test.broken', 'Missing { bracket');
    expect(broken.valid).toBe(false);
    expect(broken.error).toContain('Invalid ICU syntax in key "test.broken"');
  });
});
