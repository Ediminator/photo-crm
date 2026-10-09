import { z } from 'zod';

/**
 * Cached set of valid IANA time zone identifiers supported by the runtime Intl implementation.
 */
const SUPPORTED_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

/**
 * Cached set of valid ISO 4217 currency codes supported by the runtime Intl implementation.
 */
const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

/**
 * Structured validation error thrown when studio settings input fails schema rules.
 */
export class SettingsValidationError extends Error {
  public readonly issues: readonly { field: string; message: string }[];

  constructor(issues: readonly { field: string; message: string }[]) {
    const formatted = issues.map((i) => `  - ${i.field}: ${i.message}`).join('\n');
    super(`Studio settings validation failed:\n${formatted}`);
    this.name = 'SettingsValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

export const updateStudioSettingsSchema = z
  .object({
    studio_name: z
      .string({ required_error: 'Studio name is required.' })
      .trim()
      .min(1, { message: 'Studio name cannot be empty.' })
      .max(255, { message: 'Studio name must not exceed 255 characters.' }),
    default_locale: z.enum(['en', 'de'], {
      errorMap: () => ({ message: 'Locale must be either "en" or "de".' }),
    }),
    timezone: z
      .string({ required_error: 'Time zone is required.' })
      .trim()
      .refine((val) => SUPPORTED_TIMEZONES.has(val), {
        message: 'Invalid IANA time zone identifier.',
      }),
    currency: z
      .string({ required_error: 'Currency is required.' })
      .trim()
      .refine((val) => SUPPORTED_CURRENCIES.has(val), {
        message: 'Invalid ISO 4217 currency code.',
      }),
  })
  .strict();

export type UpdateStudioSettingsInput = z.infer<typeof updateStudioSettingsSchema>;

/**
 * Validates unknown input against the updateStudioSettingsSchema.
 * Throws a typed SettingsValidationError if validation fails.
 */
export function validateUpdateStudioSettings(input: unknown): UpdateStudioSettingsInput {
  const result = updateStudioSettingsSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'root',
      message: issue.message,
    }));
    throw new SettingsValidationError(issues);
  }
  return result.data;
}
