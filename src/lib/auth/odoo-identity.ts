import 'server-only';
import { defaultOdooGateway, type OdooGateway } from '../incentives/odoo/gateway';
import { INCENTIVE_ROLE_GROUPS } from '../incentives/odoo/studio-provisioning';
import type { IncentiveRole } from '../incentives/odoo/authorization';
import type { AuthenticatedIncentiveActor } from './types';
import { OdooApiError } from '../odoo/client';

type OdooMany2one = false | [number, string];

interface OdooUserRecord {
  id: number;
  name: string;
  login: string;
  active: boolean;
  company_id: OdooMany2one;
  company_ids: number[];
  group_ids: number[];
}

interface OdooEmployeeRecord {
  id: number;
  company_id: OdooMany2one;
}

const ROLE_BY_GROUP_NAME = new Map<string, IncentiveRole>([
  [INCENTIVE_ROLE_GROUPS.employee, 'employee'],
  [INCENTIVE_ROLE_GROUPS.reviewer, 'reviewer'],
  [INCENTIVE_ROLE_GROUPS.approver, 'approver'],
  [INCENTIVE_ROLE_GROUPS.administrator, 'administrator'],
  [INCENTIVE_ROLE_GROUPS.paymentRecorder, 'payment_recorder'],
]);

function many2oneId(value: OdooMany2one): number | null {
  return value === false ? null : value[0];
}

export class OdooAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OdooAuthenticationError';
  }
}

function odooWebBaseUrl(): string {
  const configured = process.env.ODOO_URL;
  if (!configured) {
    throw new Error('ODOO_URL is not configured');
  }
  const url = new URL(configured);
  return `${url.protocol}//${url.host}`;
}

export async function authenticateOdooCredentials(login: string, password: string): Promise<number> {
  const database = process.env.ODOO_DATABASE;
  if (!database) {
    throw new Error('ODOO_DATABASE is not configured');
  }
  const response = await fetch(`${odooWebBaseUrl()}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { db: database, login, password },
      id: null,
    }),
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 429) {
      throw new OdooApiError(
        'Odoo is temporarily rate-limiting requests. Please wait a few minutes and try again.',
        429,
      );
    }
    throw new OdooAuthenticationError('Odoo authentication is unavailable');
  }
  const body: unknown = await response.json();
  const result = isRecord(body) && isRecord(body.result) ? body.result : null;
  const userId = result && typeof result.uid === 'number' ? result.uid : null;
  if (userId === null) {
    throw new OdooAuthenticationError('Invalid Odoo login or password');
  }
  return userId;
}

export async function loadAuthenticatedActor(
  userId: number,
  gateway: OdooGateway = defaultOdooGateway,
): Promise<AuthenticatedIncentiveActor> {
  const users = await gateway.searchRead<OdooUserRecord>(
    'res.users',
    [['id', '=', userId], ['active', '=', true]],
    ['id', 'name', 'login', 'active', 'company_id', 'company_ids', 'group_ids'],
    { limit: 1 },
  );
  const user = users[0];
  if (!user) {
    throw new OdooAuthenticationError('Authenticated Odoo user is inactive or missing');
  }
  const currentCompanyId = many2oneId(user.company_id);
  if (currentCompanyId === null || !user.company_ids.includes(currentCompanyId)) {
    throw new OdooAuthenticationError('Authenticated Odoo user has an invalid company context');
  }
  const groups = user.group_ids.length === 0
    ? []
    : await gateway.searchReadAll<{ id: number; name: string }>(
        'res.groups',
        [['id', 'in', user.group_ids], ['name', 'in', [...ROLE_BY_GROUP_NAME.keys()]]],
        ['id', 'name'],
      );
  const roles = [...new Set(groups.flatMap((group) => {
    const role = ROLE_BY_GROUP_NAME.get(group.name);
    return role ? [role] : [];
  }))];
  const employees = await gateway.searchReadAll<OdooEmployeeRecord>(
    'hr.employee',
    [
      ['user_id', '=', userId],
      ['company_id', '=', currentCompanyId],
      ['active', '=', true],
    ],
    ['id', 'company_id'],
  );
  return {
    userId: user.id,
    name: user.name,
    login: user.login,
    currentCompanyId,
    companyIds: user.company_ids,
    roles,
    employeeId: employees.length === 1 ? employees[0].id : null,
    employeeMapping: employees.length === 0 ? 'missing' : employees.length === 1 ? 'mapped' : 'ambiguous',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
