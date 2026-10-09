import { describe, it, expect } from 'vitest';
import { validateUpdateStudioSettings, SettingsValidationError } from '@/server/settings/schema';

describe('AC-3: Studio settings Zod validation schema', () => {
  const validInput = {
    studio_name: 'Lichtblick Studio Berlin',
    default_locale: 'de' as const,
    timezone: 'Europe/Berlin',
    currency: 'EUR',
  };

  it('AC-3: parses valid studio settings input successfully', () => {
    const result = validateUpdateStudioSettings(validInput);
    expect(result).toEqual(validInput);
  });

  it('AC-3: rejects invalid time zone with SettingsValidationError', () => {
    const invalidInput = {
      ...validInput,
      timezone: 'Atlantis/NonExistent',
    };

    expect(() => validateUpdateStudioSettings(invalidInput)).toThrow(SettingsValidationError);

    try {
      validateUpdateStudioSettings(invalidInput);
    } catch (err) {
      expect(err).toBeInstanceOf(SettingsValidationError);
      const validationError = err as SettingsValidationError;
      expect(validationError.issues.some((i) => i.field === 'timezone')).toBe(true);
      expect(validationError.issues.some((i) => i.message.includes('time zone'))).toBe(true);
    }
  });

  it('AC-3: rejects unsupported locale with SettingsValidationError', () => {
    const invalidInput = {
      ...validInput,
      default_locale: 'fr',
    };

    expect(() => validateUpdateStudioSettings(invalidInput)).toThrow(SettingsValidationError);

    try {
      validateUpdateStudioSettings(invalidInput);
    } catch (err) {
      expect(err).toBeInstanceOf(SettingsValidationError);
      const validationError = err as SettingsValidationError;
      expect(validationError.issues.some((i) => i.field === 'default_locale')).toBe(true);
    }
  });

  it('AC-3: rejects unsupported or invalid currency code with SettingsValidationError', () => {
    const invalidInputs = [
      { ...validInput, currency: 'INVALID' },
      { ...validInput, currency: 'XX' },
      { ...validInput, currency: '123' },
    ];

    for (const input of invalidInputs) {
      expect(() => validateUpdateStudioSettings(input)).toThrow(SettingsValidationError);
    }
  });

  it('AC-3: rejects empty or blank studio name', () => {
    const invalidInput = {
      ...validInput,
      studio_name: '   ',
    };

    expect(() => validateUpdateStudioSettings(invalidInput)).toThrow(SettingsValidationError);
  });

  it('AC-3: rejects studio name exceeding 255 characters', () => {
    const invalidInput = {
      ...validInput,
      studio_name: 'A'.repeat(256),
    };

    expect(() => validateUpdateStudioSettings(invalidInput)).toThrow(SettingsValidationError);
  });

  it('AC-3: rejects non-object input with root field issue', () => {
    expect(() => validateUpdateStudioSettings('not-an-object')).toThrow(SettingsValidationError);
    try {
      validateUpdateStudioSettings('not-an-object');
    } catch (err) {
      expect(err).toBeInstanceOf(SettingsValidationError);
      const validationError = err as SettingsValidationError;
      expect(validationError.issues.some((i) => i.field === 'root')).toBe(true);
    }
  });
});
