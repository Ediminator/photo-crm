import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface JobMeta {
  hasTimeout: boolean;
  hasPermissions: boolean;
}

describe('AC-3: Least-privilege workflow permissions and job timeouts', () => {
  const workflowsDir = path.resolve(import.meta.dirname, '../../.github/workflows');
  const workflowFiles = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(workflowsDir, f));

  it('AC-3: every workflow has a top-level permissions: {} block granting zero privileges by default', () => {
    for (const file of workflowFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);
      const hasTopLevelEmptyPermissions = lines.some((l) => l.trim() === 'permissions: {}');
      expect(
        hasTopLevelEmptyPermissions,
        `${path.basename(file)} must define top-level permissions: {}`,
      ).toBe(true);
    }
  });

  it('AC-3: every job declares an explicit permissions block and timeout-minutes', () => {
    const jobRegex = /^ {2}([a-zA-Z0-9_-]+):/;
    const timeoutRegex = /^\s+timeout-minutes:\s*\d+/;
    const permissionsRegex = /^\s+permissions:/;

    for (const file of workflowFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);

      let inJobs = false;
      let currentJob: string | null = null;
      const jobs = new Map<string, JobMeta>();

      for (const line of lines) {
        const indent = line.search(/\S/);

        if (indent === 0 && line.startsWith('jobs:')) {
          inJobs = true;
          continue;
        }
        if (inJobs && indent === 0 && line.length > 0 && !line.startsWith('jobs:')) {
          inJobs = false;
        }

        if (inJobs && indent === 2) {
          const match = jobRegex.exec(line);
          if (match?.[1]) {
            currentJob = match[1];
            jobs.set(currentJob, {
              hasTimeout: false,
              hasPermissions: false,
            });
          }
        }

        if (inJobs && currentJob) {
          const meta = jobs.get(currentJob);
          if (meta) {
            if (timeoutRegex.test(line)) {
              meta.hasTimeout = true;
            }
            if (permissionsRegex.test(line)) {
              meta.hasPermissions = true;
            }
          }
        }
      }

      for (const [jobId, meta] of jobs.entries()) {
        expect(
          meta.hasPermissions,
          `${path.basename(file)}: job "${jobId}" must define an explicit permissions block`,
        ).toBe(true);
        expect(
          meta.hasTimeout,
          `${path.basename(file)}: job "${jobId}" must define a timeout-minutes limit`,
        ).toBe(true);
      }
    }
  });

  it('AC-3: pull_request_target is never used in any workflow', () => {
    for (const file of workflowFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(
        content,
        `${path.basename(file)} must not use pull_request_target trigger`,
      ).not.toContain('pull_request_target');
    }
  });
});
