'use client';

import { use, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';

const LOGO = '/WhatsApp Image 2026-08-01 at 1.15.58 PM.jpeg';
function NavLogo() {
  return (
    <Link href="/odoo/orders">
      <Image src={LOGO} alt="Sunlectric" width={90} height={28} className="object-contain" />
    </Link>
  );
}

interface TaxLine {
  id: number;
  name: string;
  tax_line_id: [number, string] | false;
  tax_group_id: [number, string] | false;
  balance: number;
  credit: number;
  debit: number;
}

interface Attachment {
  id: number;
  name: string;
  mimetype: string;
  file_size: number;
}

interface OrderDetailResponse {
  order: {
    id: number;
    name: string;
    date_order: string;
    partner_id: [number, string] | false;
    partner_shipping_id: [number, string] | false;
    user_id: [number, string] | false;
    amount_untaxed: number;
    amount_tax: number;
    amount_total: number;
    invoice_status: string;
    margin: number;
    margin_percent: number;
    currency_id: [number, string] | false;
    state: string;
    note: string | false;
  };
  partner: {
    id: number;
    name: string;
    street: string | false;
    street2: string | false;
    city: string | false;
    zip: string | false;
    state_id: [number, string] | false;
    country_id: [number, string] | false;
    vat: string | false;
    l10n_in_gst_treatment?: string | false;
  } | null;
  invoices: Array<{
    id: number;
    name: string;
    move_type: string;
    invoice_date: string | false;
    invoice_date_due: string | false;
    amount_untaxed: number;
    amount_tax: number;
    amount_total: number;
    amount_residual: number;
    state: string;
    payment_state: string;
    x_studio_warranty_done?: boolean;
    x_studio_dcr_done?: boolean;
    x_studio_dcr_done_1?: boolean;
  }>;
  invoiceLines: Array<{
    id: number;
    product_id: [number, string] | false;
    name: string;
    quantity: number;
    price_unit: number;
    price_subtotal: number;
    price_total: number;
  }>;
  taxLines?: TaxLine[];
  attachments: Attachment[];
}

function formatINR(value: number) {
  const abs = Math.abs(value);
  const s = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs);
  return `${value < 0 ? '-' : ''}₹${s}`;
}

function formatDate(d: string | false) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatSize(b: number) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function ext(name: string) {
  const p = name.split('.');
  return p.length > 1 ? p[p.length - 1].toUpperCase() : 'DOC';
}

function isPreviewable(mime: string) {
  return mime.startsWith('image/') || mime === 'application/pdf';
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[9px] font-bold tracking-widest uppercase text-muted-custom mb-0.5">{label}</span>
      <span className="text-xs font-semibold text-foreground">{value}</span>
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-bold tracking-widest uppercase text-muted-custom border-b border-border-custom pb-1.5 mb-3">
      {children}
    </h2>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const orderId = parseInt(id, 10);

  const [data, setData] = useState<OrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  // previewSrc is a URL string (works for both real attachments and virtual invoice PDFs)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>('');

  const fetchOrderDetail = useCallback(async () => {
    if (isNaN(orderId)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/odoo/orders/${orderId}`);
      const json = await res.json() as OrderDetailResponse & { message?: string };
      if (!res.ok) throw new Error(json.message || 'Failed to fetch order details');
      setData(json);
      // Auto-select the first posted invoice PDF for preview
      const firstInvoice = json.invoices.find((invoice) => invoice.state === 'posted');
      if (firstInvoice) {
        setPreviewSrc(`/api/odoo/invoice-pdf/${firstInvoice.id}`);
        setPreviewName(firstInvoice.name);
      } else {
        // Fall back to first previewable attachment
        const first = (json.attachments as Attachment[]).find(a => isPreviewable(a.mimetype));
        if (first) {
          setPreviewSrc(`/api/odoo/attachments/${first.id}`);
          setPreviewName(first.name);
        }
      }
    } catch (errorValue: unknown) {
      setError(errorValue instanceof Error ? errorValue.message : 'Could not load order details from Odoo.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchOrderDetail(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchOrderDetail]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col font-sans">
        <header className="h-11 border-b border-border-custom bg-background px-4 md:px-8 flex items-center">
          <NavLogo />
        </header>
        <main className="flex-1 px-4 md:px-8 py-6 max-w-[1600px] w-full mx-auto animate-pulse flex flex-col gap-4">
          <div className="h-3 w-20 bg-gray-200 rounded" />
          <div className="h-6 w-64 bg-gray-200 rounded" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded" />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-48 bg-gray-100 rounded" />
            <div className="h-48 bg-gray-100 rounded" />
          </div>
          <div className="h-40 bg-gray-100 rounded" />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col font-sans">
        <header className="h-11 border-b border-border-custom bg-background px-4 md:px-8 flex items-center">
          <NavLogo />
        </header>
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="border border-red-200 bg-red-50 p-6 rounded text-sm text-red-700 max-w-md w-full flex flex-col gap-3">
            <strong>Error loading order</strong>
            <p className="text-xs font-mono">{error ?? 'Unknown error'}</p>
            <div className="flex gap-2">
              <Link href="/odoo/orders" className="px-3 py-1.5 bg-foreground text-background text-xs rounded font-semibold">← Back</Link>
              <button onClick={fetchOrderDetail} className="px-3 py-1.5 border border-border-custom text-xs rounded font-semibold">Retry</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const { order, partner, invoices, invoiceLines, attachments, taxLines = [] } = data;
  const primaryInvoice = invoices[0] ?? null;

  const raw = order.margin_percent ?? 0;
  const marginPct = raw > 0 && raw < 1 ? raw * 100 : raw;

  const untaxed = primaryInvoice?.amount_untaxed ?? order.amount_untaxed;
  const total = primaryInvoice?.amount_total ?? order.amount_total;
  const residual = primaryInvoice?.amount_residual ?? order.amount_total;
  const rounding = total - (untaxed + (primaryInvoice?.amount_tax ?? order.amount_tax));

  // Aggregate tax lines by name from real Odoo data
  const taxMap = new Map<string, number>();
  for (const tl of taxLines) {
    const name = tl.name || (tl.tax_line_id ? tl.tax_line_id[1] : 'Tax');
    // balance is negative for tax credit lines in Odoo; use Math.abs
    taxMap.set(name, (taxMap.get(name) ?? 0) + Math.abs(tl.balance));
  }
  const aggregatedTaxes = Array.from(taxMap.entries());

  const stateName = partner?.state_id ? partner.state_id[1] : '';
  const countryName = partner?.country_id ? partner.country_id[1] : '';

  const paymentLabel = (ps: string) => {
    const m: Record<string, string> = { paid: 'PAID', in_payment: 'IN PAYMENT', partial: 'PARTIAL', reversed: 'REVERSED', not_paid: 'UNPAID' };
    return m[ps] ?? 'UNPAID';
  };

  const invStatusLabel = (s: string) => {
    const m: Record<string, string> = { invoiced: 'INVOICED', 'to invoice': 'TO INVOICE', no: 'NO INVOICE', upselling: 'UPSELLING' };
    return m[s] ?? s.toUpperCase();
  };

  const previewAtt = attachments.find(a => `/api/odoo/attachments/${a.id}` === previewSrc) ?? null;
  const hasPreview = !!previewSrc;

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans selection:bg-accent-custom/20">
      {/* Nav */}
      <header className="h-11 border-b border-border-custom bg-background px-4 md:px-8 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <NavLogo />
          <span className="text-[10px] font-bold tracking-widest text-muted-custom">/ <Link href="/odoo/orders" className="hover:text-foreground">Orders</Link> / {order.name}</span>
        </div>
        <span className="text-[10px] font-bold tracking-widest text-muted-custom uppercase">{order.state}</span>
      </header>

      <main className="flex-1 px-4 md:px-8 py-4 max-w-[1600px] w-full mx-auto flex flex-col gap-4">

        {/* Title row */}
        <div className="flex items-baseline justify-between gap-4 border-b border-border-custom pb-3">
          <div>
            <h1 className="text-xl font-black tracking-tight text-foreground">
              {partner?.name ?? 'No Customer'}
            </h1>
            <p className="text-[10px] text-muted-custom mt-0.5">
              {order.name} · {formatDate(order.date_order)} · {order.user_id ? order.user_id[1] : 'Unassigned'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-black text-foreground tabular-nums">{formatINR(total)}</div>
            <div className="text-[9px] font-bold tracking-widest text-muted-custom uppercase">Order Total</div>
          </div>
        </div>

        {/* Status strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Invoice Status', value: invStatusLabel(order.invoice_status), highlight: order.invoice_status === 'invoiced' },
            { label: 'Payment', value: primaryInvoice ? paymentLabel(primaryInvoice.payment_state) : 'N/A', highlight: primaryInvoice?.payment_state === 'paid' },
            { label: 'Margin', value: `${marginPct.toFixed(1)}%`, highlight: marginPct >= 10 },
            { label: 'Amount Due', value: formatINR(residual), highlight: residual === 0 },
          ].map(({ label, value, highlight }) => (
            <div key={label} className="bg-card-bg border border-border-custom rounded px-3 py-2">
              <div className="text-[9px] font-bold tracking-widest uppercase text-muted-custom">{label}</div>
              <div className={`text-xs font-bold mt-0.5 ${highlight ? 'text-green-700' : 'text-foreground'}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Two-column: left = detail panels, right = sticky document preview */}
        <div className="flex gap-4 items-start">

          {/* LEFT COLUMN */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">

            {/* Customer + Invoice row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Customer */}
              <div className="bg-card-bg border border-border-custom rounded p-4">
                <SectionHead>Customer</SectionHead>
                <div className="flex flex-col gap-2.5 text-xs">
                  <div className="font-semibold text-foreground text-sm">{partner?.name ?? '—'}</div>
                  {partner && (partner.street || partner.city) && (
                    <address className="not-italic text-muted-custom leading-relaxed">
                      {[partner.street, partner.street2, partner.city, partner.zip].filter(Boolean).join(', ')}
                      {stateName && <span className="block">{stateName}{countryName ? `, ${countryName}` : ''}</span>}
                    </address>
                  )}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border-custom/40">
                    <KV label="GSTIN" value={<span className="font-mono">{partner?.vat || '—'}</span>} />
                    <KV label="GST Treatment" value={partner?.l10n_in_gst_treatment ? String(partner.l10n_in_gst_treatment).replace(/_/g, ' ') : '—'} />
                    <KV label="Place of Supply" value={stateName || '—'} />
                  </div>
                </div>
              </div>

              {/* Invoice */}
              <div className="bg-card-bg border border-border-custom rounded p-4">
                <SectionHead>Invoice</SectionHead>
                {!primaryInvoice ? (
                  <div className="text-xs text-muted-custom italic">No invoice generated.</div>
                ) : (
                  <div className="flex flex-col gap-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-foreground">{primaryInvoice.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${primaryInvoice.state === 'posted' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {primaryInvoice.state.toUpperCase()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border-custom/40">
                      <KV label="Invoice Date" value={formatDate(primaryInvoice.invoice_date)} />
                      <KV label="Due Date" value={formatDate(primaryInvoice.invoice_date_due)} />
                      <KV label="Payment State" value={paymentLabel(primaryInvoice.payment_state)} />
                      <KV label="Amount Residual" value={formatINR(primaryInvoice.amount_residual)} />
                      {primaryInvoice.x_studio_warranty_done !== undefined && (
                        <KV label="Warranty" value={primaryInvoice.x_studio_warranty_done ? 'Done' : 'Pending'} />
                      )}
                      {(primaryInvoice.x_studio_dcr_done !== undefined || primaryInvoice.x_studio_dcr_done_1 !== undefined) && (
                        <KV label="DCR" value={(primaryInvoice.x_studio_dcr_done || primaryInvoice.x_studio_dcr_done_1) ? 'Done' : 'Pending'} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Invoice Lines */}
            <div className="bg-card-bg border border-border-custom rounded p-4">
              <SectionHead>Invoice Lines</SectionHead>
              {invoiceLines.length === 0 ? (
                <p className="text-xs text-muted-custom italic">No lines available.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border-custom text-[9px] font-bold tracking-widest uppercase text-muted-custom">
                        <th className="py-2 pr-3 text-left">Product</th>
                        <th className="py-2 px-3 text-center w-12">Qty</th>
                        <th className="py-2 px-3 text-right w-28">Unit Price</th>
                        <th className="py-2 px-3 text-right w-24">Tax</th>
                        <th className="py-2 pl-3 text-right w-28">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceLines.map(line => {
                        const lineTax = line.price_total - line.price_subtotal;
                        const productName = line.product_id
                          ? line.product_id[1].replace(/^\[.*?\]\s*/, '')
                          : line.name;
                        return (
                          <tr key={line.id} className="border-b border-border-custom/50 hover:bg-background/40">
                            <td className="py-2 pr-3 text-foreground font-medium">{productName}</td>
                            <td className="py-2 px-3 text-center text-muted-custom tabular-nums">{line.quantity}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-muted-custom">{formatINR(line.price_unit)}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-muted-custom">{formatINR(lineTax)}</td>
                            <td className="py-2 pl-3 text-right font-mono font-semibold tabular-nums text-foreground">{formatINR(line.price_total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Financial Summary + Terms */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Financial Summary */}
              <div className="bg-card-bg border border-border-custom rounded p-4">
                <SectionHead>Financial Summary</SectionHead>
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between text-muted-custom">
                    <span>Untaxed Amount</span>
                    <span className="font-mono tabular-nums text-foreground">{formatINR(untaxed)}</span>
                  </div>

                  {/* Real tax lines from Odoo */}
                  {aggregatedTaxes.length > 0 ? (
                    aggregatedTaxes.map(([name, amount]) => (
                      <div key={name} className="flex justify-between text-muted-custom">
                        <span>{name}</span>
                        <span className="font-mono tabular-nums text-foreground">{formatINR(amount)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex justify-between text-muted-custom">
                      <span>Tax</span>
                      <span className="font-mono tabular-nums text-foreground">
                        {formatINR(primaryInvoice?.amount_tax ?? order.amount_tax)}
                      </span>
                    </div>
                  )}

                  {Math.abs(rounding) > 0.001 && (
                    <div className="flex justify-between text-muted-custom">
                      <span>Rounding</span>
                      <span className="font-mono tabular-nums text-foreground">{formatINR(rounding)}</span>
                    </div>
                  )}

                  <div className="flex justify-between font-bold border-t border-border-custom/40 pt-2 mt-1">
                    <span className="text-[10px] tracking-widest uppercase text-muted-custom">Total</span>
                    <span className="font-mono tabular-nums text-foreground text-sm">{formatINR(total)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-border-custom/40 pt-2">
                    <span className="text-[10px] tracking-widest uppercase text-accent-custom">Amount Due</span>
                    <span className="font-mono tabular-nums text-accent-custom text-sm">{formatINR(residual)}</span>
                  </div>
                </div>
              </div>

              {/* Terms */}
              <div className="bg-card-bg border border-border-custom rounded p-4">
                <div className="flex items-center justify-between mb-3 border-b border-border-custom pb-1.5">
                  <h2 className="text-[10px] font-bold tracking-widest uppercase text-muted-custom">Terms & Conditions</h2>
                  {order.note && (
                    <button
                      onClick={() => setShowTerms(v => !v)}
                      className="text-[9px] font-bold uppercase tracking-wider text-accent-custom"
                    >
                      {showTerms ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
                {!order.note ? (
                  <p className="text-xs text-muted-custom italic">No terms specified.</p>
                ) : showTerms ? (
                  <div
                    className="text-xs text-muted-custom leading-relaxed max-h-40 overflow-y-auto prose prose-xs max-w-none"
                    dangerouslySetInnerHTML={{ __html: order.note }}
                  />
                ) : (
                  <p className="text-xs text-muted-custom italic">Click Show to view terms.</p>
                )}
              </div>
            </div>

            {/* Documents list */}
            <div className="bg-card-bg border border-border-custom rounded p-4">
              <SectionHead>Documents</SectionHead>
              <div className="flex flex-col divide-y divide-border-custom/50">

                {/* Virtual invoice PDF entries — one per posted invoice */}
                {invoices.filter(inv => inv.state === 'posted').map(inv => {
                  const src = `/api/odoo/invoice-pdf/${inv.id}`;
                  const active = previewSrc === src;
                  return (
                    <div key={`inv-${inv.id}`} className={`flex items-center justify-between py-2 gap-3 ${active ? 'bg-background/60 -mx-4 px-4' : ''}`}>
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <div className="w-7 h-7 bg-background border border-border-custom rounded flex items-center justify-center text-[8px] font-bold font-mono text-muted-custom shrink-0">PDF</div>
                        <div className="overflow-hidden">
                          <div className="text-xs font-medium text-foreground truncate">{inv.name} — Invoice</div>
                          <div className="text-[9px] text-muted-custom">Generated on demand</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => { setPreviewSrc(active ? null : src); setPreviewName(`${inv.name} — Invoice`); }}
                          className={`px-2 py-1 rounded text-[9px] font-bold border transition-colors ${active ? 'bg-foreground text-background border-foreground' : 'border-border-custom hover:border-foreground'}`}
                        >
                          {active ? 'Viewing' : 'Preview'}
                        </button>
                        <a href={`${src}?download=true`} className="px-2 py-1 rounded text-[9px] font-bold border border-border-custom hover:border-foreground transition-colors">↓</a>
                      </div>
                    </div>
                  );
                })}

                {/* Real stored attachments */}
                {attachments.map(att => {
                  const src = `/api/odoo/attachments/${att.id}`;
                  const active = previewSrc === src;
                  const canPreview = isPreviewable(att.mimetype);
                  return (
                    <div key={att.id} className={`flex items-center justify-between py-2 gap-3 ${active ? 'bg-background/60 -mx-4 px-4' : ''}`}>
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <div className="w-7 h-7 bg-background border border-border-custom rounded flex items-center justify-center text-[8px] font-bold font-mono text-muted-custom shrink-0">{ext(att.name)}</div>
                        <div className="overflow-hidden">
                          <div className="text-xs font-medium text-foreground truncate" title={att.name}>{att.name}</div>
                          <div className="text-[9px] text-muted-custom">{formatSize(att.file_size)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {canPreview && (
                          <button
                            onClick={() => { setPreviewSrc(active ? null : src); setPreviewName(att.name); }}
                            className={`px-2 py-1 rounded text-[9px] font-bold border transition-colors ${active ? 'bg-foreground text-background border-foreground' : 'border-border-custom hover:border-foreground'}`}
                          >
                            {active ? 'Viewing' : 'Preview'}
                          </button>
                        )}
                        <a href={`${src}?download=true`} className="px-2 py-1 rounded text-[9px] font-bold border border-border-custom hover:border-foreground transition-colors">↓</a>
                      </div>
                    </div>
                  );
                })}

                {invoices.filter(inv => inv.state === 'posted').length === 0 && attachments.length === 0 && (
                  <p className="text-xs text-muted-custom italic py-2">No documents available.</p>
                )}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN — sticky document preview */}
          {hasPreview && previewSrc && (
            <div
              className="hidden lg:flex flex-col w-[420px] xl:w-[500px] shrink-0 sticky top-4 self-start"
              style={{ height: 'min(820px, calc(100vh - 80px))' }}
            >
              <div className="bg-card-bg border border-border-custom rounded flex flex-col overflow-hidden h-full">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border-custom shrink-0">
                  <span className="text-[10px] font-bold tracking-widest uppercase text-muted-custom truncate">{previewName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <a href={previewSrc} target="_blank" rel="noopener noreferrer" className="text-[9px] font-bold text-muted-custom hover:text-foreground">Open ↗</a>
                    <a href={`${previewSrc}?download=true`} className="text-[9px] font-bold text-muted-custom hover:text-foreground">↓ Download</a>
                    <button onClick={() => setPreviewSrc(null)} className="text-[9px] font-bold text-muted-custom hover:text-foreground ml-1">✕</button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 bg-gray-50">
                  {(previewSrc.includes('/invoice-pdf/') || (previewAtt?.mimetype === 'application/pdf')) ? (
                    <iframe src={previewSrc} className="w-full h-full border-0" title={previewName} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewSrc} alt={previewName} className="w-full h-full object-contain" />
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
