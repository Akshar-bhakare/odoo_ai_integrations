'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIncentiveSession } from '@/components/incentives/session-context';
import {
  buttonClass,
  Card,
  EmptyState,
  ErrorBanner,
  inputClass,
  LoadingState,
  Metric,
  secondaryButtonClass,
} from '@/components/incentives/ui';
import { date, money } from '@/lib/incentives/ui/format';
import type { PnlJournalItemPage } from '@/lib/accounting/pnl';

function localIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialRange(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const fiscalYear = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
  return { dateFrom: `${fiscalYear}-04-01`, dateTo: localIsoDate(today) };
}

export function PnlJournalItems() {
  const { request } = useIncentiveSession();
  const [filters, setFilters] = useState(initialRange);
  const [applied, setApplied] = useState(initialRange);
  const [data, setData] = useState<PnlJournalItemPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (range: typeof applied, page: number) => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        page: String(page),
      });
      const result = await request<PnlJournalItemPage>(`/api/accounting/pnl?${query}`);
      setData(result);
      setApplied(range);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load P&L journal items');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const range = initialRange();
    const timer = window.setTimeout(() => { void load(range, 1); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pageDebit = useMemo(
    () => data?.items.reduce((sum, item) => sum + item.debit, 0) ?? 0,
    [data],
  );
  const pageCredit = useMemo(
    () => data?.items.reduce((sum, item) => sum + item.credit, 0) ?? 0,
    [data],
  );
  const firstRecord = data && data.total > 0 ? ((data.page - 1) * data.pageSize) + 1 : 0;
  const lastRecord = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-4 py-5 md:px-7">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-accent-custom">Accounting</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Profit &amp; Loss journal items</h1>
          <p className="mt-1 text-xs text-muted-custom">Posted, accrual-basis P&amp;L lines fetched directly from Odoo account.move.line.</p>
        </div>
        <form
          className="grid gap-2 rounded-xl border border-border-custom bg-card-bg p-3 sm:grid-cols-[160px_160px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void load(filters, 1);
          }}
        >
          <label className="text-[9px] font-black uppercase tracking-wider text-muted-custom">
            From
            <input type="date" required value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} className={`mt-1 ${inputClass}`} />
          </label>
          <label className="text-[9px] font-black uppercase tracking-wider text-muted-custom">
            To
            <input type="date" required value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} className={`mt-1 ${inputClass}`} />
          </label>
          <button disabled={loading} className={`${buttonClass} self-end`}>Load report</button>
        </form>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Journal items" value={data?.total.toLocaleString('en-IN') ?? '—'} />
        <Metric label="Showing" value={data ? `${firstRecord.toLocaleString('en-IN')}–${lastRecord.toLocaleString('en-IN')}` : '—'} />
        <Metric label="Debit on this page" value={money(pageDebit)} />
        <Metric label="Credit on this page" value={money(pageCredit)} />
      </div>

      <Card
        title="P&L journal items"
        action={data && data.total > 0 ? <span className="text-[10px] font-bold text-muted-custom">{firstRecord.toLocaleString('en-IN')}–{lastRecord.toLocaleString('en-IN')} / {data.total.toLocaleString('en-IN')}</span> : undefined}
      >
        {loading ? <LoadingState label="Loading posted P&L journal items…" /> : data && data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] text-xs">
              <thead>
                <tr className="border-b border-border-custom bg-background/60 text-left text-[9px] font-black uppercase tracking-wider text-muted-custom">
                  {['Date', 'Number', 'Account', 'Partner', 'Label', 'Debit', 'Credit', 'Sales Order Lines/Salesperson'].map((heading) => <th key={heading} className={`px-3 py-3 ${heading === 'Debit' || heading === 'Credit' ? 'text-right' : ''}`}>{heading}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="border-b border-border-custom/70 align-top hover:bg-background/50">
                    <td className="whitespace-nowrap px-3 py-3">{date(item.date)}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono font-bold text-cyan-700">{item.number}</td>
                    <td className="px-3 py-3">{item.account}</td>
                    <td className="px-3 py-3 font-semibold">{item.partner || '—'}</td>
                    <td className="max-w-[420px] px-3 py-3">{item.label}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono">{money(item.debit)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono">{money(item.credit)}</td>
                    <td className="px-3 py-3 font-semibold">{item.salespersons.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No P&L journal items" detail="No posted income or expense lines were found for this date range." />}
      </Card>

      {data && data.total > 0 && (
        <div className="flex items-center justify-end gap-2">
          <button disabled={loading || data.page <= 1} onClick={() => void load(applied, data.page - 1)} className={secondaryButtonClass}>Previous</button>
          <span className="px-3 text-xs font-bold">Page {data.page.toLocaleString('en-IN')} of {data.pageCount.toLocaleString('en-IN')}</span>
          <button disabled={loading || data.page >= data.pageCount} onClick={() => void load(applied, data.page + 1)} className={secondaryButtonClass}>Next</button>
        </div>
      )}
    </main>
  );
}
