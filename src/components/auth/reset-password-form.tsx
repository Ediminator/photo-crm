'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resetPasswordAction } from '@/server/auth/actions';

export function ResetPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations('auth.resetPassword');
  const searchParams = useSearchParams();

  const token = searchParams.get('token') ?? '';
  const email = searchParams.get('email') ?? '';

  const [isPending, startTransition] = useTransition();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }

    startTransition(async () => {
      const result = await resetPasswordAction({
        email,
        token,
        newPassword,
      });

      if (!result.success) {
        setError(result.error);
      } else {
        setSuccess(true);
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
        {success ? (
          <div data-testid="reset-password-success" role="status" className="space-y-4 text-center">
            <h2 className="text-lg font-semibold text-foreground">{t('successTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('successMessage')}</p>
            <div className="pt-2">
              <Link
                href={`/${locale}/sign-in`}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4"
              >
                {t('backToSignIn')}
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            data-testid="reset-password-form"
            className="space-y-4"
            noValidate
          >
            {error && (
              <div
                role="alert"
                aria-live="polite"
                data-testid="reset-password-error"
                className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md"
              >
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="new-password"
                className="text-sm font-medium leading-none text-foreground"
              >
                {t('newPassword')}
              </label>
              <input
                id="new-password"
                name="newPassword"
                data-testid="password-input"
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                }}
                placeholder={t('newPasswordPlaceholder')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="confirm-password"
                className="text-sm font-medium leading-none text-foreground"
              >
                {t('confirmPassword')}
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                data-testid="confirm-password-input"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                }}
                placeholder={t('confirmPasswordPlaceholder')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              data-testid="reset-password-submit-btn"
              disabled={isPending}
              className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4"
            >
              {isPending ? t('submitting') : t('submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
