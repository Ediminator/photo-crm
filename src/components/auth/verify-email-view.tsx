'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

export function VerifyEmailView({ locale }: { locale: string }) {
  const t = useTranslations('auth.verifyEmail');

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1
          data-testid="verify-email-title"
          className="text-2xl font-bold tracking-tight text-foreground"
        >
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="bg-card text-card-foreground border rounded-lg shadow-sm p-6 sm:p-8 text-center space-y-4">
        <p className="text-sm text-muted-foreground">{t('instruction')}</p>
        <div className="pt-2">
          <Link
            href={`/${locale}/sign-in`}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4"
          >
            {t('backToSignIn')}
          </Link>
        </div>
      </div>
    </div>
  );
}
