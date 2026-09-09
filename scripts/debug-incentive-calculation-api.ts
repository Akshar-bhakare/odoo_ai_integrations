import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface LoginResponse {
  actor?: {
    name: string;
    currentCompanyId: number;
    employeeId: number | null;
    roles: string[];
  };
  csrfToken?: string;
  error?: string;
}

interface EmployeeRecord {
  id: number;
  name: string;
}

interface AssignmentRecord {
  id: number;
  x_employee_id: false | [number, string];
  x_preset_version_id: false | [number, string];
  x_date_from: string;
  x_date_to: string | false;
  x_active: boolean;
}

function loadEnvironment(): void {
  const path = resolve(process.cwd(), '.env.local');
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    process.env[key] ??= value;
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Phase 5.5 API diagnostics`);
  return value;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function main(): Promise<void> {
  loadEnvironment();
  const login = requiredEnvironment('ODOO_TEST_LOGIN');
  const password = requiredEnvironment('ODOO_TEST_PASSWORD');
  const baseUrl = (process.env.INCENTIVE_DEBUG_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ login, password }),
  });
  const loginBody = await json(loginResponse) as LoginResponse;
  const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
  if (!loginResponse.ok || !loginBody.csrfToken || !cookie || !loginBody.actor) {
    throw new Error(`Login failed (${loginResponse.status}): ${loginBody.error ?? 'No session returned'}`);
  }

  const authenticatedFetch = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Cookie: cookie, ...init.headers },
  });
  const [employeeResponse, assignmentResponse] = await Promise.all([
    authenticatedFetch('/api/incentives/employees'),
    authenticatedFetch('/api/incentives/assignments'),
  ]);
  const employees = await employeeResponse.json() as EmployeeRecord[];
  const assignments = await assignmentResponse.json() as AssignmentRecord[];
  const month = process.env.INCENTIVE_DEBUG_MONTH || currentMonth();
  const configuredEmployeeId = Number(process.env.INCENTIVE_DEBUG_EMPLOYEE_ID);
  const employeeId = Number.isInteger(configuredEmployeeId) && configuredEmployeeId > 0
    ? configuredEmployeeId
    : employees[0]?.id;
  if (!employeeId) throw new Error('No employee is available for the browser-payload reproduction');

  const postCalculation = async (payload: { employeeId: number; month: string }, includeCsrf = true) => {
    const response = await authenticatedFetch('/api/incentives/calculations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        ...(includeCsrf ? { 'x-csrf-token': loginBody.csrfToken! } : {}),
      },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await json(response) };
  };

  const browserPayload = { employeeId, month };
  const browserResult = await postCalculation(browserPayload);
  const unauthenticated = await fetch(`${baseUrl}/api/incentives/calculations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify(browserPayload),
  });
  const missingCsrf = await postCalculation(browserPayload, false);

  let assignedWrite: unknown = 'skipped; set INCENTIVE_DEBUG_VALID_WRITE=true to enable';
  if (process.env.INCENTIVE_DEBUG_VALID_WRITE === 'true') {
    const assignment = assignments.find((item) => item.x_active && item.x_employee_id);
    if (!assignment || !assignment.x_employee_id) {
      assignedWrite = 'skipped; no active assignment exists';
    } else {
      assignedWrite = await postCalculation({
        employeeId: assignment.x_employee_id[0],
        month: assignment.x_date_from.slice(0, 7),
      });
    }
  }

  console.log(JSON.stringify({
    endpoint: 'POST /api/incentives/calculations',
    actor: loginBody.actor,
    browserPayload,
    browserResult,
    security: {
      noSession: { status: unauthenticated.status, body: await json(unauthenticated) },
      missingCsrf,
    },
    availableEmployees: employees.map((employee) => ({ id: employee.id, name: employee.name })),
    activeAssignments: assignments.filter((assignment) => assignment.x_active).map((assignment) => ({
      id: assignment.id,
      employeeId: assignment.x_employee_id ? assignment.x_employee_id[0] : null,
      presetVersionId: assignment.x_preset_version_id ? assignment.x_preset_version_id[0] : null,
      effectiveFrom: assignment.x_date_from,
      effectiveTo: assignment.x_date_to,
    })),
    assignedWrite,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
