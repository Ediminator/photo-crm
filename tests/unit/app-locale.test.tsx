import { describe, it, expect, vi } from 'vitest';
import React from 'react';

vi.mock('next-intl/server', () => ({
  getRequestConfig: (fn: unknown) => fn,
}));

vi.mock('next/font/local', () => ({
  default: () => ({
    variable: '--font-geist',
    className: 'font-geist',
  }),
}));

vi.mock('next-intl', () => ({
  hasLocale: (locales: string[], loc: string) => locales.includes(loc),
  useTranslations: () => (key: string) => `translated-${key}`,
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    notFound: () => mockNotFound(),
  };
});

import HomePage, { HomeContent } from '@/app/[locale]/page';
import LocaleLayout, { generateStaticParams } from '@/app/[locale]/layout';
import requestConfig from '@/i18n/request';

describe('App router localized layout and home page unit tests', () => {
  it('generateStaticParams returns params for all configured locales', () => {
    const params = generateStaticParams();
    expect(params).toEqual([{ locale: 'en' }, { locale: 'de' }]);
  });

  it('LocaleLayout renders html document with correct lang', async () => {
    const element = await LocaleLayout({
      children: React.createElement('div', { id: 'child' }, 'Content'),
      params: Promise.resolve({ locale: 'en' }),
    });

    expect(React.isValidElement(element)).toBe(true);
    const props = element.props as { lang?: string };
    expect(props.lang).toBe('en');
  });

  it('LocaleLayout triggers notFound for unsupported locale', async () => {
    await expect(
      LocaleLayout({
        children: React.createElement('div', null, 'Content'),
        params: Promise.resolve({ locale: 'fr' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
  });

  it('HomePage and HomeContent render localized content', () => {
    const pageElement = HomePage();
    expect(React.isValidElement(pageElement)).toBe(true);

    const contentElement = HomeContent();
    expect(React.isValidElement(contentElement)).toBe(true);
  });

  it('requestConfig resolves messages for valid and fallback locales', async () => {
    const fn = requestConfig as unknown as (context: {
      locale?: string;
    }) => Promise<{ locale: string; messages: Record<string, unknown> }>;

    const enConfig = await fn({ locale: 'en' });
    expect(enConfig.locale).toBe('en');
    expect(enConfig.messages).toBeDefined();

    const deConfig = await fn({ locale: 'de' });
    expect(deConfig.locale).toBe('de');
    expect(deConfig.messages).toBeDefined();

    // Fallback to defaultLocale ('en') when invalid locale requested
    const fallbackConfig = await fn({ locale: 'es' });
    expect(fallbackConfig.locale).toBe('en');

    // Test requestLocale promise resolution
    const fnWithRequestLocale = requestConfig as unknown as (context: {
      requestLocale: Promise<string | undefined>;
    }) => Promise<{ locale: string; messages: Record<string, unknown> }>;

    const deReqConfig = await fnWithRequestLocale({
      requestLocale: Promise.resolve('de'),
    });
    expect(deReqConfig.locale).toBe('de');

    const undefReqConfig = await fnWithRequestLocale({
      requestLocale: Promise.resolve(undefined),
    });
    expect(undefReqConfig.locale).toBe('en');
  });
});
