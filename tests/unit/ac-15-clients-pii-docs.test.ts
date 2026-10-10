import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CLIENT_PII_COLUMNS } from '@/server/clients/pii';

describe('AC-15: Clients Domain PII Inventory Completeness', () => {
  const dataInventoryPath = path.resolve(
    import.meta.dirname,
    '../../docs/privacy/data-inventory.md',
  );

  it('AC-15: every column listed in src/server/clients/pii.ts appears in docs/privacy/data-inventory.md with purpose, lawful basis, and retention', () => {
    expect(fs.existsSync(dataInventoryPath)).toBe(true);
    const content = fs.readFileSync(dataInventoryPath, 'utf8');

    expect(CLIENT_PII_COLUMNS.length).toBeGreaterThan(0);

    for (const column of CLIENT_PII_COLUMNS) {
      // 1. Column name must appear in the markdown register
      expect(
        content.includes(`\`${column}\``),
        `Column "${column}" from CLIENT_PII_COLUMNS missing from docs/privacy/data-inventory.md`,
      ).toBe(true);

      // 2. Find row corresponding to this column
      const rowRegex = new RegExp(
        `\\|\\s*\`${column.replace('.', '\\.')}\`\\s*\\|([^|]+)\\|([^|]+)\\|([^|]+)\\|`,
        'm',
      );
      const match = content.match(rowRegex);
      expect(
        match,
        `Column "${column}" must have a complete Markdown table row with purpose, lawful basis, and retention`,
      ).not.toBeNull();

      if (match) {
        const [, purpose, lawfulBasis, retention] = match;
        expect((purpose ?? '').trim().length, `Purpose missing for ${column}`).toBeGreaterThan(5);
        expect(
          (lawfulBasis ?? '').trim().length,
          `Lawful basis missing for ${column}`,
        ).toBeGreaterThan(5);
        expect((retention ?? '').trim().length, `Retention missing for ${column}`).toBeGreaterThan(
          5,
        );
      }
    }
  });
});
