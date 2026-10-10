'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signInAction } from '@/server/auth/actions';

export function SignInForm({ locale }: { locale: string }) {
  const t = useTranslations('auth.signIn');
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? `/${locale}`;

  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await signInAction({ email, password });
      if (!result.success) {
        setError(result.error);
      } else {
        router.push(callbackUrl);
        router.refresh();
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
        <form onSubmit={handleSubmit} data-testid="signin-form" className="space-y-4" noValidate>
          {error && (
            <div
              role="alert"
              aria-live="polite"
              data-testid="signin-error"
              className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md"
            >
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="signin-email"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t('email')}
            </label>
            <input
              id="signin-email"
              name="email"
              data-testid="email-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              placeholder={t('emailPlaceholder')}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="signin-password"
                className="text-sm font-medium leading-none text-foreground"
              >
                {t('password')}
              </label>
              <Link
                href={`/${locale}/forgot-password`}
                className="text-xs text-primary hover:underline"
              >
                {t('forgotPassword')}
              </Link>
            </div>
            <input
              id="signin-password"
              name="password"
              data-testid="password-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              placeholder={t('passwordPlaceholder')}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            data-testid="signin-submit-btn"
            disabled={isPending}
            className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4"
          >
            {isPending ? t('submitting') : t('submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
