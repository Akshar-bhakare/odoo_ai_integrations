import { describe, expect, it } from 'vitest';
import { calculateIncentives } from '../engine';
import { makeInput, makePreset, monthWithBase, newCustomerEvent, repeatCustomerEvent } from '../test-helpers';
import type { AssignmentRecord, CalculationSummaryRecord, EmployeeRecord } from './types';
import { calculationDashboardRow, employeeCustomerEventsForMonth, employeesWithEffectiveAssignment } from './view-model';

function record(result: ReturnType<typeof calculateIncentives>['months'][number]): CalculationSummaryRecord {
  return {
    id: 10,
    x_name: 'Test calculation',
    x_employee_id: [100, 'Anita Employee'],
    x_month: `${result.month}-01`,
    x_revision: 1,
    x_state: 'draft',
    x_preset_version_id: [20, 'Standard Sales v1'],
    x_salary_used: result.mainIncentive.salaryUsed,
    x_actual_base: result.accounting.actualBase,
    x_raw_incentive: result.calculatedIncentive,
    x_adjustment_total: result.adjustmentTotal,
    x_final_incentive: result.finalIncentive,
    x_result_snapshot_json: JSON.stringify(result),
    x_payment_state: 'unpaid',
    x_paid_amount: 0,
    x_approved_at: false,
  };
}

describe('incentive dashboard view model', () => {
  it('offers calculations only for employees assigned at the month start', () => {
    const employees = [
      { id: 1, name: 'Assigned', company_id: [1, 'Company'], user_id: false, active: true },
      { id: 2, name: 'Future', company_id: [1, 'Company'], user_id: false, active: true },
      { id: 3, name: 'Expired', company_id: [1, 'Company'], user_id: false, active: true },
    ] satisfies EmployeeRecord[];
    const assignments = [
      { id: 1, x_name: 'Current', x_employee_id: [1, 'Assigned'], x_preset_version_id: [1, 'v1'], x_company_id: [1, 'Company'], x_date_from: '2026-08-01', x_date_to: false, x_active: true },
      { id: 2, x_name: 'Future', x_employee_id: [2, 'Future'], x_preset_version_id: [1, 'v1'], x_company_id: [1, 'Company'], x_date_from: '2026-09-01', x_date_to: false, x_active: true },
      { id: 3, x_name: 'Expired', x_employee_id: [3, 'Expired'], x_preset_version_id: [1, 'v1'], x_company_id: [1, 'Company'], x_date_from: '2026-01-01', x_date_to: '2026-07-31', x_active: true },
    ] satisfies AssignmentRecord[];

    expect(employeesWithEffectiveAssignment(employees, assignments, '2026-08').map((employee) => employee.id)).toEqual([1]);
  });

  it('displays the persisted Flat result without recalculating it', () => {
    const result = calculateIncentives(makeInput({ months: [monthWithBase('2026-01', 180000)] })).months[0];
    const row = calculationDashboardRow(record(result));

    expect(row.normalThreshold).toBe(120000);
    expect(row.eligible).toBe(true);
    expect(row.mainIncentive).toBe(18000);
  });

  it('displays the first threshold and achieved whole-base incentive for Slab', () => {
    const preset = makePreset();
    preset.mainIncentive = {
      structure: 'slab',
      flat: null,
      slab: {
        thresholdType: 'fixed_amount',
        carryForwardEnabled: true,
        slabApplication: 'whole_eligible_base',
        slabs: [
          { minimumBase: 120000, rate: 0.1 },
          { minimumBase: 150000, rate: 0.125 },
          { minimumBase: 180000, rate: 0.15 },
        ],
      },
    };
    const result = calculateIncentives(makeInput({ preset, months: [monthWithBase('2026-01', 160000)] })).months[0];
    const row = calculationDashboardRow(record(result));

    expect(row.normalThreshold).toBe(120000);
    expect(row.mainIncentive).toBe(20000);
  });

  it('keeps raw and adjusted incentive values separate', () => {
    const result = calculateIncentives(makeInput({
      months: [monthWithBase('2026-01', 180000)],
      adjustments: [{ id: 'adjustment-1', employeeId: 1, month: '2026-01', operation: 'deduct', amount: 3000, reason: 'Approved correction' }],
    })).months[0];
    const row = calculationDashboardRow(record(result));

    expect(row.mainIncentive).toBe(18000);
    expect(row.adjustments).toBe(-3000);
    expect(row.finalIncentive).toBe(15000);
  });

  it('shows only the selected employee and month customer events newest first', () => {
    const events = [
      newCustomerEvent({ id: 'anam-early', customerId: 1, ownerEmployeeId: 8, eventDate: '2026-08-02' }),
      repeatCustomerEvent({ id: 'anam-late', customerId: 2, newCustomerEventId: 'anam-early', ownerEmployeeId: 8, eventDate: '2026-08-29' }),
      newCustomerEvent({ id: 'other-employee', customerId: 3, ownerEmployeeId: 9, eventDate: '2026-08-31' }),
      newCustomerEvent({ id: 'other-month', customerId: 4, ownerEmployeeId: 8, eventDate: '2026-07-31' }),
      newCustomerEvent({ id: 'unresolved', customerId: 5, pending: true, eventDate: '2026-08-30' }),
    ];

    expect(employeeCustomerEventsForMonth(events, 8, '2026-08').map((event) => event.id)).toEqual([
      'anam-late',
      'anam-early',
    ]);
  });
});
