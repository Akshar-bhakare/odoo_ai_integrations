import type { IncentivePresetV1 } from '../types';

export function defaultPreset(code = 'NEW_INCENTIVE_PRESET', name = 'New Incentive Preset'): IncentivePresetV1 {
  return {
    schemaVersion: '1.0',
    code,
    name,
    currency: 'INR',
    salaryPolicy: { effectiveDateBasis: 'first_day_of_calendar_month', proration: 'none' },
    mainIncentive: {
      structure: 'flat',
      flat: {
        threshold: { source: 'salary_multiple', salaryMultiplier: 6 },
        carryForwardEnabled: true,
        rate: 0.1,
        payoutBasis: 'entire_eligible_base',
        previousBasePayout: 'include_previous_unpaid_base',
      },
      slab: null,
    },
    base: {
      deductEmployeeExpenses: true,
      deductCommission: true,
      transportField: 'x_studio_transport_charges',
      loadingField: 'x_studio_loading_charges',
    },
    newCustomer: {
      enabled: true,
      qualificationScope: 'company_global',
      qualificationPeriod: 'first_invoice_calendar_month',
      minimumQualifyingCustomers: 3,
      billingComparison: 'gt',
      minimumBilling: 100000,
      minimumGmAmount: null,
      minimumGmPercent: 3.5,
      bonusPerCustomer: 2000,
      ownershipStrategy: 'customer_owner',
      ownershipDateBasis: 'event_date',
      sameDayOwnershipRule: 'start_of_day',
    },
    repeatCustomer: {
      enabled: true,
      requiresQualifiedNewCustomer: true,
      repeatWindowDays: 90,
      minimumBilling: null,
      minimumGmAmount: null,
      minimumGmPercent: null,
      bonusPerCustomer: 2000,
      maximumPayoutsPerCustomer: 1,
      ownershipStrategy: 'customer_owner',
      ownershipDateBasis: 'event_date',
      sameDayOwnershipRule: 'start_of_day',
    },
    performanceNotice: {
      enabled: true,
      consecutiveFailedMonths: 4,
      action: 'performance_notice',
    },
  };
}

export function presetFormErrors(preset: IncentivePresetV1): string[] {
  const errors: string[] = [];
  if (!preset.name.trim()) errors.push('Preset name is required');
  if (!/^[A-Z][A-Z0-9_]*$/.test(preset.code)) errors.push('Code must use uppercase letters, numbers, and underscores');
  if (preset.mainIncentive.structure === 'flat') {
    const flat = preset.mainIncentive.flat;
    if (!flat || flat.threshold.salaryMultiplier <= 0) errors.push('Flat salary multiplier must be positive');
    if (!flat || flat.rate < 0 || flat.rate > 1) errors.push('Flat rate must be between 0% and 100%');
  } else {
    const slab = preset.mainIncentive.slab;
    if (!slab || slab.slabs.length === 0) errors.push('At least one slab is required');
    if (slab) {
      const thresholds = slab.thresholdType === 'fixed_amount'
        ? slab.slabs.map((item) => 'minimumBase' in item ? item.minimumBase : 0)
        : slab.slabs.map((item) => 'minimumMultiplier' in item ? item.minimumMultiplier : 0);
      if (thresholds.some((value) => value <= 0)) errors.push('Every slab threshold must be positive');
      if (new Set(thresholds).size !== thresholds.length) errors.push('Slab thresholds must be unique');
      if (thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1])) errors.push('Slab thresholds must be strictly ascending');
      if (slab.slabs.some((item) => item.rate < 0 || item.rate > 1)) errors.push('Slab rates must be between 0% and 100%');
    }
  }
  if (preset.repeatCustomer.repeatWindowDays < 1) errors.push('Repeat window must be at least one day');
  return errors;
}
