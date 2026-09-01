import { describe, expect, it } from 'vitest';
import {
  assertIncentiveAuthorization,
  IncentiveAuthorizationError,
  type IncentiveActor,
} from './authorization';

const administrator: IncentiveActor = {
  userId: 2,
  companyIds: [1],
  roles: ['administrator'],
};

describe('incentive authorization', () => {
  it('allows an authorized role in an assigned company', () => {
    expect(() => assertIncentiveAuthorization(administrator, 'manage_presets', 1)).not.toThrow();
  });

  it('rejects missing authentication', () => {
    expect(() => assertIncentiveAuthorization(null, 'approve_calculation', 1))
      .toThrow(IncentiveAuthorizationError);
  });

  it('rejects cross-company writes', () => {
    expect(() => assertIncentiveAuthorization(administrator, 'manage_presets', 2))
      .toThrow('cannot access company 2');
  });

  it('separates review, approval, and payment roles', () => {
    const reviewer: IncentiveActor = { userId: 3, companyIds: [1], roles: ['reviewer'] };
    expect(() => assertIncentiveAuthorization(reviewer, 'review_calculation', 1)).not.toThrow();
    expect(() => assertIncentiveAuthorization(reviewer, 'approve_calculation', 1))
      .toThrow('not authorized');
    expect(() => assertIncentiveAuthorization(reviewer, 'record_payment', 1))
      .toThrow('not authorized');
  });

  it('allows approvers to approve', () => {
    const approver: IncentiveActor = { userId: 4, companyIds: [1], roles: ['approver'] };
    expect(() => assertIncentiveAuthorization(approver, 'approve_calculation', 1)).not.toThrow();
  });

  it('allows payment recorders to settle payments only', () => {
    const recorder: IncentiveActor = { userId: 5, companyIds: [1], roles: ['payment_recorder'] };
    expect(() => assertIncentiveAuthorization(recorder, 'record_payment', 1)).not.toThrow();
    expect(() => assertIncentiveAuthorization(recorder, 'approve_calculation', 1))
      .toThrow('not authorized');
  });

  it('rejects employee approval', () => {
    const employee: IncentiveActor = { userId: 6, companyIds: [1], roles: ['employee'] };
    expect(() => assertIncentiveAuthorization(employee, 'approve_calculation', 1))
      .toThrow('not authorized');
  });

  it('rejects reviewer preset and assignment administration', () => {
    const reviewer: IncentiveActor = { userId: 3, companyIds: [1], roles: ['reviewer'] };
    expect(() => assertIncentiveAuthorization(reviewer, 'manage_presets', 1))
      .toThrow('not authorized');
    expect(() => assertIncentiveAuthorization(reviewer, 'manage_assignments', 1))
      .toThrow('not authorized');
  });

  it('rejects employee expense attribution and adjustment', () => {
    const employee: IncentiveActor = { userId: 6, companyIds: [1], roles: ['employee'] };
    expect(() => assertIncentiveAuthorization(employee, 'attribute_expense', 1))
      .toThrow('not authorized');
    expect(() => assertIncentiveAuthorization(employee, 'adjust_calculation', 1))
      .toThrow('not authorized');
  });

  it('allows reviewers to resolve customer owners but not approve', () => {
    const reviewer: IncentiveActor = { userId: 3, companyIds: [1], roles: ['reviewer'] };
    expect(() => assertIncentiveAuthorization(reviewer, 'resolve_customer_owner', 1)).not.toThrow();
    expect(() => assertIncentiveAuthorization(reviewer, 'approve_calculation', 1)).toThrow('not authorized');
  });
});
