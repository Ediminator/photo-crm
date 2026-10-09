import * as React from 'react';
import { SkipLink } from './skip-link';
import { Sidebar } from './sidebar';
import { MobileNav } from './mobile-nav';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background text-foreground antialiased font-sans">
      <SkipLink />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileNav />
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 md:p-6 lg:p-8 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
