/**
 * Locale-aware formatting helpers for currency, date, time, and numbers.
 */

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'OMR', 'TND']);

/**
 * Returns the standard ISO 4217 minor unit fraction digits for a given currency code.
 */
export function getCurrencyFractionDigits(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

export interface FormatCurrencyOptions extends Intl.NumberFormatOptions {
  preserveNonBreakingSpaces?: boolean;
}

/**
 * Formats an amount given in integer minor units (e.g., cents) into a localised currency string.
 *
 * Example:
 *   formatCurrency(123456, 'EUR', 'de-DE') -> '1.234,56 €'
 *   formatCurrency(123456, 'EUR', 'en-US') -> '€1,234.56'
 */
export function formatCurrency(
  minorUnits: number,
  currency = 'EUR',
  locale = 'en',
  options?: FormatCurrencyOptions,
): string {
  const decimals = getCurrencyFractionDigits(currency);
  const majorUnits = minorUnits / Math.pow(10, decimals);

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...options,
  });

  const formatted = formatter.format(majorUnits);
  if (options?.preserveNonBreakingSpaces) {
    return formatted;
  }
  // Normalise non-breaking space (U+00A0) and narrow no-break space (U+202F) to standard space
  return formatted.replace(/[\u00a0\u202F]/g, ' ');
}

export type DateInput = Date | string | number;

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

/**
 * Formats a date using Intl.DateTimeFormat.
 */
export function formatDate(
  date: DateInput,
  locale = 'en',
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(date);
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...options,
  };
  return new Intl.DateTimeFormat(locale, defaultOptions).format(d);
}

/**
 * Formats a date and time using Intl.DateTimeFormat.
 * Enforces 24-hour time format for German locales by default.
 */
export function formatDateTime(
  date: DateInput,
  locale = 'en',
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(date);
  const isGerman = locale.toLowerCase().startsWith('de');
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: isGerman ? false : options?.hour12,
    ...options,
  };

  const formatted = new Intl.DateTimeFormat(locale, defaultOptions).format(d);
  return formatted.replace(/[\u00a0\u202F]/g, ' ');
}

/**
 * Formats a number using Intl.NumberFormat.
 */
export function formatNumber(
  value: number,
  locale = 'en',
  options?: Intl.NumberFormatOptions,
): string {
  const formatted = new Intl.NumberFormat(locale, options).format(value);
  return formatted.replace(/[\u00a0\u202F]/g, ' ');
}
