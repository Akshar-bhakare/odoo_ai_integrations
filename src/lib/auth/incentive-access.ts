import type { AuthenticatedIncentiveActor } from './types';
import { IncentiveAuthorizationError } from '../incentives/odoo/authorization';

export type IncentiveReadResource =
  | 'presets'
  | 'assignments'
  | 'employee_data'
  | 'calculations'
  | 'sources'
  | 'customer_data'
  | 'unresolved';

const REVIEW_ROLES = new Set(['reviewer', 'approver', 'administrator']);

export function assertIncentiveReadAccess(
  actor: AuthenticatedIncentiveActor,
  resource: IncentiveReadResource,
  target: { companyId: number; employeeId?: number | null },
): void {
  if (!actor.companyIds.includes(target.companyId)) {
    throw new IncentiveAuthorizationError(`User ${actor.userId} cannot access company ${target.companyId}`);
  }
  if (resource === 'unresolved') {
    if (!actor.roles.some((role) => REVIEW_ROLES.has(role))) {
      throw new IncentiveAuthorizationError('Unresolved attribution requires review permission');
    }
    return;
  }
  if (resource === 'presets') {
    if (actor.roles.length === 0) {
      throw new IncentiveAuthorizationError('An incentive role is required');
    }
    return;
  }
  if ((resource === 'calculations' || resource === 'sources')
    && actor.roles.includes('payment_recorder')) {
    return;
  }
  if (actor.roles.some((role) => REVIEW_ROLES.has(role))) {
    return;
  }
  if (!actor.roles.includes('employee')
    || actor.employeeId === null
    || target.employeeId !== actor.employeeId) {
    throw new IncentiveAuthorizationError('Employees may access only their own incentive data');
  }
}

export function assertReviewerScope(actor: AuthenticatedIncentiveActor): void {
  if (!actor.roles.some((role) => REVIEW_ROLES.has(role))) {
    throw new IncentiveAuthorizationError('Reviewer, approver, or administrator role required');
  }
}
