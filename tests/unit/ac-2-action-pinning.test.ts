import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-2: Supply-chain action pinning and immutable references', () => {
  const workflowsDir = path.resolve(import.meta.dirname, '../../.github/workflows');
  const workflowFiles = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(workflowsDir, f));

  it('AC-2: at least one workflow exists', () => {
    expect(workflowFiles.length).toBeGreaterThanOrEqual(4);
  });

  it('AC-2: every third-party action is pinned to a 40-character commit SHA with version comment', () => {
    const unpinnedActions: string[] = [];
    const missingVersionComments: string[] = [];
    const usesRegex = /uses:\s*([^\s#]+)(.*)$/;

    for (const file of workflowFiles) {
      const relPath = path.basename(file);
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);

      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('- uses:') || trimmed.startsWith('uses:')) {
          const match = usesRegex.exec(trimmed);
          if (match) {
            const actionRef = match[1] ?? '';
            const comment = (match[2] ?? '').trim();

            if (!actionRef.startsWith('./')) {
              const atIndex = actionRef.indexOf('@');
              const lineNum = String(index + 1);
              if (atIndex === -1) {
                unpinnedActions.push(`${relPath}:${lineNum} -> ${actionRef}`);
              } else {
                const ref = actionRef.slice(atIndex + 1);
                if (!/^[0-9a-f]{40}$/i.test(ref)) {
                  unpinnedActions.push(`${relPath}:${lineNum} -> ${actionRef}`);
                }
                if (!comment.startsWith('#')) {
                  missingVersionComments.push(`${relPath}:${lineNum} -> ${actionRef}`);
                }
              }
            }
          }
        }
      });
    }

    expect(
      unpinnedActions,
      `Actions not pinned to 40-char SHA: ${unpinnedActions.join(', ')}`,
    ).toEqual([]);
    expect(
      missingVersionComments,
      `Actions missing version comments: ${missingVersionComments.join(', ')}`,
    ).toEqual([]);
  });

  it('AC-2: actions/checkout explicitly specifies persist-credentials: false', () => {
    for (const file of workflowFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('actions/checkout')) {
        expect(
          content,
          `actions/checkout in ${path.basename(file)} must set persist-credentials: false`,
        ).toContain('persist-credentials: false');
      }
    }
  });
});
