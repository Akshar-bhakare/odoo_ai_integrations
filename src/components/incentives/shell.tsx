'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useIncentiveSession } from './session-context';
import { canAdminister, canReview } from '@/lib/incentives/ui/permissions';

const LOGO = '/WhatsApp Image 2026-08-01 at 1.15.58 PM.jpeg';

export function IncentiveShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { actor, logout } = useIncentiveSession();
  const nav = [
    { href: '/incentives', label: 'Dashboard', show: true },
    { href: '/incentives/unresolved', label: 'Unresolved', show: canReview(actor) },
    { href: '/incentives/presets', label: 'Presets', show: canAdminister(actor) },
    { href: '/incentives/assignments', label: 'Assignments', show: canAdminister(actor) },
    { href: '/actuals', label: 'Actuals', show: canReview(actor) },
    { href: '/pnl', label: 'P&L', show: canReview(actor) },
  ];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border-custom bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1800px] items-center justify-between gap-5 px-4 md:px-7">
          <div className="flex min-w-0 items-center gap-5">
            <Link href="/" className="shrink-0"><Image src={LOGO} alt="Sunlectric" width={94} height={30} className="object-contain" priority /></Link>
            <nav className="flex items-center gap-1 overflow-x-auto">
              {nav.filter((item) => item.show).map((item) => {
                const active = item.href === '/incentives' ? pathname === item.href : pathname.startsWith(item.href);
                return <Link key={item.href} href={item.href} className={`rounded-md px-3 py-2 text-[10px] font-black uppercase tracking-wider ${active ? 'bg-foreground text-background' : 'text-muted-custom hover:text-foreground'}`}>{item.label}</Link>;
              })}
              <Link href="/odoo/orders" className="rounded-md px-3 py-2 text-[10px] font-black uppercase tracking-wider text-muted-custom hover:text-foreground">Orders</Link>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-[10px] font-bold">{actor.name}</div>
              <div className="text-[9px] uppercase tracking-wider text-muted-custom">{actor.roles.join(' · ') || 'No incentive role'}</div>
            </div>
            <button onClick={logout} className="rounded-md border border-border-custom px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider hover:border-foreground">Sign out</button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
