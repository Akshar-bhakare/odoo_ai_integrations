'use client';

import { useCallback, useEffect, useState } from 'react';
import { useIncentiveSession } from '@/components/incentives/session-context';
import { buttonClass, Card, EmptyState, ErrorBanner, inputClass, LoadingState, Metric, secondaryButtonClass } from '@/components/incentives/ui';
import { date, money } from '@/lib/incentives/ui/format';
import type { IncentiveActualPage } from '@/lib/accounting/incentive-actuals';

function localIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialFilters() {
  const today = new Date();
  const fiscalYear = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
  return { dateFrom: `${fiscalYear}-04-01`, dateTo: localIsoDate(today), salesperson: '' };
}

export function IncentiveActuals() {
  const { request } = useIncentiveSession();
  const [filters, setFilters] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [data, setData] = useState<IncentiveActualPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (next: ReturnType<typeof initialFilters>, page: number) => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ dateFrom: next.dateFrom, dateTo: next.dateTo, page: String(page) });
      if (next.salesperson) query.set('salesperson', next.salesperson);
      const result = await request<IncentiveActualPage>(`/api/accounting/actuals?${query}`);
      setData(result);
      setApplied(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load incentive actuals');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const initial = initialFilters();
    const timer = window.setTimeout(() => { void load(initial, 1); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const firstRecord = data && data.total > 0 ? ((data.page - 1) * data.pageSize) + 1 : 0;
  const lastRecord = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <main className="mx-auto flex w-full max-w-[1900px] flex-col gap-4 px-4 py-5 md:px-7">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-accent-custom">Incentive source data</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Adjusted gross margin actuals</h1>
          <p className="mt-1 text-xs text-muted-custom">Posted Odoo P&amp;L lines grouped by invoice, with transport and loading taken from the linked sales order.</p>
        </div>
        <form className="grid gap-2 rounded-xl border border-border-custom bg-card-bg p-3 sm:grid-cols-[160px_160px_220px_auto]" onSubmit={(event) => { event.preventDefault(); void load(filters, 1); }}>
          <label className="text-[9px] font-black uppercase tracking-wider text-muted-custom">From<input type="date" required value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
          <label className="text-[9px] font-black uppercase tracking-wider text-muted-custom">To<input type="date" required value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
          <label className="text-[9px] font-black uppercase tracking-wider text-muted-custom">Salesperson<select value={filters.salesperson} onChange={(event) => setFilters({ ...filters, salesperson: event.target.value })} className={`mt-1 ${inputClass}`}><option value="">All salespeople</option>{data?.salespeople.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <button disabled={loading} className={`${buttonClass} self-end`}>Load actuals</button>
        </form>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <Metric label="Invoices" value={data?.total.toLocaleString('en-IN') ?? '—'} />
        <Metric label="Sales" value={data ? money(data.totals.sales) : '—'} />
        <Metric label="COGS" value={data ? money(data.totals.cogs) : '—'} />
        <Metric label="Transport + loading" value={data ? money(data.totals.transport + data.totals.loading) : '—'} />
        <Metric label="Adjusted GM" value={data ? money(data.totals.adjustedGrossMargin) : '—'} />
        <Metric label="Adjusted GM %" value={data ? `${data.totals.marginPercent.toFixed(2)}%` : '—'} />
      </div>

      <Card title="Invoice actuals" action={data && data.total > 0 ? <span className="text-[10px] font-bold text-muted-custom">{firstRecord.toLocaleString('en-IN')}–{lastRecord.toLocaleString('en-IN')} / {data.total.toLocaleString('en-IN')}</span> : undefined}>
        {loading ? <LoadingState label="Building invoice actuals from Odoo…" /> : data && data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1600px] text-xs">
              <thead><tr className="border-b border-border-custom bg-background/60 text-left text-[9px] font-black uppercase tracking-wider text-muted-custom">
                {['Type', 'Date', 'Customer invoice', 'Sales order', 'Employee', 'Customer', 'Sales', 'COGS', 'Gross margin', 'Transport', 'Loading', 'Adjusted GM', 'GM %'].map((heading) => <th key={heading} className={`px-3 py-3 ${['Sales', 'COGS', 'Gross margin', 'Transport', 'Loading', 'Adjusted GM', 'GM %'].includes(heading) ? 'text-right' : ''}`}>{heading}</th>)}
              </tr></thead>
              <tbody>{data.items.map((item) => <tr key={item.moveId} className="border-b border-border-custom/70 align-top hover:bg-background/50">
                <td className="whitespace-nowrap px-3 py-3 font-bold">{item.type}</td>
                <td className="whitespace-nowrap px-3 py-3">{date(item.date)}</td>
                <td className="whitespace-nowrap px-3 py-3 font-mono font-bold text-cyan-700">{item.number}</td>
                <td className="whitespace-nowrap px-3 py-3 font-mono">{item.salesOrders.join(', ') || '—'}</td>
                <td className="whitespace-nowrap px-3 py-3 font-semibold">{item.salesperson || '—'}</td>
                <td className="px-3 py-3 font-semibold">{item.customer || '—'}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono">{money(item.sales)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono">{money(item.cogs)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono">{money(item.grossMargin)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono">{money(item.transport)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono">{money(item.loading)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-black">{money(item.adjustedGrossMargin)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono">{item.marginPercent.toFixed(2)}%</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No invoice actuals" detail="No posted customer invoice P&L lines were found for these filters." />}
      </Card>

      {data && data.total > 0 && <div className="flex items-center justify-end gap-2">
        <button disabled={loading || data.page <= 1} onClick={() => void load(applied, data.page - 1)} className={secondaryButtonClass}>Previous</button>
        <span className="px-3 text-xs font-bold">Page {data.page.toLocaleString('en-IN')} of {data.pageCount.toLocaleString('en-IN')}</span>
        <button disabled={loading || data.page >= data.pageCount} onClick={() => void load(applied, data.page + 1)} className={secondaryButtonClass}>Next</button>
      </div>}
    </main>
  );
}
