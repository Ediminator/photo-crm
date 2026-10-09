#!/usr/bin/env node
/**
 * check-i18n.mjs
 * Validates completeness, non-emptiness, and ICU syntax for localization catalogues.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@formatjs/icu-messageformat-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Recursively flattens a nested object into dotted keys.
 * @param {Record<string, unknown>} obj
 * @param {string} prefix
 * @returns {Record<string, string>}
 */
export function flattenKeys(obj, prefix = '') {
  const result = {};
  if (!obj || typeof obj !== 'object') return result;

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenKeys(value, fullKey));
    } else if (typeof value === 'string') {
      result[fullKey] = value;
    } else {
      result[fullKey] = String(value ?? '');
    }
  }

  return result;
}

/**
 * Validates whether a string is valid ICU message syntax.
 * @param {string} key
 * @param {string} message
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateIcuSyntax(key, message) {
  try {
    parse(message);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: `Invalid ICU syntax in key "${key}": ${err.message}`,
    };
  }
}

/**
 * Compares catalogues across locales and checks completeness, non-emptiness, and ICU syntax.
 * @param {Record<string, Record<string, unknown>>} catalogues
 * @returns {{ valid: boolean, errors: Array<{ type: 'MISSING_KEY' | 'EMPTY_VALUE' | 'MALFORMED_ICU', key: string, locale: string, message: string }>, keyCount: number }}
 */
export function compareLocaleCatalogues(catalogues) {
  const locales = Object.keys(catalogues);
  if (locales.length < 2) {
    return {
      valid: false,
      errors: [
        {
          type: 'MISSING_KEY',
          key: '*',
          locale: '*',
          message: 'At least two locales are required to compare catalogues.',
        },
      ],
      keyCount: 0,
    };
  }

  const flattened = {};
  const allKeys = new Set();

  for (const locale of locales) {
    flattened[locale] = flattenKeys(catalogues[locale] || {});
    for (const key of Object.keys(flattened[locale])) {
      allKeys.add(key);
    }
  }

  const errors = [];

  for (const key of Array.from(allKeys).sort()) {
    for (const locale of locales) {
      const val = flattened[locale]?.[key];

      // 1. Missing key
      if (val === undefined) {
        errors.push({
          type: 'MISSING_KEY',
          key,
          locale,
          message: `Key "${key}" is missing in locale "${locale}".`,
        });
        continue;
      }

      // 2. Empty value
      if (typeof val !== 'string' || val.trim().length === 0) {
        errors.push({
          type: 'EMPTY_VALUE',
          key,
          locale,
          message: `Key "${key}" in locale "${locale}" has an empty value.`,
        });
        continue;
      }

      // 3. Malformed ICU
      const icuCheck = validateIcuSyntax(key, val);
      if (!icuCheck.valid) {
        errors.push({
          type: 'MALFORMED_ICU',
          key,
          locale,
          message: `Key "${key}" in locale "${locale}" has malformed ICU message syntax: ${icuCheck.error}`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    keyCount: allKeys.size,
  };
}

// CLI entry point
if (process.argv[1] === __filename) {
  try {
    const messagesDir = path.resolve(__dirname, '../messages');
    if (!fs.existsSync(messagesDir)) {
      console.error(`Error: Messages directory not found at ${messagesDir}`);
      process.exit(1);
    }

    const enFile = path.join(messagesDir, 'en.json');
    const deFile = path.join(messagesDir, 'de.json');

    if (!fs.existsSync(enFile) || !fs.existsSync(deFile)) {
      console.error('Error: Both en.json and de.json must exist in messages/');
      process.exit(1);
    }

    const en = JSON.parse(fs.readFileSync(enFile, 'utf8'));
    const de = JSON.parse(fs.readFileSync(deFile, 'utf8'));

    const result = compareLocaleCatalogues({ en, de });

    if (!result.valid) {
      console.error(`i18n check FAILED with ${result.errors.length} issue(s):`);
      for (const err of result.errors) {
        console.error(`  - [${err.type}] (${err.locale}) ${err.message}`);
      }
      process.exit(1);
    }

    console.log(`i18n check PASSED: verified ${result.keyCount} keys across locales (en, de).`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to run i18n check:', err.message);
    process.exit(1);
  }
}
