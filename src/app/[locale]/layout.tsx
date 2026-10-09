import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { routing } from '@/i18n/routing';
import { geistSans, geistMono } from '@/app/fonts';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { AppShell } from '@/components/layout/app-shell';
import enMessages from '../../../messages/en.json';
import deMessages from '../../../messages/de.json';
import '@/app/globals.css';

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = locale === 'de' ? deMessages : enMessages;

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{messages.home.title}</title>
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
