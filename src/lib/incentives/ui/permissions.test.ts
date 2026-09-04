import { describe, expect, it } from 'vitest';
import type { SessionActor } from './types';
import { canAdminister, canApprove, canRecordPayment, canReview } from './permissions';

function actor(role: SessionActor['roles'][number]): SessionActor {
  return { name: role, login: `${role}@example.com`, currentCompanyId: 1, employeeId: 10, employeeMapping: 'mapped', roles: [role] };
}

describe('role-based incentive UI capabilities', () => {
  it('limits employees to read-only self-service UI', () => {
    expect(canReview(actor('employee'))).toBe(false);
    expect(canApprove(actor('employee'))).toBe(false);
    expect(canAdminister(actor('employee'))).toBe(false);
    expect(canRecordPayment(actor('employee'))).toBe(false);
  });

  it('shows review and approval actions to their matching roles', () => {
    expect(canReview(actor('reviewer'))).toBe(true);
    expect(canApprove(actor('reviewer'))).toBe(false);
    expect(canApprove(actor('approver'))).toBe(true);
  });

  it('separates preset administration and payment recording', () => {
    expect(canAdminister(actor('administrator'))).toBe(true);
    expect(canRecordPayment(actor('payment_recorder'))).toBe(true);
    expect(canAdminister(actor('payment_recorder'))).toBe(false);
  });
});
