'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIncentiveSession } from './session-context';
import { Badge, buttonClass, Card, EmptyState, ErrorBanner, inputClass, LoadingState, secondaryButtonClass } from './ui';
import type { AssignmentRecord, EmployeeRecord, PresetVersionRecord } from '@/lib/incentives/ui/types';
import { canAdminister } from '@/lib/incentives/ui/permissions';
import { date, relationId, relationName } from '@/lib/incentives/ui/format';

interface AssignmentForm {
  id: number | null;
  employeeId: string;
  presetVersionId: string;
  effectiveFrom: string;
  effectiveTo: string;
  active: boolean;
}

const emptyForm: AssignmentForm = { id: null, employeeId: '', presetVersionId: '', effectiveFrom: '', effectiveTo: '', active: true };

export function AssignmentAdmin() {
  const { actor, request } = useIncentiveSession();
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [versions, setVersions] = useState<PresetVersionRecord[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [form, setForm] = useState<AssignmentForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await request<{
        assignments: AssignmentRecord[];
        employees: EmployeeRecord[];
        versions: PresetVersionRecord[];
      }>('/api/incentives/assignments/workspace');
      setAssignments(data.assignments); setEmployees(data.employees); setVersions(data.versions);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load assignments'); } finally { setLoading(false); }
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeVersions = versions.filter((version) => version.x_status === 'active' && version.x_locked);
  const effectiveAssignments = useMemo(() => {
    const dateValue = `${selectedMonth}-01`;
    return assignments.filter((assignment) => assignment.x_active && assignment.x_date_from <= dateValue && (!assignment.x_date_to || assignment.x_date_to >= dateValue));
  }, [assignments, selectedMonth]);

  if (!canAdminister(actor)) return <main className="mx-auto w-full max-w-3xl px-4 py-10"><ErrorBanner message="Administrator role is required to manage employee assignments." /></main>;

  function startCreate() {
    setForm({ ...emptyForm, employeeId: String(employees[0]?.id ?? ''), presetVersionId: String(activeVersions[0]?.id ?? ''), effectiveFrom: `${selectedMonth}-01` });
  }

  function startEdit(item: AssignmentRecord) {
    setForm({ id: item.id, employeeId: String(relationId(item.x_employee_id) ?? ''), presetVersionId: String(relationId(item.x_preset_version_id) ?? ''), effectiveFrom: item.x_date_from, effectiveTo: item.x_date_to || '', active: item.x_active });
  }

  async function save() {
    if (!form) return;
    setSaving(true); setError('');
    try {
      const body = JSON.stringify({ employeeId: Number(form.employeeId), presetVersionId: Number(form.presetVersionId), effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo || undefined, active: form.active });
      await request(form.id ? `/api/incentives/assignments/${form.id}` : '/api/incentives/assignments', { method: form.id ? 'PATCH' : 'POST', body });
      setForm(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save assignment'); } finally { setSaving(false); }
  }

  return <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 md:px-7">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="text-[10px] font-black uppercase tracking-[0.22em] text-accent-custom">Configuration</div><h1 className="mt-1 text-2xl font-black tracking-tight">Employee preset assignments</h1><p className="mt-1 text-xs text-muted-custom">One effective active preset version per employee, company, and date. Overlaps are rejected server-side.</p></div><button onClick={startCreate} className={buttonClass}>New assignment</button></div>
    {error && <ErrorBanner message={error} />}
    <Card title="Effective preset lookup"><div className="grid items-end gap-3 p-4 md:grid-cols-[220px_1fr]"><label className="text-[9px] font-bold uppercase tracking-wider text-muted-custom">Selected month<input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className={`${inputClass} mt-1`} /></label><div className="flex flex-wrap gap-2">{effectiveAssignments.length === 0 ? <span className="text-xs text-muted-custom">No assignments apply to this month.</span> : effectiveAssignments.map((assignment) => <span key={assignment.id} className="rounded-lg border border-border-custom bg-background px-3 py-2 text-xs"><strong>{relationName(assignment.x_employee_id)}</strong><span className="mx-2 text-muted-custom">→</span>{relationName(assignment.x_preset_version_id)}</span>)}</div></div></Card>
    <Card title={`Assignments · ${assignments.length}`}>
      {loading ? <LoadingState /> : assignments.length === 0 ? <EmptyState title="No employee assignments" detail="Create an effective-dated assignment after activating a preset version." /> : <div className="overflow-x-auto"><table className="min-w-[900px] w-full text-xs"><thead><tr className="border-b border-border-custom bg-background/60 text-left text-[9px] font-black uppercase tracking-wider text-muted-custom">{['Employee', 'Preset version', 'Company', 'Effective from', 'Effective to', 'Status', 'Action'].map((item) => <th key={item} className="px-3 py-3">{item}</th>)}</tr></thead><tbody>{assignments.map((item) => <tr key={item.id} className="border-b border-border-custom/70"><td className="px-3 py-3 font-bold">{relationName(item.x_employee_id)}</td><td className="px-3 py-3">{relationName(item.x_preset_version_id)}</td><td className="px-3 py-3">{relationName(item.x_company_id)}</td><td className="px-3 py-3">{date(item.x_date_from)}</td><td className="px-3 py-3">{date(item.x_date_to)}</td><td className="px-3 py-3"><Badge value={item.x_active ? 'active' : 'inactive'} /></td><td className="px-3 py-3"><button onClick={() => startEdit(item)} className={secondaryButtonClass}>Edit</button></td></tr>)}</tbody></table></div>}
    </Card>
    {form && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"><div className="w-full max-w-xl rounded-xl border border-border-custom bg-card-bg shadow-2xl"><div className="flex items-center justify-between border-b border-border-custom p-4"><h2 className="text-lg font-black">{form.id ? 'Edit assignment' : 'New assignment'}</h2><button onClick={() => setForm(null)} className={secondaryButtonClass}>Close</button></div><div className="grid gap-3 p-4 md:grid-cols-2"><Field label="Employee"><select disabled={form.id !== null} value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} className={inputClass}>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></Field><Field label="Preset version"><select value={form.presetVersionId} onChange={(event) => setForm({ ...form, presetVersionId: event.target.value })} className={inputClass}>{activeVersions.map((version) => <option key={version.id} value={version.id}>{version.x_name}</option>)}</select></Field><Field label="Effective from"><input type="date" required value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} className={inputClass} /></Field><Field label="Effective to"><input type="date" value={form.effectiveTo} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })} className={inputClass} /></Field><Field label="Active"><select value={String(form.active)} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })} className={inputClass}><option value="true">Active</option><option value="false">Inactive</option></select></Field><div className="md:col-span-2 rounded-lg bg-background p-3 text-[10px] text-muted-custom">Company is fixed to {actor.currentCompanyId}. Only active, locked preset versions can be assigned.</div><button disabled={saving || !form.employeeId || !form.presetVersionId || !form.effectiveFrom} onClick={save} className={`${buttonClass} md:col-span-2`}>{saving ? 'Saving…' : 'Save assignment'}</button></div></div></div>}
  </main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-[9px] font-bold uppercase tracking-wider text-muted-custom">{label}<div className="mt-1">{children}</div></label>; }
