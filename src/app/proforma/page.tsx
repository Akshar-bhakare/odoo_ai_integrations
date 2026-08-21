'use client';

import { useEffect, useMemo, useState } from 'react';

type Product = {
  id: number;
  sku: string | null;
  name: string;
  category: string | null;
  available: number;
  taxIds: number[];
  taxNames: string[];
  taxRate: number;
};

type DraftLine = {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
};

export default function ProformaPage() {
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [validityDays, setValidityDays] = useState(15);
  const [selected, setSelected] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/odoo/proforma');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load products.');
        setCompanyId(data.companyId ?? null);
        setProducts(data.products ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load products.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const addProduct = (product: Product) => {
    setSelected((current) => {
      const existing = current.find((entry) => entry.productId === product.id);
      if (existing) {
        return current.map((entry) =>
          entry.productId === product.id ? { ...entry, quantity: entry.quantity + 1 } : entry,
        );
      }
      return [...current, {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: 0,
      }];
    });
  };

  const updateLine = (productId: number, next: Partial<DraftLine>) => {
    setSelected((current) => current.map((line) => line.productId === productId ? { ...line, ...next } : line));
  };

  const removeLine = (productId: number) => {
    setSelected((current) => current.filter((line) => line.productId !== productId));
  };

  const subtotal = useMemo(() =>
    selected.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [selected],
  );

  const gst = useMemo(() => {
    const productTaxMap = new Map(products.map((product) => [product.id, product.taxRate]));
    return selected.reduce((sum, line) => {
      const rate = productTaxMap.get(line.productId) ?? 0;
      return sum + (line.quantity * line.unitPrice * rate) / 100;
    }, 0);
  }, [products, selected]);

  const total = subtotal + gst;

  const downloadPdf = async () => {
    if (!companyId) {
      setError('Company context is not available.');
      return;
    }
    if (!customerSearch.trim()) {
      setError('Enter the customer name or customer code to search for in Odoo.');
      return;
    }
    if (selected.length === 0) {
      setError('Add at least one product line before downloading the PI.');
      return;
    }

    const compromised = selected.some((line) => line.quantity <= 0 || line.unitPrice < 0);
    if (compromised) {
      setError('Each filled line needs a quantity greater than zero and a valid unit price.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      const response = await fetch('/api/odoo/proforma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          customerSearch,
          issueDate,
          validityDays,
          lines: selected.map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
          })),
        }),
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Could not generate the PI PDF.');
      }
      if (!contentType.includes('application/pdf')) {
        throw new Error('The server did not return a PDF file.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `proforma-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Proforma invoice PDF downloaded successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate PDF.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border-custom bg-background px-4 py-3 md:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.28rem] text-muted-custom">ERP Portal</div>
            <h1 className="text-xl font-bold">Proforma Invoice</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</div>
        )}
        {message && (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{message}</div>
        )}

        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <section className="rounded border border-border-custom bg-card-bg p-4">
            <div className="mb-4 text-xs font-bold uppercase tracking-[0.2rem] text-muted-custom">Available Products</div>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-12 animate-pulse rounded bg-gray-200" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="text-sm text-muted-custom">No in-stock products are currently available.</div>
            ) : (
              <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
                {products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    className="flex w-full items-center justify-between gap-3 rounded border border-border-custom bg-background px-3 py-2 text-left transition hover:border-foreground/30"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{product.name}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-custom">
                        {product.sku ? `SKU ${product.sku}` : 'No SKU'} · {product.taxRate}% GST · Stock {product.available}
                      </div>
                    </div>
                    <span className="rounded bg-foreground px-2 py-1 text-[10px] font-bold text-background">Add</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded border border-border-custom bg-card-bg p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="text-xs font-medium text-muted-custom">
                <span className="mb-2 block uppercase tracking-[0.18rem]">Customer</span>
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Customer name / code"
                  className="h-10 w-full rounded border border-border-custom bg-background px-3 text-sm outline-none focus:border-foreground/40"
                />
              </label>

              <label className="text-xs font-medium text-muted-custom">
                <span className="mb-2 block uppercase tracking-[0.18rem]">Issue Date</span>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="h-10 w-full rounded border border-border-custom bg-background px-3 text-sm outline-none focus:border-foreground/40"
                />
              </label>

              <label className="text-xs font-medium text-muted-custom">
                <span className="mb-2 block uppercase tracking-[0.18rem]">Validity</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={validityDays}
                  onChange={(e) => setValidityDays(Number(e.target.value || 15))}
                  className="h-10 w-full rounded border border-border-custom bg-background px-3 text-sm outline-none focus:border-foreground/40"
                />
              </label>
            </div>

            <div className="mt-6 overflow-x-auto rounded border border-border-custom">
              <table className="w-full text-left text-xs">
                <thead className="bg-background text-[10px] font-bold uppercase tracking-[0.18rem] text-muted-custom">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Unit Price</th>
                    <th className="px-3 py-2">GST</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {selected.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-custom">No products added yet.</td>
                    </tr>
                  ) : (
                    selected.map((line) => {
                      const product = products.find((item) => item.id === line.productId);
                      const lineTax = product?.taxRate ?? 0;
                      const lineAmount = line.quantity * line.unitPrice;
                      const gstValue = (lineAmount * lineTax) / 100;
                      return (
                        <tr key={line.productId} className="border-t border-border-custom align-top">
                          <td className="px-3 py-3">
                            <div className="font-semibold">{line.productName}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-custom">{product?.sku ?? 'No SKU'}</div>
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="number"
                              min={1}
                              value={line.quantity}
                              onChange={(e) => updateLine(line.productId, { quantity: Number(e.target.value || 1) })}
                              className="h-9 w-20 rounded border border-border-custom bg-background px-2 text-sm outline-none focus:border-foreground/40"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.unitPrice}
                              onChange={(e) => updateLine(line.productId, { unitPrice: Number(e.target.value || 0) })}
                              className="h-9 w-28 rounded border border-border-custom bg-background px-2 text-sm outline-none focus:border-foreground/40"
                            />
                          </td>
                          <td className="px-3 py-3 text-sm font-medium">{lineTax}%</td>
                          <td className="px-3 py-3 text-right text-sm font-semibold">₹{(lineAmount + gstValue).toFixed(2)}</td>
                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() => removeLine(line.productId)}
                              className="text-[10px] font-bold uppercase tracking-[0.18rem] text-red-600"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex flex-col items-end gap-3">
              <div className="w-full max-w-xs rounded border border-border-custom bg-background p-3 text-xs">
                <div className="flex items-center justify-between py-1"><span>Subtotal</span><span className="font-semibold">₹{subtotal.toFixed(2)}</span></div>
                <div className="flex items-center justify-between py-1"><span>GST</span><span className="font-semibold">₹{gst.toFixed(2)}</span></div>
                <div className="mt-2 flex items-center justify-between border-t border-border-custom pt-2 text-sm font-bold"><span>Total</span><span>₹{total.toFixed(2)}</span></div>
              </div>
              <button
                type="button"
                onClick={downloadPdf}
                disabled={submitting || loading}
                className="rounded bg-foreground px-5 py-2.5 text-xs font-bold uppercase tracking-[0.2rem] text-background disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Generating...' : 'Download PI PDF'}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
