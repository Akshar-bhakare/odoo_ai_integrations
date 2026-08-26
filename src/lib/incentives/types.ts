export type CalendarMonth = string;
export type IsoDate = string;
export type Money = number;

export interface SalaryPolicy {
  effectiveDateBasis: 'first_day_of_calendar_month';
  proration: 'none';
}

export interface FlatIncentiveConfig {
  threshold: {
    source: 'salary_multiple';
    salaryMultiplier: number;
  };
  carryForwardEnabled: boolean;
  rate: number;
  payoutBasis: 'entire_eligible_base' | 'above_threshold_only';
  previousBasePayout: 'current_month_only' | 'include_previous_unpaid_base';
}

export interface FixedAmountSlabConfig {
  thresholdType: 'fixed_amount';
  carryForwardEnabled: boolean;
  slabApplication: 'whole_eligible_base';
  slabs: Array<{
    minimumBase: Money;
    rate: number;
  }>;
}

export interface SalaryMultipleSlabConfig {
  thresholdType: 'salary_multiple';
  carryForwardEnabled: boolean;
  slabApplication: 'whole_eligible_base';
  slabs: Array<{
    minimumMultiplier: number;
    rate: number;
  }>;
}

export type SlabIncentiveConfig =
  | FixedAmountSlabConfig
  | SalaryMultipleSlabConfig;

export type MainIncentiveConfig =
  | {
      structure: 'flat';
      flat: FlatIncentiveConfig;
      slab: null;
    }
  | {
      structure: 'slab';
      flat: null;
      slab: SlabIncentiveConfig;
    };

export interface BaseConfig {
  deductEmployeeExpenses: boolean;
  deductCommission: boolean;
  transportField: 'x_studio_transport_charges';
  loadingField: 'x_studio_loading_charges';
}

export type NewCustomerOwnershipStrategy =
  | 'customer_owner'
  | 'assigned_salesperson'
  | 'manual';

export type RepeatCustomerOwnershipStrategy =
  | 'customer_owner'
  | 'repeat_biller'
  | 'original_biller'
  | 'assigned_salesperson'
  | 'manual';

export interface NewCustomerConfig {
  enabled: boolean;
  qualificationScope: 'company_global' | 'salesperson_specific';
  qualificationPeriod: 'first_invoice_calendar_month';
  minimumQualifyingCustomers: number;
  billingComparison: 'gt' | 'gte';
  minimumBilling: Money;
  minimumGmAmount: Money | null;
  minimumGmPercent: number | null;
  bonusPerCustomer: Money;
  ownershipStrategy: NewCustomerOwnershipStrategy;
  ownershipDateBasis: 'event_date';
  sameDayOwnershipRule: 'start_of_day';
}

export interface RepeatCustomerConfig {
  enabled: boolean;
  requiresQualifiedNewCustomer: boolean;
  repeatWindowDays: number;
  minimumBilling: Money | null;
  minimumGmAmount: Money | null;
  minimumGmPercent: number | null;
  bonusPerCustomer: Money;
  maximumPayoutsPerCustomer: number | null;
  ownershipStrategy: RepeatCustomerOwnershipStrategy;
  ownershipDateBasis: 'event_date';
  sameDayOwnershipRule: 'start_of_day';
}

export interface PerformanceNoticeConfig {
  enabled: boolean;
  consecutiveFailedMonths: number;
  action: 'performance_notice';
}

export interface IncentivePresetV1 {
  schemaVersion: '1.0';
  code: string;
  name: string;
  currency: string;
  salaryPolicy: SalaryPolicy;
  mainIncentive: MainIncentiveConfig;
  base: BaseConfig;
  newCustomer: NewCustomerConfig;
  repeatCustomer: RepeatCustomerConfig;
  performanceNotice: PerformanceNoticeConfig;
}

export interface NormalizedSalaryVersion {
  id: string | number;
  employeeId: number;
  effectiveFrom: IsoDate;
  monthlyWage: Money;
}

export interface NormalizedAccountingMonth {
  netSales: Money;
  cogs: Money;
  transport: Money;
  loading: Money;
  signedAccountingAdjustments: Money;
  employeeExpenses: Money;
  commission: Money;
}

export interface NormalizedMonth {
  month: CalendarMonth;
  accounting: NormalizedAccountingMonth;
}

export type OwnershipResolution =
  | {
      status: 'resolved';
      employeeId: number;
      source: 'sales_order_salesperson' | 'current_partner' | 'tracking_history' | 'manual_resolution';
    }
  | {
      status: 'pending';
      employeeId: null;
      source: 'unresolved';
    };

interface CustomerEventBase {
  id: string;
  customerId: number;
  invoiceNumbers?: string[];
  eventDate: IsoDate;
  billing: Money;
  grossMargin: Money;
  billingEmployeeId?: number | null;
  ownership: OwnershipResolution;
}

export interface NormalizedNewCustomerEvent extends CustomerEventBase {
  kind: 'new_customer';
}

export interface NormalizedRepeatCustomerEvent extends CustomerEventBase {
  kind: 'repeat_customer';
  newCustomerEventId: string;
}

export type NormalizedCustomerEvent =
  | NormalizedNewCustomerEvent
  | NormalizedRepeatCustomerEvent;

export interface NormalizedAdjustment {
  id: string;
  employeeId: number;
  month: CalendarMonth;
  operation: 'add' | 'deduct';
  amount: Money;
  reason: string;
}

export interface CalculationState {
  lastProcessedMonth: CalendarMonth | null;
  carryShortfall: Money;
  accumulatedUnpaidBase: Money;
  consecutiveFailureCount: number;
  cycleSequence: number;
  lastRecognitionMonth: CalendarMonth | null;
  recognizedCustomerEventIds: string[];
  repeatPayoutCountsByCustomer: Record<string, number>;
}

export interface IncentiveEngineInput {
  employeeId: number;
  companyId: number;
  months: NormalizedMonth[];
  salaryHistory: NormalizedSalaryVersion[];
  customerEvents: NormalizedCustomerEvent[];
  adjustments: NormalizedAdjustment[];
  preset: IncentivePresetV1;
  initialState?: CalculationState;
}

export interface AccountingCalculation {
  netSales: Money;
  cogs: Money;
  grossMargin: Money;
  transport: Money;
  loading: Money;
  signedAccountingAdjustments: Money;
  adjustedGrossMargin: Money;
  employeeExpenses: Money;
  commission: Money;
  actualBase: Money;
}

export interface MainIncentiveCalculation {
  structure: 'flat' | 'slab';
  salaryVersionId: string | number;
  salaryUsed: Money;
  flatThreshold: Money | null;
  firstSlabThreshold: Money | null;
  requiredThreshold: Money;
  thresholdMet: boolean;
  carryIn: Money;
  carryOut: Money;
  carryConsumed: Money;
  currentRecognizedBase: Money;
  accumulatedUnpaidBaseIn: Money;
  accumulatedUnpaidBaseOut: Money;
  eligibleIncentiveBase: Money;
  slabSelectionBase: Money | null;
  achievedRate: number | null;
  incentive: Money;
}

export interface CustomerIncentiveCalculation {
  qualifiedNewCustomerEventIds: string[];
  paidNewCustomerEventIds: string[];
  qualifiedRepeatCustomerEventIds: string[];
  paidRepeatCustomerEventIds: string[];
  pendingCustomerEventIds: string[];
  newCustomerBonus: Money;
  repeatCustomerBonus: Money;
}

export interface ResolutionIssue {
  type: 'customer_owner';
  eventId: string;
  customerId: number;
  message: string;
}

export interface MonthlyIncentiveResult {
  month: CalendarMonth;
  accounting: AccountingCalculation;
  mainIncentive: MainIncentiveCalculation;
  customerIncentive: CustomerIncentiveCalculation;
  calculatedIncentive: Money;
  adjustments: NormalizedAdjustment[];
  adjustmentTotal: Money;
  finalIncentive: Money;
  performanceNoticeTriggered: boolean;
  resolutionIssues: ResolutionIssue[];
  stateAfter: CalculationState;
}

export interface IncentiveEngineResult {
  employeeId: number;
  companyId: number;
  presetCode: string;
  currency: string;
  months: MonthlyIncentiveResult[];
  finalState: CalculationState;
  resolutionIssues: ResolutionIssue[];
}
