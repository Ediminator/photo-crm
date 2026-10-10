#!/usr/bin/env node
/**
 * scripts/worker.mjs
 * Background worker skeleton for maintenance tasks and daily retention sweeps.
 *
 * Features:
 * 1. Postgres advisory lock to ensure single active worker.
 * 2. Graceful shutdown on SIGTERM / SIGINT ensuring transaction atomicity.
 * 3. Schedules retention:sweep daily.
 * 4. Supports --run-once flag for CLI / cron invocation.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { executeRetentionSweep } from './retention-sweep.mjs';

const __filename = fileURLToPath(import.meta.url);

const WORKER_ADVISORY_LOCK_ID = 884210;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours (daily)

export class BackgroundWorker {
  constructor(options = {}) {
    this.connectionUrl =
      options.connectionUrl ||
      process.env.DATABASE_RETENTION_URL ||
      process.env.DATABASE_MIGRATOR_URL ||
      process.env.DATABASE_URL ||
      'postgres://photo_crm_migrator:password@127.0.0.1:5432/photo_crm_dev';

    this.runOnce = options.runOnce ?? process.argv.includes('--run-once');
    this.intervalMs = options.intervalMs ?? SWEEP_INTERVAL_MS;
    this.isShuttingDown = false;
    this.activeSweepPromise = null;
    this.timer = null;
    this.sql = null;
  }

  async start() {
    this.sql = postgres(this.connectionUrl, { max: 1, onnotice: () => {} });

    // Acquire PostgreSQL advisory lock to ensure leader election across worker replicas
    const lockRes = await this
      .sql`SELECT pg_try_advisory_lock(${WORKER_ADVISORY_LOCK_ID}) as locked`;
    const isLocked = lockRes[0]?.locked;

    if (!isLocked) {
      console.warn('⚠️ Another worker holds the advisory lock. Exiting duplicate instance.');
      await this.sql.end();
      return { success: false, reason: 'locked' };
    }

    console.log('🤖 Background worker started (advisory lock acquired).');

    // Run initial sweep
    await this.runCycle();

    if (this.runOnce || this.isShuttingDown) {
      await this.stop();
      return { success: true };
    }

    // Schedule daily retention sweep
    this.timer = setInterval(async () => {
      if (this.isShuttingDown) return;
      await this.runCycle();
    }, this.intervalMs);

    return { success: true };
  }

  async runCycle() {
    if (this.isShuttingDown) return;

    console.log('⏰ Worker: running daily retention sweep...');
    try {
      this.activeSweepPromise = executeRetentionSweep({
        connectionUrl: this.connectionUrl,
        dryRun: false,
      });
      await this.activeSweepPromise;
      console.log('✅ Worker: daily retention sweep completed.');
    } catch (err) {
      console.error(
        '❌ Worker: retention sweep failed:',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.activeSweepPromise = null;
    }
  }

  async stop() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log('🛑 Worker shutting down gracefully...');

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.activeSweepPromise) {
      console.log('⏳ Waiting for in-flight sweep batch to complete...');
      await this.activeSweepPromise;
    }

    if (this.sql) {
      try {
        await this.sql`SELECT pg_advisory_unlock(${WORKER_ADVISORY_LOCK_ID})`;
        await this.sql.end();
      } catch {
        // Ignore unlock errors during process termination
      }
      this.sql = null;
    }

    console.log('👋 Worker stopped cleanly.');
  }
}

if (process.argv[1] === __filename) {
  const worker = new BackgroundWorker();

  const handleSignal = async (signal) => {
    console.log(`\nReceived ${signal}. Initiating graceful worker shutdown.`);
    await worker.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));

  try {
    await worker.start();
  } catch (err) {
    console.error('Fatal worker error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
