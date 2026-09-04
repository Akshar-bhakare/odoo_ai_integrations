'use client';

import type { IncentivePresetV1 } from '@/lib/incentives/types';
import { inputClass, secondaryButtonClass } from './ui';

export function PresetForm({ value, onChange, disabled }: {
  value: IncentivePresetV1;
  onChange(value: IncentivePresetV1): void;
  disabled: boolean;
}) {
  function edit(mutator: (next: IncentivePresetV1) => void) {
    const next = structuredClone(value);
    mutator(next);
    onChange(next);
  }

  function setStructure(structure: 'flat' | 'slab') {
    edit((next) => {
      next.mainIncentive = structure === 'flat' ? {
        structure: 'flat',
        flat: {
          threshold: { source: 'salary_multiple', salaryMultiplier: 6 },
          carryForwardEnabled: true,
          rate: 0.1,
          payoutBasis: 'entire_eligible_base',
          previousBasePayout: 'include_previous_unpaid_base',
        },
        slab: null,
      } : {
        structure: 'slab',
        flat: null,
        slab: {
          thresholdType: 'fixed_amount',
          carryForwardEnabled: true,
          slabApplication: 'whole_eligible_base',
          slabs: [{ minimumBase: 120000, rate: 0.1 }],
        },
      };
    });
  }

  return (
    <div className="space-y-5 p-4">
      <FormSection title="Identity">
        <Field label="Name"><input disabled={disabled} value={value.name} onChange={(event) => edit((next) => { next.name = event.target.value; })} className={inputClass} /></Field>
        <Field label="Code"><input disabled={disabled} value={value.code} onChange={(event) => edit((next) => { next.code = event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); })} className={inputClass} /></Field>
        <Field label="Currency"><input disabled value={value.currency} className={inputClass} /></Field>
      </FormSection>

      <FormSection title="Main incentive structure">
        <Field label="Structure"><select disabled={disabled} value={value.mainIncentive.structure} onChange={(event) => setStructure(event.target.value as 'flat' | 'slab')} className={inputClass}><option value="flat">Flat</option><option value="slab">Slab</option></select></Field>
      </FormSection>

      {value.mainIncentive.structure === 'flat' && value.mainIncentive.flat ? (
        <FormSection title="Flat configuration">
          <Field label="Threshold source"><input disabled value="Salary Multiple" className={inputClass} /></Field>
          <Field label="Salary multiplier"><NumberInput disabled={disabled} value={value.mainIncentive.flat.threshold.salaryMultiplier} onChange={(number) => edit((next) => { if (next.mainIncentive.flat) next.mainIncentive.flat.threshold.salaryMultiplier = number; })} /></Field>
          <Field label="Rate (%)"><NumberInput disabled={disabled} value={value.mainIncentive.flat.rate * 100} onChange={(number) => edit((next) => { if (next.mainIncentive.flat) next.mainIncentive.flat.rate = number / 100; })} /></Field>
          <Field label="Carry"><SelectBoolean disabled={disabled} value={value.mainIncentive.flat.carryForwardEnabled} onChange={(enabled) => edit((next) => { if (next.mainIncentive.flat) next.mainIncentive.flat.carryForwardEnabled = enabled; })} /></Field>
          <Field label="Payout basis"><select disabled={disabled} value={value.mainIncentive.flat.payoutBasis} onChange={(event) => edit((next) => { if (next.mainIncentive.flat) next.mainIncentive.flat.payoutBasis = event.target.value as 'entire_eligible_base' | 'above_threshold_only'; })} className={inputClass}><option value="entire_eligible_base">Entire Eligible Base</option><option value="above_threshold_only">Above Threshold Only</option></select></Field>
          <Field label="Previous base payout"><select disabled={disabled} value={value.mainIncentive.flat.previousBasePayout} onChange={(event) => edit((next) => { if (next.mainIncentive.flat) next.mainIncentive.flat.previousBasePayout = event.target.value as 'current_month_only' | 'include_previous_unpaid_base'; })} className={inputClass}><option value="current_month_only">Current Month Only</option><option value="include_previous_unpaid_base">Include Previous Unpaid Base</option></select></Field>
        </FormSection>
      ) : value.mainIncentive.slab ? (
        <div className="rounded-xl border border-border-custom bg-background/40 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Threshold type"><select disabled={disabled} value={value.mainIncentive.slab.thresholdType} onChange={(event) => edit((next) => {
              const current = next.mainIncentive.slab;
              if (!current) return;
              next.mainIncentive.slab = event.target.value === 'fixed_amount'
                ? { thresholdType: 'fixed_amount', carryForwardEnabled: current.carryForwardEnabled, slabApplication: 'whole_eligible_base', slabs: current.slabs.map((item) => ({ minimumBase: 'minimumBase' in item ? item.minimumBase : item.minimumMultiplier * 20000, rate: item.rate })) }
                : { thresholdType: 'salary_multiple', carryForwardEnabled: current.carryForwardEnabled, slabApplication: 'whole_eligible_base', slabs: current.slabs.map((item) => ({ minimumMultiplier: 'minimumMultiplier' in item ? item.minimumMultiplier : item.minimumBase / 20000, rate: item.rate })) };
            })} className={inputClass}><option value="fixed_amount">Fixed Amount</option><option value="salary_multiple">Salary Multiple</option></select></Field>
            <Field label="Carry"><SelectBoolean disabled={disabled} value={value.mainIncentive.slab.carryForwardEnabled} onChange={(enabled) => edit((next) => { if (next.mainIncentive.slab) next.mainIncentive.slab.carryForwardEnabled = enabled; })} /></Field>
          </div>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-xs"><thead><tr className="border-b border-border-custom text-left text-[9px] font-black uppercase tracking-wider text-muted-custom"><th className="py-2">Order</th><th className="py-2">Minimum threshold</th><th className="py-2">Rate (%)</th><th className="py-2 text-right">Actions</th></tr></thead><tbody>{value.mainIncentive.slab.slabs.map((slab, index) => <tr key={index} className="border-b border-border-custom/60"><td className="py-2 font-mono">{index + 1}</td><td className="py-2 pr-3"><NumberInput disabled={disabled} value={'minimumBase' in slab ? slab.minimumBase : slab.minimumMultiplier} onChange={(number) => edit((next) => { const item = next.mainIncentive.slab?.slabs[index]; if (!item) return; if ('minimumBase' in item) item.minimumBase = number; else item.minimumMultiplier = number; })} /></td><td className="py-2 pr-3"><NumberInput disabled={disabled} value={slab.rate * 100} onChange={(number) => edit((next) => { const item = next.mainIncentive.slab?.slabs[index]; if (item) item.rate = number / 100; })} /></td><td className="py-2 text-right"><div className="flex justify-end gap-1"><button type="button" disabled={disabled || index === 0} onClick={() => edit((next) => { const slabs = next.mainIncentive.slab!.slabs; [slabs[index - 1], slabs[index]] = [slabs[index], slabs[index - 1]]; })} className={secondaryButtonClass}>↑</button><button type="button" disabled={disabled || index === value.mainIncentive.slab!.slabs.length - 1} onClick={() => edit((next) => { const slabs = next.mainIncentive.slab!.slabs; [slabs[index + 1], slabs[index]] = [slabs[index], slabs[index + 1]]; })} className={secondaryButtonClass}>↓</button><button type="button" disabled={disabled || value.mainIncentive.slab!.slabs.length === 1} onClick={() => edit((next) => { next.mainIncentive.slab!.slabs.splice(index, 1); })} className={secondaryButtonClass}>Remove</button></div></td></tr>)}</tbody></table></div>
          <button type="button" disabled={disabled} onClick={() => edit((next) => { const slab = next.mainIncentive.slab!; const last = slab.slabs.at(-1); if (slab.thresholdType === 'fixed_amount') slab.slabs.push({ minimumBase: last && 'minimumBase' in last ? last.minimumBase + 10000 : 100000, rate: last?.rate ?? 0.1 }); else slab.slabs.push({ minimumMultiplier: last && 'minimumMultiplier' in last ? last.minimumMultiplier + 1 : 6, rate: last?.rate ?? 0.1 }); })} className={`${secondaryButtonClass} mt-3`}>Add slab</button>
          <p className="mt-3 text-[10px] text-muted-custom">V1 applies the achieved slab rate to the whole eligible base. Progressive slabs and above-threshold payout are intentionally unavailable.</p>
        </div>
      ) : null}

      <FormSection title="Base deductions">
        <Field label="Employee expenses"><SelectBoolean disabled={disabled} value={value.base.deductEmployeeExpenses} onChange={(enabled) => edit((next) => { next.base.deductEmployeeExpenses = enabled; })} /></Field>
        <Field label="Commission"><SelectBoolean disabled={disabled} value={value.base.deductCommission} onChange={(enabled) => edit((next) => { next.base.deductCommission = enabled; })} /></Field>
      </FormSection>

      <FormSection title="New customer incentive">
        <Field label="Enabled"><SelectBoolean disabled={disabled} value={value.newCustomer.enabled} onChange={(enabled) => edit((next) => { next.newCustomer.enabled = enabled; })} /></Field>
        <Field label="Minimum qualifying customers per employee"><NumberInput disabled={disabled} value={value.newCustomer.minimumQualifyingCustomers} onChange={(number) => edit((next) => { next.newCustomer.minimumQualifyingCustomers = number; })} /></Field>
        <Field label="Billing comparison"><select disabled={disabled} value={value.newCustomer.billingComparison} onChange={(event) => edit((next) => { next.newCustomer.billingComparison = event.target.value as 'gt' | 'gte'; })} className={inputClass}><option value="gt">Greater than</option><option value="gte">Greater than or equal</option></select></Field>
        <Field label="Minimum billing"><NumberInput disabled={disabled} value={value.newCustomer.minimumBilling} onChange={(number) => edit((next) => { next.newCustomer.minimumBilling = number; })} /></Field>
        <Field label="Minimum GM amount"><NullableNumberInput disabled={disabled} value={value.newCustomer.minimumGmAmount} onChange={(number) => edit((next) => { next.newCustomer.minimumGmAmount = number; })} /></Field>
        <Field label="Minimum GM %"><NullableNumberInput disabled={disabled} value={value.newCustomer.minimumGmPercent} onChange={(number) => edit((next) => { next.newCustomer.minimumGmPercent = number; })} /></Field>
        <Field label="Bonus per customer"><NumberInput disabled={disabled} value={value.newCustomer.bonusPerCustomer} onChange={(number) => edit((next) => { next.newCustomer.bonusPerCustomer = number; })} /></Field>
      </FormSection>

      <FormSection title="Repeat incentive">
        <Field label="Enabled"><SelectBoolean disabled={disabled} value={value.repeatCustomer.enabled} onChange={(enabled) => edit((next) => { next.repeatCustomer.enabled = enabled; })} /></Field>
        <Field label="Requires qualified new customer"><SelectBoolean disabled={disabled} value={value.repeatCustomer.requiresQualifiedNewCustomer} onChange={(enabled) => edit((next) => { next.repeatCustomer.requiresQualifiedNewCustomer = enabled; })} /></Field>
        <Field label="Repeat window days"><NumberInput disabled={disabled} value={value.repeatCustomer.repeatWindowDays} onChange={(number) => edit((next) => { next.repeatCustomer.repeatWindowDays = number; })} /></Field>
        <Field label="Minimum billing"><NullableNumberInput disabled={disabled} value={value.repeatCustomer.minimumBilling} onChange={(number) => edit((next) => { next.repeatCustomer.minimumBilling = number; })} /></Field>
        <Field label="Minimum GM amount"><NullableNumberInput disabled={disabled} value={value.repeatCustomer.minimumGmAmount} onChange={(number) => edit((next) => { next.repeatCustomer.minimumGmAmount = number; })} /></Field>
        <Field label="Minimum GM %"><NullableNumberInput disabled={disabled} value={value.repeatCustomer.minimumGmPercent} onChange={(number) => edit((next) => { next.repeatCustomer.minimumGmPercent = number; })} /></Field>
        <Field label="Bonus per customer"><NumberInput disabled={disabled} value={value.repeatCustomer.bonusPerCustomer} onChange={(number) => edit((next) => { next.repeatCustomer.bonusPerCustomer = number; })} /></Field>
        <Field label="Maximum payouts"><NullableNumberInput disabled={disabled} value={value.repeatCustomer.maximumPayoutsPerCustomer} onChange={(number) => edit((next) => { next.repeatCustomer.maximumPayoutsPerCustomer = number; })} /></Field>
      </FormSection>

      <FormSection title="Performance notice">
        <Field label="Enabled"><SelectBoolean disabled={disabled} value={value.performanceNotice.enabled} onChange={(enabled) => edit((next) => { next.performanceNotice.enabled = enabled; })} /></Field>
        <Field label="Consecutive failed months"><NumberInput disabled={disabled} value={value.performanceNotice.consecutiveFailedMonths} onChange={(number) => edit((next) => { next.performanceNotice.consecutiveFailedMonths = number; })} /></Field>
      </FormSection>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border border-border-custom bg-background/40 p-4"><h3 className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-muted-custom">{title}</h3><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{children}</div></section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-[9px] font-bold uppercase tracking-wider text-muted-custom">{label}<div className="mt-1">{children}</div></label>; }
function NumberInput({ value, onChange, disabled }: { value: number; onChange(value: number): void; disabled: boolean }) { return <input type="number" step="any" disabled={disabled} value={value} onChange={(event) => onChange(Number(event.target.value))} className={inputClass} />; }
function NullableNumberInput({ value, onChange, disabled }: { value: number | null; onChange(value: number | null): void; disabled: boolean }) { return <input type="number" step="any" disabled={disabled} value={value ?? ''} placeholder="Not required" onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} className={inputClass} />; }
function SelectBoolean({ value, onChange, disabled }: { value: boolean; onChange(value: boolean): void; disabled: boolean }) { return <select disabled={disabled} value={String(value)} onChange={(event) => onChange(event.target.value === 'true')} className={inputClass}><option value="true">Enabled</option><option value="false">Disabled</option></select>; }
