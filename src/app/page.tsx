import Link from 'next/link';
import Image from 'next/image';

const LOGO = '/WhatsApp Image 2026-08-01 at 1.15.58 PM.jpeg';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background font-sans">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-custom px-6">
        <Image src={LOGO} alt="Sunlectric" width={90} height={28} className="object-contain" priority />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-custom">ERP Portal</span>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
        <Image src={LOGO} alt="Sunlectric" width={160} height={52} className="object-contain" priority />
        <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-4">
          <PortalLink href="/stock" icon="STK" title="Voice Stock" detail="Speak · Search · Live availability" accent />
          <PortalLink href="/odoo/orders" icon="▤" title="Sales Orders" detail="Orders · Invoices · Documents" />
          <PortalLink href="/proforma" icon="PI" title="Proforma" detail="Generate GST PDF" accent />
          <PortalLink href="/incentives" icon="₹" title="Incentives" detail="Calculate · Review · Approve" accent />
        </div>
      </main>
      <footer className="flex h-10 items-center justify-center border-t border-border-custom">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-custom">Internal ERP Portal</span>
      </footer>
    </div>
  );
}

function PortalLink({ href, icon, title, detail, accent = false }: {
  href: string;
  icon: string;
  title: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <Link href={href} className="group flex flex-col items-center gap-1.5 rounded-xl border border-border-custom bg-card-bg px-8 py-6 text-center transition-colors hover:border-foreground/30">
      <span className={`text-2xl ${accent ? 'text-accent-custom' : ''}`}>{icon}</span>
      <span className="text-sm font-bold text-foreground">{title}</span>
      <span className="text-[11px] text-muted-custom">{detail}</span>
      <span className={`mt-1 text-xs text-muted-custom transition-colors ${accent ? 'group-hover:text-accent-custom' : 'group-hover:text-foreground'}`}>Open →</span>
    </Link>
  );
}
