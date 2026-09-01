export type IncentiveRole =
  | 'employee'
  | 'reviewer'
  | 'approver'
  | 'administrator'
  | 'payment_recorder';

export type IncentiveWriteAction =
  | 'manage_presets'
  | 'manage_assignments'
  | 'attribute_expense'
  | 'attribute_commission'
  | 'resolve_customer_owner'
  | 'adjust_calculation'
  | 'review_calculation'
  | 'approve_calculation'
  | 'record_payment';

export interface IncentiveActor {
  userId: number;
  companyIds: number[];
  roles: readonly IncentiveRole[];
}

const ACTION_ROLES: Record<IncentiveWriteAction, ReadonlySet<IncentiveRole>> = {
  manage_presets: new Set(['administrator']),
  manage_assignments: new Set(['administrator']),
  attribute_expense: new Set(['reviewer', 'approver', 'administrator']),
  attribute_commission: new Set(['reviewer', 'approver', 'administrator']),
  resolve_customer_owner: new Set(['reviewer', 'approver', 'administrator']),
  adjust_calculation: new Set(['reviewer', 'approver', 'administrator']),
  review_calculation: new Set(['reviewer', 'approver', 'administrator']),
  approve_calculation: new Set(['approver', 'administrator']),
  record_payment: new Set(['payment_recorder', 'administrator']),
};

export class IncentiveAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncentiveAuthorizationError';
  }
}

export function assertIncentiveAuthorization(
  actor: IncentiveActor | null | undefined,
  action: IncentiveWriteAction,
  companyId: number,
): asserts actor is IncentiveActor {
  if (!actor) {
    throw new IncentiveAuthorizationError('An authenticated incentive actor is required');
  }
  if (!actor.companyIds.includes(companyId)) {
    throw new IncentiveAuthorizationError(`User ${actor.userId} cannot access company ${companyId}`);
  }
  if (!actor.roles.some((role) => ACTION_ROLES[action].has(role))) {
    throw new IncentiveAuthorizationError(`User ${actor.userId} is not authorized for ${action}`);
  }
}
