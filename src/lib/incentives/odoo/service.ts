import { calculateIncentives } from '../engine';
import type { IncentiveEngineInput, IncentivePresetV1, NormalizedAdjustment } from '../types';
import type { CalculationState } from '../types';
import { fetchIncentiveSourceBundle, type IncentiveAttributionReader } from './extraction';
import type { OdooGateway } from './gateway';
import { normalizeOdooIncentiveData } from './normalization';
import type { AccountingSourceAudit } from './contracts';

export interface PreparedIncentiveInput {
  engineInput: IncentiveEngineInput;
  unresolvedSources: ReturnType<typeof normalizeOdooIncentiveData>['unresolvedSources'];
  sourceAudit: ReturnType<typeof normalizeOdooIncentiveData>['sourceAudit'];
}

export function calculationBlockingSources(
  engineInput: IncentiveEngineInput,
  unresolvedSources: ReturnType<typeof normalizeOdooIncentiveData>['unresolvedSources'],
): ReturnType<typeof normalizeOdooIncentiveData>['unresolvedSources'] {
  const relevantCustomerEvents = new Set(
    calculateIncentives(engineInput).resolutionIssues.map((issue) => issue.eventId),
  );
  return unresolvedSources.filter((source) => {
    if (source.type === 'customer_owner') {
      return source.eventKey !== undefined && relevantCustomerEvents.has(source.eventKey);
    }
    if (source.type === 'salesperson_employee') {
      // An invoice assigned to a known, unmapped Odoo user cannot belong to the
      // employee being calculated. Keep only truly unattributed invoices as
      // company-wide blockers.
      return source.sourceUserId === null || source.sourceUserId === undefined;
    }
    return true;
  });
}

export function calculationAccountingSources(
  sources: AccountingSourceAudit[],
  employeeId: number,
  periodStart: string,
  periodEnd: string,
): AccountingSourceAudit[] {
  const firstMonth = periodStart.slice(0, 7);
  const lastMonth = periodEnd.slice(0, 7);
  return sources.filter((source) => (
    source.employeeId === employeeId
    && source.month >= firstMonth
    && source.month <= lastMonth
  ));
}

export async function prepareIncentiveEngineInput(params: {
  companyId: number;
  employeeId: number;
  periodStart: string;
  periodEnd: string;
  preset: IncentivePresetV1;
  adjustments?: NormalizedAdjustment[];
  initialState?: CalculationState;
  gateway?: OdooGateway;
  attributionReader?: IncentiveAttributionReader;
}): Promise<PreparedIncentiveInput> {
  const sourceBundle = await fetchIncentiveSourceBundle({
    companyId: params.companyId,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    gateway: params.gateway,
    attributionReader: params.attributionReader,
  });
  const normalized = normalizeOdooIncentiveData(sourceBundle);
  const employeeKey = String(params.employeeId);
  const months = normalized.monthsByEmployee[employeeKey];
  const salaryHistory = normalized.salaryHistoryByEmployee[employeeKey];
  if (!months || !salaryHistory) {
    throw new Error(`Employee ${params.employeeId} is outside the active incentive population`);
  }
  const engineInput: IncentiveEngineInput = {
    employeeId: params.employeeId,
    companyId: params.companyId,
    months,
    salaryHistory,
    customerEvents: normalized.customerEvents,
    adjustments: params.adjustments ?? [],
    preset: params.preset,
    initialState: params.initialState,
  };
  return {
    engineInput,
    unresolvedSources: calculationBlockingSources(engineInput, normalized.unresolvedSources),
    sourceAudit: calculationAccountingSources(
      normalized.sourceAudit,
      params.employeeId,
      params.periodStart,
      params.periodEnd,
    ),
  };
}
