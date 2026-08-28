import { monthStart } from './dates';
import { roundMoney } from './money';
import type {
  CalendarMonth,
  NormalizedSalaryVersion,
  SalaryPolicy,
} from './types';
import { IncentiveValidationError } from './validation';

export interface ResolvedSalary {
  versionId: string | number;
  monthlyWage: number;
}

export function resolveSalaryForMonth(
  month: CalendarMonth,
  salaryHistory: NormalizedSalaryVersion[],
  policy: SalaryPolicy,
): ResolvedSalary {
  if (policy.effectiveDateBasis !== 'first_day_of_calendar_month' || policy.proration !== 'none') {
    throw new IncentiveValidationError('Unsupported salary policy');
  }

  const effectiveDate = monthStart(month);
  const applicable = salaryHistory
    .filter((version) => version.effectiveFrom <= effectiveDate)
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];

  if (!applicable) {
    throw new IncentiveValidationError(`No salary version is effective on ${effectiveDate}`);
  }

  return {
    versionId: applicable.id,
    monthlyWage: roundMoney(applicable.monthlyWage),
  };
}
