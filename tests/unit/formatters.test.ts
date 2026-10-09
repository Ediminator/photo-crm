import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  getCurrencyFractionDigits,
} from '@/lib/formatters';

describe('AC-6: Locale-aware formatters', () => {
  describe('formatCurrency', () => {
    it('AC-6: formats EUR minor units correctly in de-DE', () => {
      const result = formatCurrency(123456, 'EUR', 'de-DE');
      expect(result).toBe('1.234,56 €');
    });

    it('AC-6: formats EUR minor units correctly in en-US', () => {
      const result = formatCurrency(123456, 'EUR', 'en-US');
      expect(result).toBe('€1,234.56');
    });

    it('AC-6: formats USD minor units correctly in en-US', () => {
      const result = formatCurrency(123456, 'USD', 'en-US');
      expect(result).toBe('$1,234.56');
    });

    it('AC-6: formats GBP minor units correctly in en-GB', () => {
      const result = formatCurrency(123456, 'GBP', 'en-GB');
      expect(result).toBe('£1,234.56');
    });

    it('AC-6: handles zero and negative amounts in de-DE', () => {
      expect(formatCurrency(0, 'EUR', 'de-DE')).toBe('0,00 €');
      expect(formatCurrency(-5000, 'EUR', 'de-DE')).toBe('-50,00 €');
    });

    it('AC-6: handles zero-decimal currencies (JPY)', () => {
      expect(getCurrencyFractionDigits('JPY')).toBe(0);
      const res = formatCurrency(1500, 'JPY', 'ja-JP');
      expect(res).toContain('1,500');
    });

    it('AC-6: handles 3-decimal currencies (KWD)', () => {
      expect(getCurrencyFractionDigits('KWD')).toBe(3);
      const res = formatCurrency(123456, 'KWD', 'en-US');
      expect(res).toContain('123.456');
    });

    it('AC-6: preserveNonBreakingSpaces returns un-normalised NBSP', () => {
      const result = formatCurrency(123456, 'EUR', 'de-DE', {
        preserveNonBreakingSpaces: true,
      });
      // Should contain \u00a0 or \u202F
      expect(result).toMatch(/[\u00a0\u202F]/);
    });
  });

  describe('formatDate', () => {
    const fixedDate = new Date('2026-10-10T14:30:00Z');

    it('AC-6: formats date according to de-DE conventions', () => {
      const result = formatDate(fixedDate, 'de-DE', { timeZone: 'UTC' });
      expect(result).toBe('10.10.2026');
    });

    it('AC-6: formats date according to en-US conventions', () => {
      const result = formatDate(fixedDate, 'en-US', { timeZone: 'UTC' });
      expect(result).toBe('10/10/2026');
    });

    it('AC-6: accepts string or number timestamp', () => {
      const resultFromString = formatDate('2026-10-10T14:30:00Z', 'de-DE', { timeZone: 'UTC' });
      const resultFromNum = formatDate(fixedDate.getTime(), 'de-DE', { timeZone: 'UTC' });
      expect(resultFromString).toBe('10.10.2026');
      expect(resultFromNum).toBe('10.10.2026');
    });
  });

  describe('formatDateTime', () => {
    const fixedDate = new Date('2026-10-10T14:30:00Z');

    it('AC-6: renders 24-hour time for German locales (de-DE)', () => {
      const result = formatDateTime(fixedDate, 'de-DE', { timeZone: 'UTC' });
      expect(result).toBe('10.10.2026, 14:30');
      expect(result).not.toContain('PM');
      expect(result).not.toContain('AM');
    });

    it('AC-6: renders 12-hour time for en-US by default', () => {
      const result = formatDateTime(fixedDate, 'en-US', { timeZone: 'UTC' });
      expect(result).toBe('10/10/2026, 02:30 PM');
    });
  });

  describe('formatNumber', () => {
    it('AC-6: formats numbers with locale separators', () => {
      expect(formatNumber(1234.56, 'de-DE')).toBe('1.234,56');
      expect(formatNumber(1234.56, 'en-US')).toBe('1,234.56');
    });
  });
});
