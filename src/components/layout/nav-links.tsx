'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, Inbox, Users, FolderKanban, Calendar, Settings } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

interface NavLinksProps {
  onNavigate?: () => void;
  className?: string;
}

export function NavLinks({ onNavigate, className }: NavLinksProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const links = [
    { href: '/', label: t('dashboard'), icon: LayoutDashboard },
    { href: '/leads', label: t('leads'), icon: Inbox },
    { href: '/clients', label: t('clients'), icon: Users },
    { href: '/projects', label: t('projects'), icon: FolderKanban },
    { href: '/calendar', label: t('calendar'), icon: Calendar },
    { href: '/settings', label: t('settings'), icon: Settings },
  ];

  return (
    <ul className={cn('space-y-1', className)}>
      {links.map((item) => {
        const Icon = item.icon;
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isActive
                  ? 'bg-accent text-accent-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
