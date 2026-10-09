import { describe, it, expect, vi } from 'vitest';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `translated-${key}`,
}));

import LeadsPage from '@/app/[locale]/leads/page';
import ClientsPage from '@/app/[locale]/clients/page';
import ProjectsPage from '@/app/[locale]/projects/page';
import CalendarPage from '@/app/[locale]/calendar/page';
import SettingsPage from '@/app/[locale]/settings/page';

describe('App placeholder pages', () => {
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
});
