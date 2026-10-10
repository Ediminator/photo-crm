'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { requestPasswordResetAction } from '@/server/auth/actions';

export function ForgotPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations('auth.forgotPassword');
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmittedMessage(null);

    startTransition(async () => {
      const result = await requestPasswordResetAction({ email });
      if (!result.success) {
        setError(result.error);
      } else {
        setSubmittedMessage(result.data?.message ?? t('successMessage'));
      }
    });
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="bg-card text-card-foreground border rounded-lg shadow-sm p-6 sm:p-8">
        {submittedMessage ? (
          <div className="space-y-4 text-center">
            <div
              role="status"
              aria-live="polite"
              data-testid="forgot-password-feedback"
              className="p-4 text-sm text-foreground bg-primary/10 border border-primary/20 rounded-md"
            >
              {submittedMessage}
            </div>
            <Link
              href={`/${locale}/sign-in`}
              className="inline-block text-sm text-primary hover:underline"
            >
              {t('backToSignIn')}
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            data-testid="forgot-password-form"
            className="space-y-4"
            noValidate
          >
            {error && (
              <div
                id="forgot-password-error-msg"
                role="alert"
                aria-live="polite"
                data-testid="forgot-password-error"
                className="p-3 text-sm font-medium rounded-md border text-red-950 bg-red-100 border-red-300 dark:text-red-100 dark:bg-red-950 dark:border-red-800"
              >
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="reset-email"
                className="text-sm font-medium leading-none text-foreground"
              >
                {t('email')}
              </label>
              <input
                id="reset-email"
                name="email"
                data-testid="email-input"
                type="email"
                autoComplete="email"
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'forgot-password-error-msg' : undefined}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                placeholder={t('emailPlaceholder')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              data-testid="forgot-password-submit-btn"
              disabled={isPending}
              className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4"
            >
              {isPending ? t('submitting') : t('submit')}
            </button>

            <div className="text-center pt-2">
              <Link
                href={`/${locale}/sign-in`}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {t('backToSignIn')}
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
