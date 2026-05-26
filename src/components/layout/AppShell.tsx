import type { ReactNode } from 'react';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { OfflineBanner } from './OfflineBanner';

export interface AppShellProps {
  children: ReactNode;
  hideNav?: boolean;
}

export function AppShell({ children, hideNav = false }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <OfflineBanner />
      <main className="flex-1 overflow-y-auto pb-20">{children}</main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
