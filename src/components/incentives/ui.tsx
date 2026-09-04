import type { ReactNode } from 'react';

export function Card({ title, action, children, className = '' }: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border-custom bg-card-bg ${className}`}>
      {(title || action) && (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-custom px-4 py-3">
          {title && <h2 className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-custom">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const badgeStyles: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  review: 'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  paid: 'bg-emerald-50 text-emerald-700',
  active: 'bg-green-50 text-green-700',
  retired: 'bg-gray-100 text-gray-600',
  unresolved: 'bg-red-50 text-red-700',
};

export function Badge({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${badgeStyles[value] ?? 'bg-blue-50 text-blue-700'}`}>{value.replaceAll('_', ' ')}</span>;
}

export function Metric({ label, value, accent = false }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-custom bg-background/60 px-3 py-2.5">
      <div className="text-[9px] font-bold uppercase tracking-widest text-muted-custom">{label}</div>
      <div className={`mt-1 truncate text-sm font-black tabular-nums ${accent ? 'text-accent-custom' : 'text-foreground'}`}>{value}</div>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
      <div className="text-sm font-bold text-foreground">{title}</div>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-custom">{detail}</p>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">{message}</div>;
}

export function LoadingState({ label = 'Loading data…' }: { label?: string }) {
  return <div className="flex min-h-48 items-center justify-center gap-3 text-xs font-semibold text-muted-custom"><span className="h-4 w-4 animate-spin rounded-full border-2 border-border-custom border-t-accent-custom" />{label}</div>;
}

export const inputClass = 'h-9 w-full rounded-lg border border-border-custom bg-card-bg px-3 text-xs text-foreground outline-none transition focus:border-accent-custom disabled:bg-gray-50 disabled:text-muted-custom';
export const buttonClass = 'inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-4 text-[10px] font-black uppercase tracking-wider text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';
export const secondaryButtonClass = 'inline-flex h-9 items-center justify-center rounded-lg border border-border-custom bg-card-bg px-4 text-[10px] font-black uppercase tracking-wider text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40';
