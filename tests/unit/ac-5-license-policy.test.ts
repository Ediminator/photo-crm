import { describe, it, expect } from 'vitest';
import { evaluateLicense, checkLicenses } from '../../scripts/check-licenses.mjs';

describe('AC-5: License policy evaluation', () => {
  const samplePolicy = {
    allowedLicenses: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'CC0-1.0'],
    exceptions: {
      'special-legacy-pkg': {
        license: 'CC-BY-3.0',
        reason: 'Legacy data asset permitted under CC-BY-3.0 exception',
      },
    },
  };

  it('AC-5: allows dependencies with exact permitted licenses in allowlist', () => {
    const mitResult = evaluateLicense('foo-pkg', 'MIT', samplePolicy);
    expect(mitResult.allowed).toBe(true);
    expect(mitResult.status).toBe('ALLOWED');

    const apacheResult = evaluateLicense('bar-pkg', 'Apache-2.0', samplePolicy);
    expect(apacheResult.allowed).toBe(true);
    expect(apacheResult.status).toBe('ALLOWED');
  });

  it('AC-5: allows dependencies covered by explicit policy exceptions', () => {
    const result = evaluateLicense('special-legacy-pkg', 'CC-BY-3.0', samplePolicy);
    expect(result.allowed).toBe(true);
    expect(result.status).toBe('EXCEPTION');
    expect(result.reason).toContain('Legacy data asset permitted');
  });

  it('AC-5: rejects dependencies with prohibited or unapproved licenses', () => {
    const gplResult = evaluateLicense('copyleft-pkg', 'GPL-2.0-only', samplePolicy);
    expect(gplResult.allowed).toBe(false);
    expect(gplResult.status).toBe('DENIED');
    expect(gplResult.reason).toContain('not permitted');

    const commercialResult = evaluateLicense('proprietary-pkg', 'Commercial', samplePolicy);
    expect(commercialResult.allowed).toBe(false);
    expect(commercialResult.status).toBe('DENIED');
  });

  it('AC-5: rejects dependencies with unknown, empty, or missing licenses', () => {
    const unknownResult = evaluateLicense('unspecified-pkg', 'UNKNOWN', samplePolicy);
    expect(unknownResult.allowed).toBe(false);
    expect(unknownResult.status).toBe('UNKNOWN');

    const emptyResult = evaluateLicense('empty-lic-pkg', '', samplePolicy);
    expect(emptyResult.allowed).toBe(false);
    expect(emptyResult.status).toBe('UNKNOWN');

    const nullResult = evaluateLicense('null-lic-pkg', null, samplePolicy);
    expect(nullResult.allowed).toBe(false);
    expect(nullResult.status).toBe('UNKNOWN');
  });

  it('AC-5: correctly handles compound OR and AND license expressions', () => {
    const orResult = evaluateLicense('dual-pkg', '(MIT OR GPL-2.0-only)', samplePolicy);
    expect(orResult.allowed).toBe(true);
    expect(orResult.status).toBe('ALLOWED');

    const andAllowed = evaluateLicense('multi-pkg', 'MIT AND Apache-2.0', samplePolicy);
    expect(andAllowed.allowed).toBe(true);

    const andDenied = evaluateLicense('mixed-pkg', 'MIT AND Proprietary', samplePolicy);
    expect(andDenied.allowed).toBe(false);
    expect(andDenied.status).toBe('DENIED');
  });

  it('AC-5: evaluates full dataset and reports violations accurately', () => {
    const licenseData = {
      MIT: [{ name: 'safe-pkg-1' }, { name: 'safe-pkg-2' }],
      'CC-BY-3.0': [{ name: 'special-legacy-pkg' }],
      'GPL-2.0-only': [{ name: 'rogue-pkg' }],
    };

    const report = checkLicenses(licenseData, samplePolicy);
    expect(report.valid).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.name).toBe('rogue-pkg');
    expect(report.violations[0]?.status).toBe('DENIED');
  });
});
