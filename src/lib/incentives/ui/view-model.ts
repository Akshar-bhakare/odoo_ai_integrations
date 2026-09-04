import type { CalendarMonth, MonthlyIncentiveResult, NormalizedCustomerEvent } from '../types';
import type { AssignmentRecord, CalculationSummaryRecord, EmployeeRecord } from './types';
import { relationName } from './format';

export interface DashboardRow {
  id: number;
  employee: string;
  month: string;
  preset: string;
  presetVersion: string;
  salary: number;
  actualBase: number;
  normalThreshold: number;
  carryIn: number;
  carryOut: number;
  eligible: boolean;
  mainIncentive: number;
  newCustomerBonus: number;
  repeatBonus: number;
  adjustments: number;
  finalIncentive: number;
  notice: boolean;
  state: string;
  paymentState: string;
}

export function employeesWithEffectiveAssignment(
  employees: EmployeeRecord[],
  assignments: AssignmentRecord[],
  month: string,
): EmployeeRecord[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const effectiveDate = `${month}-01`;
  const assignedEmployeeIds = new Set(assignments.flatMap((assignment) => (
    assignment.x_active
      && assignment.x_date_from <= effectiveDate
      && (!assignment.x_date_to || assignment.x_date_to >= effectiveDate)
      && assignment.x_employee_id
      ? [assignment.x_employee_id[0]]
      : []
  )));
  return employees.filter((employee) => assignedEmployeeIds.has(employee.id));
}

export function calculationDashboardRow(record: CalculationSummaryRecord): DashboardRow {
  const result = JSON.parse(record.x_result_snapshot_json) as MonthlyIncentiveResult;
  const version = relationName(record.x_preset_version_id, 'Unassigned');
  return {
    id: record.id,
    employee: relationName(record.x_employee_id, 'Unassigned'),
    month: record.x_month.slice(0, 7),
    preset: version.replace(/\s+v\d+$/i, ''),
    presetVersion: version,
    salary: result.mainIncentive.salaryUsed,
    actualBase: result.accounting.actualBase,
    normalThreshold: result.mainIncentive.flatThreshold ?? result.mainIncentive.firstSlabThreshold ?? 0,
    carryIn: result.mainIncentive.carryIn,
    carryOut: result.mainIncentive.carryOut,
    eligible: result.mainIncentive.thresholdMet,
    mainIncentive: result.mainIncentive.incentive,
    newCustomerBonus: result.customerIncentive.newCustomerBonus,
    repeatBonus: result.customerIncentive.repeatCustomerBonus,
    adjustments: result.adjustmentTotal,
    finalIncentive: result.finalIncentive,
    notice: result.performanceNoticeTriggered,
    state: record.x_state,
    paymentState: record.x_payment_state,
  };
}

export function employeeCustomerEventsForMonth(
  events: NormalizedCustomerEvent[],
  employeeId: number,
  month: CalendarMonth,
): NormalizedCustomerEvent[] {
  return events
    .filter((event) => (
      event.eventDate.slice(0, 7) === month
      && event.ownership.status === 'resolved'
      && event.ownership.employeeId === employeeId
    ))
    .sort((left, right) => (
      right.eventDate.localeCompare(left.eventDate)
      || right.id.localeCompare(left.id)
    ));
}
