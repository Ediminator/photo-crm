'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ThemeToggle() {
  const { setTheme } = useTheme();
  const t = useTranslations('theme');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('toggle')}
          className="relative"
          data-testid="theme-toggle-trigger"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t('toggle')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid="theme-option-light"
          onClick={() => {
            setTheme('light');
          }}
        >
          {t('light')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="theme-option-dark"
          onClick={() => {
            setTheme('dark');
          }}
        >
          {t('dark')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="theme-option-system"
          onClick={() => {
            setTheme('system');
          }}
        >
          {t('system')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
