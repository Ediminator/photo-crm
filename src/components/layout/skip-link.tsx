'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

export function SkipLink() {
  const t = useTranslations('nav');

  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:ring-2 focus:ring-ring focus:shadow-md focus:rounded-md focus:outline-none"
      data-testid="skip-link"
    >
      {t('skipLink')}
    </a>
  );
}
