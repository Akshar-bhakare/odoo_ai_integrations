import type { IncentiveActor } from '../incentives/odoo/authorization';

export interface AuthenticatedIncentiveActor extends IncentiveActor {
  name: string;
  login: string;
  currentCompanyId: number;
  employeeId: number | null;
  employeeMapping: 'mapped' | 'missing' | 'ambiguous';
}

export interface SessionClaims {
  userId: number;
  csrfToken: string;
  issuedAt: number;
  expiresAt: number;
}
