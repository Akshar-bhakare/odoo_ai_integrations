import type {
  IncentiveEngineInput,
  IncentivePresetV1,
  NormalizedAccountingMonth,
  NormalizedCustomerEvent,
  NormalizedMonth,
} from './types';

export function makePreset(): IncentivePresetV1 {
  return {
    schemaVersion: '1.0',
    code: 'SUNLECTRIC_STANDARD_SALES',
    name: 'Sunlectric Standard Sales Incentive',
    currency: 'INR',
    salaryPolicy: {
      effectiveDateBasis: 'first_day_of_calendar_month',
      proration: 'none',
    },
    mainIncentive: {
      structure: 'flat',
      flat: {
        threshold: {
          source: 'salary_multiple',
          salaryMultiplier: 6,
        },
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

export function accounting(overrides: Partial<NormalizedAccountingMonth> = {}): NormalizedAccountingMonth {
  return {
    netSales: 0,
    cogs: 0,
    transport: 0,
    loading: 0,
    signedAccountingAdjustments: 0,
    employeeExpenses: 0,
    commission: 0,
    ...overrides,
  };
}

export function monthWithBase(month: string, actualBase: number): NormalizedMonth {
  return {
    month,
    accounting: accounting({ netSales: actualBase }),
  };
}

export function makeInput(overrides: Partial<IncentiveEngineInput> = {}): IncentiveEngineInput {
  return {
    employeeId: 1,
    companyId: 1,
    months: [monthWithBase('2026-01', 120000)],
    salaryHistory: [{
      id: 'salary-1',
      employeeId: 1,
      effectiveFrom: '2025-01-01',
      monthlyWage: 20000,
    }],
    customerEvents: [],
    adjustments: [],
    preset: makePreset(),
    ...overrides,
  };
}

export function resolvedOwner(employeeId = 1) {
  return {
    status: 'resolved' as const,
    employeeId,
    source: 'tracking_history' as const,
  };
}

export function pendingOwner() {
  return {
    status: 'pending' as const,
    employeeId: null,
    source: 'unresolved' as const,
  };
}

export function newCustomerEvent(params: {
  id: string;
  customerId: number;
  eventDate?: string;
  billing?: number;
  grossMargin?: number;
  ownerEmployeeId?: number;
  pending?: boolean;
}): NormalizedCustomerEvent {
  return {
    kind: 'new_customer',
    id: params.id,
    customerId: params.customerId,
    eventDate: params.eventDate ?? '2026-01-01',
    billing: params.billing ?? 100001,
    grossMargin: params.grossMargin ?? 5000,
    ownership: params.pending
      ? pendingOwner()
      : resolvedOwner(params.ownerEmployeeId ?? 1),
  };
}

export function repeatCustomerEvent(params: {
  id: string;
  customerId: number;
  newCustomerEventId: string;
  eventDate: string;
  billing?: number;
  grossMargin?: number;
  ownerEmployeeId?: number;
  pending?: boolean;
}): NormalizedCustomerEvent {
  return {
    kind: 'repeat_customer',
    id: params.id,
    customerId: params.customerId,
    newCustomerEventId: params.newCustomerEventId,
    eventDate: params.eventDate,
    billing: params.billing ?? 50000,
    grossMargin: params.grossMargin ?? 5000,
    ownership: params.pending
      ? pendingOwner()
      : resolvedOwner(params.ownerEmployeeId ?? 1),
  };
}
