import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-7: Architecture data-model conventions and privacy inventory documentation', () => {
  const dataModelDocPath = path.resolve(
    import.meta.dirname,
    '../../docs/architecture/data-model.md',
  );
  const dataInventoryDocPath = path.resolve(
    import.meta.dirname,
    '../../docs/privacy/data-inventory.md',
  );

  it('AC-7: docs/architecture/data-model.md exists and documents UUIDv7 conventions with rationale', () => {
    expect(fs.existsSync(dataModelDocPath)).toBe(true);
    const content = fs.readFileSync(dataModelDocPath, 'utf8');

    expect(content).toContain('UUIDv7');
    expect(content).toContain('RFC 9562');
    expect(content).toMatch(/B-Tree|locality|index/i);
    expect(content).toMatch(/no PII/i);
  });

  it('AC-7: docs/architecture/data-model.md documents UTC timestamptz timestamp conventions', () => {
    const content = fs.readFileSync(dataModelDocPath, 'utf8');

    expect(content).toContain('created_at');
    expect(content).toContain('updated_at');
    expect(content).toMatch(/timestamptz|timestamp with time zone/i);
    expect(content).toContain('UTC');
  });

  it('AC-7: docs/architecture/data-model.md documents integer minor units and ISO currency conventions', () => {
    const content = fs.readFileSync(dataModelDocPath, 'utf8');

    expect(content).toMatch(/integer|minor units|cents/i);
    expect(content).toContain('ISO 4217');
  });

  it('AC-7: docs/architecture/data-model.md documents GDPR hard delete policy and short undo window', () => {
    const content = fs.readFileSync(dataModelDocPath, 'utf8');

    expect(content).toMatch(/hard delete|GDPR|right to erasure|Article 17/i);
    expect(content).toMatch(/undo|deleted_at/i);
  });

  it('AC-7: docs/architecture/data-model.md documents explicit ON DELETE FK behaviour', () => {
    const content = fs.readFileSync(dataModelDocPath, 'utf8');

    expect(content).toContain('ON DELETE');
    expect(content).toContain('RESTRICT');
    expect(content).toContain('CASCADE');
  });

  it('AC-7: docs/privacy/data-inventory.md records studio_settings.studio_name as personal data of studio owner', () => {
    expect(fs.existsSync(dataInventoryDocPath)).toBe(true);
    const content = fs.readFileSync(dataInventoryDocPath, 'utf8');

    expect(content).toContain('studio_settings.studio_name');
    expect(content).toMatch(/sole trader/i);
    expect(content).toContain('Art. 6(1)');
  });
});
