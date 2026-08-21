'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

const LOGO = '/WhatsApp Image 2026-08-01 at 1.15.58 PM.jpeg';

type Order = {
  id: number;
  name: string;
  date_order: string;
  partner_id: [number, string] | false;
  user_id: [number, string] | false;
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  invoice_status: string;
  margin: number;
  margin_percent: number;
  state: string;
  invoice_ids?: number[];
};

const INV_STATUS: Record<string, { label: string; cls: string }> = {
  invoiced:   { label: 'Invoiced',   cls: 'text-green-700 bg-green-50' },
  'to invoice': { label: 'To Invoice', cls: 'text-amber-700 bg-amber-50' },
  no:         { label: 'No Invoice', cls: 'text-gray-500 bg-gray-100' },
  upselling:  { label: 'Upselling',  cls: 'text-blue-700 bg-blue-50' },
};

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  draft:  { label: 'Draft',    cls: 'text-gray-500 bg-gray-100' },
  sent:   { label: 'Sent',     cls: 'text-blue-700 bg-blue-50' },
  sale:   { label: 'Confirmed',cls: 'text-green-700 bg-green-50' },
  done:   { label: 'Locked',   cls: 'text-purple-700 bg-purple-50' },
  cancel: { label: 'Cancelled',cls: 'text-red-700 bg-red-50' },
};

function fmt(v: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);
}

function fmtDate(s: string) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function Badge({ status, map }: { status: string; map: Record<string, { label: string; cls: string }> }) {
  const s = map[status] ?? { label: status, cls: 'text-gray-500 bg-gray-100' };
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${s.cls}`}>{s.label}</span>;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('all');
  const [orderStatus, setOrderStatus] = useState('all');

  const router = useRouter();

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (search.trim()) p.append('search', search.trim());
      if (invoiceStatus !== 'all') p.append('invoiceStatus', invoiceStatus);
      if (orderStatus !== 'all') p.append('orderStatus', orderStatus);
      const res = await fetch(`/api/odoo/orders?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to fetch orders');
      setOrders(data.orders ?? []);
    } catch (errorValue: unknown) {
      setError(errorValue instanceof Error ? errorValue.message : 'Could not load orders.');
    } finally {
      setLoading(false);
    }
  }, [search, invoiceStatus, orderStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchOrders(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchOrders]);

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      {/* Nav */}
      <header className="h-11 border-b border-border-custom bg-background px-4 md:px-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/odoo/orders">
            <Image src={LOGO} alt="Sunlectric" width={90} height={28} className="object-contain" />
          </Link>
          <span className="text-[10px] font-bold tracking-widest text-muted-custom uppercase">/ Sales Orders</span>
        </div>
        <span className="text-[10px] font-bold tracking-widest text-muted-custom">
          {loading ? '…' : `${orders.length} orders`}
        </span>
      </header>

      <main className="flex-1 flex flex-col px-4 md:px-8 py-4 gap-3 max-w-[1600px] w-full mx-auto">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={e => { e.preventDefault(); setSearch(searchInput.trim()); }} className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Order / customer…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="h-8 text-xs px-2.5 border border-border-custom bg-background rounded outline-none w-48 focus:border-foreground/40"
            />
            <button type="submit" className="h-8 px-3 bg-foreground text-background text-xs rounded font-semibold">Go</button>
          </form>

          <select
            value={invoiceStatus}
            onChange={e => setInvoiceStatus(e.target.value)}
            className="h-8 text-xs px-2 border border-border-custom bg-background rounded outline-none"
          >
            <option value="all">All Invoice Status</option>
            <option value="invoiced">Invoiced</option>
            <option value="to invoice">To Invoice</option>
            <option value="no">No Invoice</option>
            <option value="upselling">Upselling</option>
          </select>

          <select
            value={orderStatus}
            onChange={e => setOrderStatus(e.target.value)}
            className="h-8 text-xs px-2 border border-border-custom bg-background rounded outline-none"
          >
            <option value="all">All Order Status</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="sale">Confirmed</option>
            <option value="done">Locked</option>
            <option value="cancel">Cancelled</option>
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2 rounded">{error}</div>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded border border-border-custom bg-card-bg">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border-custom bg-background text-[10px] font-bold tracking-widest uppercase text-muted-custom">
                <th className="px-3 py-2 text-left w-28">Order</th>
                <th className="px-3 py-2 text-left w-24">Date</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left w-28">Salesperson</th>
                <th className="px-3 py-2 text-center w-20">Status</th>
                <th className="px-3 py-2 text-center w-24">Invoice</th>
                <th className="px-3 py-2 text-right w-28">Untaxed</th>
                <th className="px-3 py-2 text-right w-28">Total</th>
                <th className="px-3 py-2 text-right w-28">Margin</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 14 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-custom animate-pulse">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-3 py-2.5">
                        <div className="h-2.5 bg-gray-200 rounded w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-custom">No orders match your criteria.</td>
                </tr>
              ) : (
                orders.map(o => {
                  const raw = o.margin_percent ?? 0;
                  const mp = raw > 0 && raw < 1 ? raw * 100 : raw;
                  const mpColor = mp >= 15 ? 'text-green-700' : mp >= 5 ? 'text-amber-700' : 'text-red-600';
                  return (
                    <tr
                      key={o.id}
                      onClick={() => router.push(`/odoo/orders/${o.id}`)}
                      className="border-b border-border-custom hover:bg-background/60 transition-colors cursor-pointer"
                    >
                      <td className="px-3 py-2 font-mono font-semibold text-foreground">{o.name}</td>
                      <td className="px-3 py-2 text-muted-custom tabular-nums">{fmtDate(o.date_order)}</td>
                      <td className="px-3 py-2 text-foreground max-w-[200px] truncate" title={o.partner_id ? o.partner_id[1] : ''}>
                        {o.partner_id ? o.partner_id[1] : <span className="text-muted-custom">—</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-custom truncate">
                        {o.user_id ? o.user_id[1] : <span className="italic">Unassigned</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge status={o.state} map={ORDER_STATUS} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge status={o.invoice_status} map={INV_STATUS} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-custom tabular-nums">{fmt(o.amount_untaxed)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-foreground tabular-nums">{fmt(o.amount_total)}</td>
                      <td className={`px-3 py-2 text-right font-mono tabular-nums ${mpColor}`}>
                        {mp.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
