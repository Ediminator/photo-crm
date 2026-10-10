import { NextResponse, NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

export const SECURE_SESSION_COOKIE = '__Secure-photo_crm_session';
export const STANDARD_SESSION_COOKIE = 'photo_crm_session';
export const BETTER_AUTH_SECURE_COOKIE = '__Secure-better-auth.session_token';
export const BETTER_AUTH_COOKIE = 'better-auth.session_token';

const PUBLIC_PATH_SEGMENTS = [
  'sign-in',
  'setup',
  'forgot-password',
  'reset-password',
  'verify-email',
];

/**
 * Generates a random 16-byte base64 nonce using Web Crypto API (Edge-safe).
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/**
 * Checks whether a given path is an authentication or public route.
 */
function isPublicPath(pathname: string): boolean {
  // Static assets and internal routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico'
  ) {
    return true;
  }

  // Remove locale prefix (/en/setup -> /setup)
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  const first = segments[0];
  const second = segments[1];

  if (first && routing.locales.includes(first as 'en' | 'de')) {
    if (!second) return false; // /en or /de alone is the dashboard (protected)
    return PUBLIC_PATH_SEGMENTS.includes(second);
  }

  return first ? PUBLIC_PATH_SEGMENTS.includes(first) : false;
}

/**
 * Determines whether the request carries an active session cookie.
 */
function hasValidSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has(SECURE_SESSION_COOKIE) ||
    request.cookies.has(STANDARD_SESSION_COOKIE) ||
    request.cookies.has(BETTER_AUTH_SECURE_COOKIE) ||
    request.cookies.has(BETTER_AUTH_COOKIE)
  );
}

/**
 * Extracts or infers locale from pathname.
 */
function extractLocale(pathname: string): 'en' | 'de' {
  const first = pathname.split('/').find(Boolean);
  if (first === 'de') return 'de';
  return 'en';
}

function applySecurityHeaders(
  response: NextResponse,
  cspHeader: string,
  nonce: string,
  isProd: boolean,
): void {
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('x-nonce', nonce);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');

  if (isProd) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }
}

export default function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isProd = process.env.NODE_ENV === 'production';

  // 1. Generate cryptographically random 16-byte base64 nonce for CSP (strict-dynamic)
  const nonce = generateNonce();

  // 2. Build Content Security Policy header adhering to ASVS 5.0 V3
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data:;
    font-src 'self';
    object-src 'none';
    base-uri 'none';
    form-action 'self';
    frame-ancestors 'none';
  `
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 3. Route metadata & session inspection
  const authenticated = hasValidSessionCookie(request);
  const isPublic = isPublicPath(pathname);

  // 4. Pass nonce and metadata to request headers so React / Next.js can read them in server components
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);
  requestHeaders.set('x-pathname', pathname);
  if (isPublic) {
    requestHeaders.set('x-is-auth-route', '1');
  }

  // 5. Root path locale negotiation: delegate '/' to intlMiddleware first
  if (pathname === '/') {
    const response = intlMiddleware(
      new NextRequest(request, {
        headers: requestHeaders,
      }),
    );
    applySecurityHeaders(response, cspHeader, nonce, isProd);
    response.headers.set('x-pathname', pathname);
    return response;
  }

  // 6. Route protection: redirect unauthenticated requests to protected app routes
  if (!isPublic && !authenticated) {
    const locale = extractLocale(pathname);
    const signInUrl = new URL(`/${locale}/sign-in`, request.url);
    if (pathname !== `/${locale}`) {
      signInUrl.searchParams.set('callbackUrl', pathname);
    }
    const redirectResponse = NextResponse.redirect(signInUrl);
    applySecurityHeaders(redirectResponse, cspHeader, nonce, isProd);
    return redirectResponse;
  }

  // 7. Delegate to next-intl middleware for locale negotiation
  const response = intlMiddleware(
    new NextRequest(request, {
      headers: requestHeaders,
    }),
  );

  // 8. Apply mandatory security headers and route metadata
  applySecurityHeaders(response, cspHeader, nonce, isProd);
  response.headers.set('x-pathname', pathname);
  response.headers.set('x-middleware-request-x-pathname', pathname);
  if (isPublic) {
    response.headers.set('x-is-auth-route', '1');
    response.headers.set('x-middleware-request-x-is-auth-route', '1');
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
