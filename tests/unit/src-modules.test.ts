import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { routing } from '@/i18n/routing';
import { SERVER_LAYER_VERSION } from '@/server/index';
import { COMPONENTS_LAYER } from '@/components/index';
import { LIB_VERSION } from '@/lib/index';
import middleware, { config as middlewareConfig } from '@/middleware';

describe('src foundational modules', () => {
  it('i18n/routing configures supported locales and default locale', () => {
    expect(routing.locales).toContain('en');
    expect(routing.locales).toContain('de');
    expect(routing.defaultLocale).toBe('en');
  });

  it('layer placeholder modules expose expected constants', () => {
    expect(SERVER_LAYER_VERSION).toBe('1.0.0');
    expect(COMPONENTS_LAYER).toBe('primitives');
    expect(LIB_VERSION).toBe('1.0.0');
  });

  it('middleware is properly configured with route matchers', () => {
    expect(typeof middleware).toBe('function');
    expect(middlewareConfig.matcher).toEqual(['/((?!api|_next|_vercel|.*\\..*).*)']);
  });
});
