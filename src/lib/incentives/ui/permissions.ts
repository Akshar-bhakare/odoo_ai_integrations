import type { SessionActor } from './types';

export function canReview(actor: SessionActor): boolean {
  return actor.roles.some((role) => ['reviewer', 'approver', 'administrator'].includes(role));
}

export function canApprove(actor: SessionActor): boolean {
  return actor.roles.some((role) => ['approver', 'administrator'].includes(role));
}

export function canAdminister(actor: SessionActor): boolean {
  return actor.roles.includes('administrator');
}

export function canRecordPayment(actor: SessionActor): boolean {
  return actor.roles.some((role) => ['payment_recorder', 'administrator'].includes(role));
}
