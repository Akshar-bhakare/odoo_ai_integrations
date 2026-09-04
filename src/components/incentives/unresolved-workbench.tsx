'use client';

import { useCallback, useEffect, useState } from 'react';
import { useIncentiveSession } from './session-context';
import { Badge, buttonClass, Card, EmptyState, ErrorBanner, inputClass, LoadingState, secondaryButtonClass } from './ui';
import type { EmployeeRecord, UnresolvedRecord } from '@/lib/incentives/ui/types';
import { date, money } from '@/lib/incentives/ui/format';

type Kind = 'expense' | 'commission' | 'owner';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function UnresolvedWorkbench({ initialMonth }: { initialMonth: string }) {
  const { request } = useIncentiveSession();
  const [month, setMonth] = useState(/^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : currentMonth());
  const [expenses, setExpenses] = useState<UnresolvedRecord[]>([]);
  const [commissions, setCommissions] = useState<UnresolvedRecord[]>([]);
  const [owners, setOwners] = useState<UnresolvedRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [selected, setSelected] = useState<{ kind: Kind; item: UnresolvedRecord } | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = encodeURIComponent(month);
      const data = await request<{
        expenses: UnresolvedRecord[];
        commissions: UnresolvedRecord[];
        owners: UnresolvedRecord[];
        employees: EmployeeRecord[];
      }>(`/api/incentives/unresolved/workbench?month=${query}`);
      setExpenses(data.expenses);
      setCommissions(data.commissions);
      setOwners(data.owners);
      setEmployees(data.employees);
      setEmployeeId((value) => value || String(data.employees[0]?.id ?? ''));
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : 'Could not load unresolved work');
    } finally {
      setLoading(false);
    }
  }, [month, request]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function choose(kind: Kind, item: UnresolvedRecord) {
    setSelected({ kind, item });
    setReason('');
    setNotes('');
    setError('');
  }

  async function resolve() {
    if (!selected || !employeeId || !reason.trim()) return;
    setSaving(true);
    setError('');
    try {
      if (selected.kind === 'expense') {
        if (!selected.item.moveId) throw new Error('The accounting move for this expense could not be resolved');
        await request('/api/incentives/attributions/expenses', {
          method: 'POST',
          body: JSON.stringify({
            moveId: selected.item.moveId,
            employeeId: Number(employeeId),
            attributedAmount: selected.item.amount ?? 0,
            reason,
            notes,
          }),
        });
      } else if (selected.kind === 'commission') {
        await request('/api/incentives/attributions/commissions', {
          method: 'POST',
          body: JSON.stringify({ moveLineId: Number(selected.item.sourceId), employeeId: Number(employeeId), reason, notes }),
        });
      } else {
        if (!selected.item.eventKey) throw new Error('Customer event key is missing');
        await request('/api/incentives/attributions/customer-owners', {
          method: 'POST',
          body: JSON.stringify({ eventKey: selected.item.eventKey, employeeId: Number(employeeId), reason, notes }),
        });
      }
      setSelected(null);
      await load();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : 'Resolution failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-5 md:px-7">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div><div className="text-[10px] font-black uppercase tracking-[0.22em] text-accent-custom">Data Resolution</div><h1 className="mt-1 text-2xl font-black tracking-tight">Unresolved incentive sources</h1><p className="mt-1 text-xs text-muted-custom">Assignments affect incentives only. Accounting ownership remains unchanged and amounts are never split.</p></div>
        <label className="w-52 text-[9px] font-bold uppercase tracking-wider text-muted-custom">Calendar month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={`${inputClass} mt-1`} /></label>
      </div>
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="Inspecting posted Odoo sources…" /> : (
        <>
          <Card title={`Unassigned expenses · ${expenses.length}`}>
            {expenses.length === 0 ? <EmptyState title="No unresolved expenses" detail="All employee-related expenses in this period have one authoritative employee attribution." /> : <ResolutionTable kind="expense" items={expenses} onChoose={choose} />}
          </Card>
          <Card title={`Unresolved commissions · ${commissions.length}`}>
            {commissions.length === 0 ? <EmptyState title="No unresolved commissions" detail="All posted account 211810 lines in this period have one employee attribution." /> : <ResolutionTable kind="commission" items={commissions} onChoose={choose} />}
          </Card>
          <Card title={`Unresolved customer owners · ${owners.length}`}>
            {owners.length === 0 ? <EmptyState title="No unresolved customer owners" detail="Every qualifying customer event has an event-date employee owner or approved manual resolution." /> : <ResolutionTable kind="owner" items={owners} onChoose={choose} />}
          </Card>
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
          <div className="w-full max-w-lg rounded-xl border border-border-custom bg-card-bg shadow-2xl">
            <div className="flex items-start justify-between border-b border-border-custom p-4"><div><div className="text-[9px] font-black uppercase tracking-widest text-accent-custom">{selected.kind} resolution</div><h2 className="mt-1 text-base font-black">{selected.item.description ?? selected.item.customer ?? selected.item.message}</h2></div><button onClick={() => setSelected(null)} className={secondaryButtonClass}>Close</button></div>
            <div className="space-y-4 p-4">
              <div className="rounded-lg bg-background p-3 text-xs text-muted-custom">{selected.item.message}</div>
              <label className="block text-[9px] font-bold uppercase tracking-wider text-muted-custom">Assign exactly one employee<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className={`${inputClass} mt-1`}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
              <label className="block text-[9px] font-bold uppercase tracking-wider text-muted-custom">Reason<input required value={reason} onChange={(event) => setReason(event.target.value)} className={`${inputClass} mt-1`} placeholder="Why this employee is authoritative" /></label>
              <label className="block text-[9px] font-bold uppercase tracking-wider text-muted-custom">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} className={`${inputClass} mt-1 min-h-20 py-2`} /></label>
              <button disabled={saving || !employeeId || !reason.trim()} onClick={resolve} className={`${buttonClass} w-full`}>{saving ? 'Saving…' : 'Confirm incentive attribution'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ResolutionTable({ kind, items, onChoose }: { kind: Kind; items: UnresolvedRecord[]; onChoose(kind: Kind, item: UnresolvedRecord): void }) {
  return <div className="overflow-x-auto"><table className="min-w-[900px] w-full text-xs"><thead><tr className="border-b border-border-custom bg-background/60 text-left text-[9px] font-black uppercase tracking-wider text-muted-custom"><th className="px-3 py-3">Source</th><th className="px-3 py-3">Date</th><th className="px-3 py-3 text-right">Amount / Billing</th><th className="px-3 py-3">Description / Account</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Action</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.type}:${item.sourceId}:${item.eventKey ?? ''}`} className="border-b border-border-custom/70"><td className="px-3 py-3 font-mono">{kind === 'owner' ? item.customer : `${item.sourceModel} #${item.sourceId}`}</td><td className="px-3 py-3">{date(item.eventDate ?? item.date)}</td><td className="px-3 py-3 text-right font-mono font-bold">{money(item.billing ?? item.amount)}</td><td className="max-w-md px-3 py-3"><div className="font-semibold">{item.description ?? item.message}</div>{item.account && <div className="mt-1 text-[10px] text-muted-custom">{item.account}</div>}{item.grossMargin !== null && item.grossMargin !== undefined && <div className="mt-1 text-[10px] text-muted-custom">GM {money(item.grossMargin)}</div>}</td><td className="px-3 py-3"><Badge value={kind === 'owner' ? 'pending owner' : 'unresolved'} /></td><td className="px-3 py-3 text-right"><button onClick={() => onChoose(kind, item)} className={secondaryButtonClass}>Assign employee</button></td></tr>)}</tbody></table></div>;
}
