import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/font/local', () => ({
  default: () => ({
    variable: '--font-geist',
    className: 'font-geist',
  }),
}));

import middleware from '@/middleware';
import LocaleLayout from '@/app/[locale]/layout';
import React from 'react';

describe('AC-1: Accept-Language negotiation and html lang tag', () => {
  it('AC-1: redirects / to /de when Accept-Language is de-DE,de;q=0.9', () => {
    const req = new NextRequest('http://localhost:3000/', {
      headers: {
        'accept-language': 'de-DE,de;q=0.9',
      },
    });

    const res = middleware(req);
    expect(res).toBeDefined();
    // next-intl middleware issues a redirect response
    const location = res.headers.get('location');
    expect(location).toBe('http://localhost:3000/de');
  });

  it('AC-1: redirects / to /en when Accept-Language is en-US', () => {
    const req = new NextRequest('http://localhost:3000/', {
      headers: {
        'accept-language': 'en-US,en;q=0.9',
      },
    });

    const res = middleware(req);
    expect(res).toBeDefined();
    const location = res.headers.get('location');
    expect(location).toBe('http://localhost:3000/en');
  });

  it('AC-1: falls back to /en for unsupported language (e.g. fr-FR)', () => {
    const req = new NextRequest('http://localhost:3000/', {
      headers: {
        'accept-language': 'fr-FR,fr;q=0.9',
      },
    });

    const res = middleware(req);
    expect(res).toBeDefined();
    const location = res.headers.get('location');
    expect(location).toBe('http://localhost:3000/en');
  });

  it('AC-1: sets <html lang="de"> when locale is de', async () => {
    const element = await LocaleLayout({
      children: React.createElement('div', null, 'Content'),
      params: Promise.resolve({ locale: 'de' }),
    });

    expect(React.isValidElement(element)).toBe(true);
    const props = element.props as { lang?: string };
    expect(props.lang).toBe('de');
  });

  it('AC-1: sets <html lang="en"> when locale is en', async () => {
    const element = await LocaleLayout({
      children: React.createElement('div', null, 'Content'),
      params: Promise.resolve({ locale: 'en' }),
    });

    expect(React.isValidElement(element)).toBe(true);
    const props = element.props as { lang?: string };
    expect(props.lang).toBe('en');
  });
});
