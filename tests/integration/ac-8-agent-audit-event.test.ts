import { describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import * as schema from '@/server/db/schema';
import { audit } from '@/server/audit';
import type { DbClient } from '@/server/db/client';

vi.mock('server-only', () => ({}));

describe('AC-8: Agent/Token Audit Event Recording and Attribution Metadata', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const drizzleDir = path.resolve(rootDir, 'drizzle');

  it('AC-8: validates actor_type enum (agent/token), captures agent attribution metadata, and rejects invalid actor_type', async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client, { schema }) as unknown as DbClient;
      await migrate(drizzle(client), { migrationsFolder: drizzleDir });

      // 1. Dispatch event with actor_type: 'agent'
      const agentMetadata = {
        token_id: 'tok_mcp_test_123',
        tool_name: 'git_checkout',
        command_name: 'checkout',
        args_hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        status: 'success',
        duration_ms: 125,
      };

      const agentEvent = await audit(
        {
          actorType: 'agent',
          actorId: 'agent-sub-1',
          action: 'agent.tool.invoked',
          targetType: 'repository',
          targetId: 'ownlight',
          outcome: 'success',
          metadata: agentMetadata,
        },
        db,
      );

      expect(agentEvent.id).toBeDefined();
      expect(agentEvent.actorType).toBe('agent');
      expect(agentEvent.metadata).toEqual(agentMetadata);

      // Verify directly via raw database query
      const agentRawRes = await client.query<{
        actor_type: string;
        metadata: string | Record<string, unknown>;
      }>(`SELECT actor_type, metadata FROM audit_events WHERE id = '${agentEvent.id}'`);
      expect(agentRawRes.rows[0]?.actor_type).toBe('agent');
      const rawMeta = agentRawRes.rows[0]?.metadata;
      const storedAgentMeta =
        typeof rawMeta === 'string' ? (JSON.parse(rawMeta) as Record<string, unknown>) : rawMeta;
      expect(storedAgentMeta).toEqual(agentMetadata);

      // 2. Dispatch event with actor_type: 'token'
      const tokenMetadata = {
        token_id: 'tok_cli_live_999',
        command_name: 'retention_sweep',
        args_hash: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        exit_code: 0,
        duration_ms: 450,
      };

      const tokenEvent = await audit(
        {
          actorType: 'token',
          actorId: 'token-key-uuid',
          action: 'agent.command.executed',
          targetType: 'system',
          targetId: 'retention_worker',
          outcome: 'success',
          metadata: tokenMetadata,
        },
        db,
      );

      expect(tokenEvent.id).toBeDefined();
      expect(tokenEvent.actorType).toBe('token');
      expect(tokenEvent.metadata).toEqual(tokenMetadata);

      // 3. Database check constraint strictly rejects invalid actor_type enum value
      await expect(
        client.query(
          `INSERT INTO audit_events (id, occurred_at, actor_type, action, outcome)
           VALUES ('01912345-6789-7abc-8def-0123456789ff', NOW(), 'unauthorized_actor_enum', 'test.action', 'success')`,
        ),
      ).rejects.toThrow(/violates check constraint "audit_events_actor_type_check"/i);

      // 4. Database check constraint strictly rejects invalid outcome enum value
      await expect(
        client.query(
          `INSERT INTO audit_events (id, occurred_at, actor_type, action, outcome)
           VALUES ('01912345-6789-7abc-8def-0123456789fe', NOW(), 'system', 'test.action', 'invalid_outcome_value')`,
        ),
      ).rejects.toThrow(/violates check constraint "audit_events_outcome_check"/i);
    } finally {
      await client.close();
    }
  });
});
