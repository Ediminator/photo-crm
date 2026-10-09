#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const workflowsDir = path.resolve(process.cwd(), '.github/workflows');

if (!fs.existsSync(workflowsDir)) {
  console.error(`❌ Workflows directory not found: ${workflowsDir}`);
  process.exit(1);
}

const workflowFiles = fs
  .readdirSync(workflowsDir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => path.join(workflowsDir, f));

if (workflowFiles.length === 0) {
  console.error('❌ No workflow files found in .github/workflows/');
  process.exit(1);
}

const errors = [];
const warnings = [];

// 1. Static policy checks on workflow contents
for (const file of workflowFiles) {
  const relPath = path.relative(process.cwd(), file).replace(/\\/g, '/');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);

  // Check 1: No pull_request_target
  if (content.includes('pull_request_target')) {
    errors.push(
      `${relPath}: "pull_request_target" is forbidden due to elevated token privilege and code checkout vulnerabilities.`,
    );
  }

  // Check 2: Top-level permissions: {}
  const topPermissionsMatch = /^permissions:\s*(\{\}\s*)?$/m.test(content);
  if (!topPermissionsMatch) {
    errors.push(
      `${relPath}: Missing top-level "permissions: {}" block. Workflows must grant zero privileges by default.`,
    );
  }

  // Check 3: Concurrency group configured
  if (!/^concurrency:\s*$/m.test(content)) {
    warnings.push(`${relPath}: Concurrency block is recommended to cancel obsolete runs.`);
  }

  // Check 4: Third-party action SHA-pinning and version comment
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- uses:') || trimmed.startsWith('uses:')) {
      const usesMatch = trimmed.match(/uses:\s*([^\s#]+)(.*)$/);
      if (usesMatch) {
        const actionRef = usesMatch[1];
        const comment = (usesMatch[2] || '').trim();

        // Local actions starting with ./ are exempt
        if (!actionRef.startsWith('./')) {
          const atIndex = actionRef.indexOf('@');
          if (atIndex === -1) {
            errors.push(
              `${relPath}:${index + 1}: Action "${actionRef}" is unpinned. Must be pinned to a full 40-character commit SHA.`,
            );
          } else {
            const sha = actionRef.slice(atIndex + 1);
            const isFullSha = /^[0-9a-f]{40}$/i.test(sha);
            if (!isFullSha) {
              errors.push(
                `${relPath}:${index + 1}: Action "${actionRef}" ref is not a 40-character commit SHA (got "${sha}").`,
              );
            }
            if (!comment.startsWith('#')) {
              errors.push(
                `${relPath}:${index + 1}: Action "${actionRef}" is missing a version comment (e.g. "# v4.2.2").`,
              );
            }
          }
        }
      }
    }
  });

  // Check 5: Checkout persist-credentials: false
  if (content.includes('actions/checkout')) {
    if (!content.includes('persist-credentials: false')) {
      errors.push(
        `${relPath}: actions/checkout must specify "persist-credentials: false" to prevent credential leakage.`,
      );
    }
  }

  // Check 6: Parse jobs to verify timeout-minutes and permissions
  let inJobs = false;
  let currentJob = null;
  const jobs = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rawLine = line;
    const indent = line.search(/\S/);

    if (indent === 0 && line.startsWith('jobs:')) {
      inJobs = true;
      continue;
    }
    if (inJobs && indent === 0 && line.length > 0 && !line.startsWith('jobs:')) {
      inJobs = false;
    }

    if (inJobs && indent === 2) {
      const match = line.match(/^  ([a-zA-Z0-9_-]+):/);
      if (match) {
        currentJob = match[1];
        jobs[currentJob] = {
          hasTimeout: false,
          hasPermissions: false,
        };
      }
    }

    if (inJobs && currentJob) {
      if (/^\s+timeout-minutes:\s*\d+/.test(rawLine)) {
        jobs[currentJob].hasTimeout = true;
      }
      if (/^\s+permissions:/.test(rawLine)) {
        jobs[currentJob].hasPermissions = true;
      }
    }
  }

  for (const [jobId, meta] of Object.entries(jobs)) {
    if (!meta.hasTimeout) {
      errors.push(`${relPath}: Job "${jobId}" is missing "timeout-minutes".`);
    }
    if (!meta.hasPermissions) {
      errors.push(`${relPath}: Job "${jobId}" is missing an explicit "permissions:" block.`);
    }
  }
}

if (errors.length > 0) {
  console.error('❌ Action policy validation failed:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`✅ Static policy checks passed for ${workflowFiles.length} workflow file(s).`);

// Helper to find executable across PATH and known user paths
function findExecutable(binName) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const candidates = [];

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const ext of extensions) {
      candidates.push(path.join(dir, `${binName}${ext}`));
    }
  }

  if (process.platform === 'win32') {
    if (process.env.APPDATA) {
      candidates.push(
        path.join(process.env.APPDATA, 'Python', 'Python314', 'Scripts', `${binName}.exe`),
      );
      candidates.push(
        path.join(process.env.APPDATA, 'Python', 'Python313', 'Scripts', `${binName}.exe`),
      );
    }
    if (process.env.LOCALAPPDATA) {
      candidates.push(
        path.join(
          process.env.LOCALAPPDATA,
          'Programs',
          'Python',
          'Python313',
          'Scripts',
          `${binName}.exe`,
        ),
      );
    }
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

// 2. Run actionlint if available
const actionlintBin = findExecutable('actionlint');
if (actionlintBin) {
  console.log(`🔍 Running actionlint (${actionlintBin})...`);
  const result = spawnSync(actionlintBin, workflowFiles, {
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error('❌ actionlint reported errors.');
    process.exit(result.status || 1);
  }
  console.log('✅ actionlint: 0 errors.');
} else {
  console.log('ℹ️ actionlint binary not found on PATH. Skipped external check.');
}

// 3. Run zizmor if available
const zizmorBin = findExecutable('zizmor');
if (zizmorBin) {
  console.log(`🔍 Running zizmor (${zizmorBin})...`);
  const result = spawnSync(zizmorBin, ['--min-severity', 'medium', '.github/workflows'], {
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error('❌ zizmor reported findings at medium or higher severity.');
    process.exit(result.status || 1);
  }
  console.log('✅ zizmor: 0 findings at medium or higher.');
} else {
  console.log('ℹ️ zizmor binary not found on PATH. Skipped external check.');
}

console.log('🎉 All workflow linter and security checks passed!');
process.exit(0);
