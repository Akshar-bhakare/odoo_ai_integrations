import { describe, expect, it } from 'vitest';
import { assertIncentiveReadAccess } from './incentive-access';
import type { AuthenticatedIncentiveActor } from './types';

const employee: AuthenticatedIncentiveActor = {
  userId: 10,
  name: 'Employee',
  login: 'employee@example.com',
  currentCompanyId: 1,
  companyIds: [1],
  employeeId: 100,
  employeeMapping: 'mapped',
  roles: ['employee'],
};

describe('incentive read visibility', () => {
  it('allows employees to read their own incentive data', () => {
    expect(() => assertIncentiveReadAccess(employee, 'employee_data', {
      companyId: 1,
      employeeId: 100,
    })).not.toThrow();
  });

  it('rejects employees reading another employee', () => {
    expect(() => assertIncentiveReadAccess(employee, 'employee_data', {
      companyId: 1,
      employeeId: 101,
    })).toThrow('only their own');
  });

  it('allows reviewers within company scope', () => {
    const reviewer = { ...employee, roles: ['reviewer'] as const };
    expect(() => assertIncentiveReadAccess(reviewer, 'employee_data', {
      companyId: 1,
      employeeId: 101,
    })).not.toThrow();
  });

  it('rejects read access across companies', () => {
    const administrator = { ...employee, roles: ['administrator'] as const };
    expect(() => assertIncentiveReadAccess(administrator, 'calculations', {
      companyId: 2,
      employeeId: 101,
    })).toThrow('cannot access company 2');
  });
});
