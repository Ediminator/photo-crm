import * as React from 'react';
import { SkipLink } from './skip-link';
import { Sidebar } from './sidebar';
import { MobileNav } from './mobile-nav';

export interface AppShellProps {
  children: React.ReactNode;
  isAuthRoute?: boolean;
}

export function AppShell({ children, isAuthRoute = false }: AppShellProps) {
  if (isAuthRoute) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground antialiased font-sans p-4">
        <SkipLink />
        <main
          id="main-content"
          tabIndex={-1}
          className="w-full flex items-center justify-center outline-none"
        >
          {children}
        </main>
      </div>
    );
  }

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
