import { describe, it, expect } from 'vitest';
import { scanServerActions } from '../helpers/server-action-scanner';

describe('AC-3, AC-4, AC-5, AC-6, AC-7: AST-based server action scanner rules and fixtures', () => {
  it('AC-3: discovers non-actions-named file src/server/foo/helpers.ts starting with "use server" and flags unguarded export leak', () => {
    const virtualFiles = {
      'src/server/foo/helpers.ts': `
'use server';
import 'server-only';

export async function leak() {
  return 'sensitive data';
}
`,
    };

    const result = scanServerActions({
      virtualFiles,
      allowlist: [],
    });

    expect(result.discoveredFiles).toContain('src/server/foo/helpers.ts');
    const leakViolation = result.violations.find(
      (v) =>
        v.file === 'src/server/foo/helpers.ts' &&
        v.actionName === 'leak' &&
        v.type === 'UNGUARDED_ACTION',
    );
    expect(leakViolation).toBeDefined();
    expect(leakViolation?.message).toContain('leak');
    expect(leakViolation?.message).toContain('requireOwner');
  });

  it('AC-4: reports violations for double-quoted "use server", unguarded arrow function export, and unguarded re-export', () => {
    const virtualFiles = {
      'src/server/double-quotes.ts': `
"use server";
import 'server-only';

export const unguardedArrowAction = async () => {
  return 'data';
};
`,
      'src/server/reexports.ts': `
'use server';
import 'server-only';

export { unguardedHelper } from './helper-source';
`,
      'src/server/helper-source.ts': `
import 'server-only';

export async function unguardedHelper() {
  return 'no guard here';
}
`,
    };

    const result = scanServerActions({
      virtualFiles,
      allowlist: [],
    });

    expect(result.discoveredFiles).toContain('src/server/double-quotes.ts');
    expect(result.discoveredFiles).toContain('src/server/reexports.ts');

    // 1. Double quotes file discovered and arrow function violation reported
    const arrowViolation = result.violations.find(
      (v) =>
        v.file === 'src/server/double-quotes.ts' &&
        v.actionName === 'unguardedArrowAction' &&
        v.type === 'UNGUARDED_ACTION',
    );
    expect(arrowViolation).toBeDefined();

    // 2. Unguarded re-export violation reported
    const reexportViolation = result.violations.find(
      (v) =>
        v.file === 'src/server/reexports.ts' &&
        v.actionName === 'unguardedHelper' &&
        v.type === 'UNGUARDED_REEXPORT',
    );
    expect(reexportViolation).toBeDefined();
  });

  it('AC-5: flags an unguarded short action followed within 1,500 characters by a guarded action', () => {
    const virtualFiles = {
      'src/server/proximity.actions.ts': `
'use server';
import 'server-only';
import { requireOwner } from '@/server/auth/guards';

// Very short unguarded action
export async function shortUnguarded() {
  return 123;
}

// Guarded action located within 100 characters (< 1,500 chars)
export async function laterGuarded() {
  await requireOwner();
  return 'guarded';
}
`,
    };

    const result = scanServerActions({
      virtualFiles,
      allowlist: [],
    });

    const shortViolation = result.violations.find(
      (v) =>
        v.file === 'src/server/proximity.actions.ts' &&
        v.actionName === 'shortUnguarded' &&
        v.type === 'UNGUARDED_ACTION',
    );
    expect(shortViolation).toBeDefined();

    // The guarded action should NOT be flagged
    const guardedViolation = result.violations.find(
      (v) => v.file === 'src/server/proximity.actions.ts' && v.actionName === 'laterGuarded',
    );
    expect(guardedViolation).toBeUndefined();
  });

  it('AC-6: reports violation for an inline "use server" directive inside a function body under src/app/', () => {
    const virtualFiles = {
      'src/app/components/ClientForm.tsx': `
export function ClientForm() {
  async function handleSubmit() {
    'use server';
    // Inline server actions in components are forbidden
    return null;
  }

  return <form action={handleSubmit} />;
}
`,
    };

    const result = scanServerActions({
      virtualFiles,
      allowlist: [],
    });

    const inlineViolation = result.violations.find(
      (v) => v.file === 'src/app/components/ClientForm.tsx' && v.type === 'INLINE_USE_SERVER',
    );
    expect(inlineViolation).toBeDefined();
    expect(inlineViolation?.message).toContain("Inline 'use server' directive");
  });

  it('AC-7: permits guarded actions and allowlisted names, and reports stale allowlist entry', () => {
    const virtualFiles = {
      'src/server/auth/actions.ts': `
'use server';
import 'server-only';
import { requireOwner } from './guards';

export async function allowlistedAction() {
  // Public allowlisted action
  return 'public';
}

export async function guardedAction() {
  await requireOwner();
  return 'owner only';
}
`,
    };

    const allowlist = ['allowlistedAction', 'staleUnusedAction'];

    const result = scanServerActions({
      virtualFiles,
      allowlist,
    });

    // Guarded and allowlisted actions have no violations
    const actionViolations = result.violations.filter(
      (v) => v.file === 'src/server/auth/actions.ts',
    );
    expect(actionViolations).toHaveLength(0);

    // Stale allowlist entry is flagged
    const staleViolation = result.violations.find(
      (v) => v.actionName === 'staleUnusedAction' && v.type === 'STALE_ALLOWLIST_ENTRY',
    );
    expect(staleViolation).toBeDefined();
    expect(staleViolation?.message).toContain('staleUnusedAction');
  });
});
