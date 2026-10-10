import { describe, it, expect, vi } from 'vitest';
import React from 'react';

vi.mock('server-only', () => ({}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `translated-${key}`,
}));

import LeadsPage from '@/app/[locale]/leads/page';
import ClientsPage from '@/app/[locale]/clients/page';
import ProjectsPage from '@/app/[locale]/projects/page';
import CalendarPage from '@/app/[locale]/calendar/page';
import SettingsPage from '@/app/[locale]/settings/page';
import SignInPage from '@/app/[locale]/sign-in/page';
import ForgotPasswordPage from '@/app/[locale]/forgot-password/page';
import ResetPasswordPage from '@/app/[locale]/reset-password/page';
import VerifyEmailPage from '@/app/[locale]/verify-email/page';
import SetupPage from '@/app/[locale]/setup/page';
import { isSetupAvailable } from '@/server/auth/setup';

vi.mock('@/server/auth/setup', () => ({
  isSetupAvailable: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
  notFound: vi.fn(),
}));

describe('App placeholder and auth pages', () => {
  it('renders LeadsPage component', () => {
    const el = LeadsPage();
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ClientsPage component', () => {
    const el = ClientsPage();
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ProjectsPage component', () => {
    const el = ProjectsPage();
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders CalendarPage component', () => {
    const el = CalendarPage();
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders SettingsPage component', () => {
    const el = SettingsPage();
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders SignInPage component', async () => {
    const el = await SignInPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ForgotPasswordPage component', async () => {
    const el = await ForgotPasswordPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders ResetPasswordPage component', async () => {
    const el = await ResetPasswordPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders VerifyEmailPage component', async () => {
    const el = await VerifyEmailPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('renders SetupPage component when setup is available', async () => {
    vi.mocked(isSetupAvailable).mockResolvedValueOnce(true);
    const el = await SetupPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(React.isValidElement(el)).toBe(true);
  });

  it('calls notFound in SetupPage when setup is disabled', async () => {
    vi.mocked(isSetupAvailable).mockResolvedValueOnce(false);
    const { notFound } = await import('next/navigation');
    await SetupPage({ params: Promise.resolve({ locale: 'en' }) });
    expect(notFound).toHaveBeenCalled();
  });
});
