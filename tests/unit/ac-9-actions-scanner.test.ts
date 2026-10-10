import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));

import { PUBLIC_AUTH_ACTIONS } from '@/server/auth/public-actions';
import { getOwnerSessionInfoAction, signOutEverywhereAction } from '@/server/auth/actions';
import { UnauthorizedError } from '@/server/auth/guards';

describe('AC-9: Server action protection and automated scanner', () => {
  it('AC-9: enumerates all server action modules and verifies each export calls requireOwner() or is explicitly allowlisted as public', () => {
    const serverDir = path.resolve(process.cwd(), 'src/server');
    const actionFiles: string[] = [];

    function findActionFiles(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findActionFiles(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name === 'actions.ts' || entry.name.endsWith('.actions.ts'))
        ) {
          actionFiles.push(fullPath);
        }
      }
    }

    findActionFiles(serverDir);
    expect(actionFiles.length).toBeGreaterThan(0);

    const publicAllowlistSet = new Set<string>(PUBLIC_AUTH_ACTIONS as readonly string[]);

    for (const filePath of actionFiles) {
      const content = fs.readFileSync(filePath, 'utf8');

      // Verify server-only and use server directives
      expect(content).toContain("'use server'");
      expect(content).toContain("'server-only'");

      // Find all exported async functions
      const exportMatches = [
        ...content.matchAll(/export\s+async\s+function\s+([a-zA-Z0-9_]+)\s*\(/g),
      ];

      for (const match of exportMatches) {
        const functionName = match[1];
        if (!functionName) continue;

        // If the action is in the public allowlist, it is permitted without requireOwner
        if (publicAllowlistSet.has(functionName)) {
          continue;
        }

        // Extract the function body from the file
        const functionStart = match.index;
        const functionSlice = content.slice(functionStart, functionStart + 1500);

        const guardsInvoked =
          functionSlice.includes('requireOwner(') || functionSlice.includes('requireAuth(');

        expect(
          guardsInvoked,
          `Server action "${functionName}" in ${path.relative(process.cwd(), filePath)} must invoke requireOwner() or requireAuth(), or be added to PUBLIC_AUTH_ACTIONS.`,
        ).toBe(true);
      }
    }
  });

  it('AC-9: unauthenticated invocation of protected server action rejects with UnauthorizedError and returns no data', async () => {
    await expect(getOwnerSessionInfoAction()).rejects.toThrow(UnauthorizedError);
    await expect(signOutEverywhereAction()).rejects.toThrow(UnauthorizedError);
  });
});
