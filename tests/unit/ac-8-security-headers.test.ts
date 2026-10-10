import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import middleware, { STANDARD_SESSION_COOKIE } from '@/middleware';

describe('AC-8: Security headers and Content Security Policy with per-request nonce', () => {
  it('AC-8: generates a per-request nonce and strict-dynamic CSP with no unsafe-inline for scripts', () => {
    const req = new NextRequest('http://localhost:3000/en/sign-in');
    const res = middleware(req);

    // Verify status
    expect(res.status).toBe(200);

    // Verify CSP header presence
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeDefined();
    expect(csp).not.toBeNull();

    // Verify strict-dynamic is present
    expect(csp).toContain("'strict-dynamic'");

    // Verify nonce format 'nonce-...'
    const nonceMatch = csp?.match(/'nonce-([A-Za-z0-9+/=]+)'/);
    expect(nonceMatch).not.toBeNull();
    const nonceValue = nonceMatch ? (nonceMatch[1] ?? '') : '';
    expect(nonceValue).toBeDefined();
    expect(nonceValue.length).toBeGreaterThanOrEqual(16);

    // Verify script-src DOES NOT contain 'unsafe-inline'
    const scriptSrcPart = csp?.split(';').find((part) => part.trim().startsWith('script-src'));
    expect(scriptSrcPart).toBeDefined();
    expect(scriptSrcPart).not.toContain("'unsafe-inline'");

    // Verify mandatory security headers
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('AC-8: includes HSTS header in production mode', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      const req = new NextRequest('http://localhost:3000/en/sign-in');
      const res = middleware(req);

      const hsts = res.headers.get('Strict-Transport-Security');
      expect(hsts).toBeDefined();
      expect(hsts).toContain('max-age=63072000');
      expect(hsts).toContain('includeSubDomains');
      expect(hsts).toContain('preload');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    }
  });

  it('AC-8: generates unique nonces across subsequent requests', () => {
    const req1 = new NextRequest('http://localhost:3000/en/sign-in');
    const res1 = middleware(req1);

    const req2 = new NextRequest('http://localhost:3000/en/sign-in');
    const res2 = middleware(req2);

    const nonce1 = res1.headers.get('x-nonce');
    const nonce2 = res2.headers.get('x-nonce');

    expect(nonce1).toBeDefined();
    expect(nonce2).toBeDefined();
    expect(nonce1).not.toBe(nonce2);
  });

  it('AC-9: unauthenticated request to protected route redirects to /[locale]/sign-in with callbackUrl', () => {
    const req = new NextRequest('http://localhost:3000/en/leads');
    const res = middleware(req);

    expect(res.status).toBe(307); // NextResponse.redirect
    const location = res.headers.get('location');
    expect(location).toContain('/en/sign-in');
    expect(location).toContain('callbackUrl=%2Fen%2Fleads');
  });

  it('AC-9: authenticated request to protected route is permitted through', () => {
    const req = new NextRequest('http://localhost:3000/en/leads', {
      headers: {
        cookie: `${STANDARD_SESSION_COOKIE}=valid-session-token`,
      },
    });
    const res = middleware(req);

    // Permitted (status 200)
    expect(res.status).toBe(200);
  });

  it('AC-8: handles static asset and root-level public paths without locale prefix', () => {
    // 1. Static asset with dot
    const staticReq = new NextRequest('http://localhost:3000/favicon.ico');
    const staticRes = middleware(staticReq);
    expect(staticRes.headers.get('Content-Security-Policy')).toBeDefined();

    // 2. Public route without locale prefix (/sign-in)
    const publicReq = new NextRequest('http://localhost:3000/sign-in');
    const publicRes = middleware(publicReq);
    expect(publicRes.headers.get('Content-Security-Policy')).toBeDefined();

    // 3. Unauthenticated visit to /de root redirects without callbackUrl
    const deRootReq = new NextRequest('http://localhost:3000/de');
    const deRootRes = middleware(deRootReq);
    expect(deRootRes.status).toBe(307);
    const location = deRootRes.headers.get('location');
    expect(location).toContain('/de/sign-in');
    expect(location).not.toContain('callbackUrl');
  });
});
