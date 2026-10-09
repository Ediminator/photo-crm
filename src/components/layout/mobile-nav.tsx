'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Menu, Camera } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { NavLinks } from './nav-links';
import { LocaleSwitcher } from '@/components/i18n/locale-switcher';
import { ThemeToggle } from '@/components/theme/theme-toggle';

export function MobileNav() {
  const [isOpen, setIsOpen] = React.useState(false);
  const t = useTranslations('nav');
  const tHome = useTranslations('home');

  return (
    <header className="lg:hidden flex h-16 items-center justify-between border-b border-border bg-card px-4 shrink-0">
      <div className="flex items-center gap-3">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('openMenu')}
              data-testid="mobile-menu-trigger"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">{t('openMenu')}</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 p-6 flex flex-col justify-between"
            closeAriaLabel={t('closeMenu')}
            data-testid="mobile-drawer"
          >
            <div>
              <SheetHeader className="text-left mb-6">
                <div className="flex items-center gap-2">
                  <Camera className="h-6 w-6 text-primary" aria-hidden="true" />
                  <SheetTitle className="text-lg font-bold tracking-tight">
                    {tHome('title')}
                  </SheetTitle>
                </div>
              </SheetHeader>
              <nav aria-label={t('mainNavigation')}>
                <NavLinks
                  onNavigate={() => {
                    setIsOpen(false);
                  }}
                />
              </nav>
            </div>

            <div className="border-t border-border pt-4 flex items-center justify-between">
              <LocaleSwitcher />
              <ThemeToggle />
            </div>
          </SheetContent>
        </Sheet>

        <Link href="/" className="font-bold text-lg tracking-tight text-foreground">
          {tHome('title')}
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
