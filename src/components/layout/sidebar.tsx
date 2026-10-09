'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Camera } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { NavLinks } from './nav-links';
import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export function Sidebar() {
  const t = useTranslations('nav');
  const tHome = useTranslations('home');

  return (
    <aside
      aria-label={t('sidebar')}
      className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border lg:bg-card lg:min-h-screen shrink-0"
    >
      <div className="flex h-16 items-center gap-2 border-b border-border px-6">
        <Camera className="h-6 w-6 text-primary" aria-hidden="true" />
        <Link
          href="/"
          className="font-bold text-lg tracking-tight text-foreground hover:opacity-80 transition-opacity"
        >
          {tHome('title')}
        </Link>
      </div>

      <nav aria-label={t('mainNavigation')} className="flex-1 overflow-y-auto px-4 py-6">
        <NavLinks />
      </nav>

      <div className="border-t border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">PC</AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-foreground truncate">{tHome('title')}</span>
            <span className="text-xs text-muted-foreground truncate">{t('owner')}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
