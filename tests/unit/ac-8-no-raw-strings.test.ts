import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsxFiles(fullPath));
    } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

interface Finding {
  text: string;
  line: number;
}

function findRawJsxText(sourceFile: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile).trim();
      // Ignore empty or whitespace-only nodes or avatar initials like 'PC'
      if (text.length > 0 && text !== 'PC') {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        findings.push({ text, line: line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

describe('AC-8: Shell UI components have zero unlocalized raw strings', () => {
  const targetDirs = [
    path.resolve(import.meta.dirname, '../../src/app/[locale]'),
    path.resolve(import.meta.dirname, '../../src/components/layout'),
    path.resolve(import.meta.dirname, '../../src/components/theme'),
    path.resolve(import.meta.dirname, '../../src/components/i18n'),
  ];

  it('AC-8: asserts that no raw JSX text strings exist outside translation catalogues in shell UI', () => {
    const files = targetDirs.flatMap((dir) => collectTsxFiles(dir));
    expect(files.length).toBeGreaterThan(5);

    const allFindings: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const sourceFile = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const findings = findRawJsxText(sourceFile);
      for (const finding of findings) {
        allFindings.push({
          file: path.relative(path.resolve(import.meta.dirname, '../..'), file),
          line: finding.line,
          text: finding.text,
        });
      }
    }

    if (allFindings.length > 0) {
      const message = allFindings
        .map((f) => `${f.file}:${String(f.line)} -> "${f.text}"`)
        .join('\n');
      expect.fail(`Found unlocalized raw JSX text in shell components:\n${message}`);
    }

    expect(allFindings).toEqual([]);
  });
});
