import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('AC-7: GET /api/health endpoint', () => {
  it('AC-7: returns 200 with status ok and Cache-Control no-store', async () => {
    const response = GET();

    expect(response.status).toBe(200);

    const cacheControl = response.headers.get('Cache-Control');
    expect(cacheControl).toBeDefined();
    expect(cacheControl).toContain('no-store');

    const data = (await response.json()) as Record<string, unknown>;
    expect(data).toEqual({ status: 'ok' });
  });

  it('AC-7: leaks no extra fields (no hostname, version, or uptime)', async () => {
    const response = GET();
    const data = (await response.json()) as Record<string, unknown>;

    const keys = Object.keys(data);
    expect(keys).toEqual(['status']);

    expect(data.version).toBeUndefined();
    expect(data.env).toBeUndefined();
    expect(data.hostname).toBeUndefined();
    expect(data.uptime).toBeUndefined();
  });
});
