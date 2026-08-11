import 'server-only';

import { defaultOdooGateway, type OdooGateway } from '@/lib/incentives/odoo/gateway';
import type { CustomerAssistantResponse, CustomerLookupItem } from '@/lib/stock/types';

type OdooMany2one = false | [number, string];

interface OdooCustomerRecord {
  id: number;
  name: string;
  vat: string | false;
  phone: string | false;
  street: string | false;
  street2: string | false;
  city: string | false;
  zip: string | false;
  state_id: OdooMany2one;
  country_id: OdooMany2one;
}

const CUSTOMER_FIELDS = [
  'id', 'name', 'vat', 'phone', 'street', 'street2', 'city', 'zip',
  'state_id', 'country_id',
];
const COMPANY_SUFFIXES = new Set([
  'limited', 'ltd', 'llp', 'private', 'pvt', 'company', 'co', 'enterprise', 'enterprises',
  'shri', 'shree', 'sri', 'm', 'ms',
]);

export async function findCustomersByName(
  searchName: string,
  companyId: number,
  gateway: OdooGateway = defaultOdooGateway,
): Promise<CustomerLookupItem[]> {
  const name = searchName.trim();
  if (!name) return [];
  const tokens = customerSearchTokens(name);
  let records = await gateway.searchRead<OdooCustomerRecord>(
    'res.partner',
    [
      ['active', '=', true],
      ['customer_rank', '>', 0],
      ['company_id', 'in', [false, companyId]],
      ...tokens.map((token) => ['name', 'ilike', token]),
    ],
    CUSTOMER_FIELDS,
    { limit: 30, order: 'name,id' },
  );
  if (records.length === 0 && tokens.length > 1) {
    const location = tokens[tokens.length - 1];
    records = await gateway.searchRead<OdooCustomerRecord>(
      'res.partner',
      [
        ['active', '=', true],
        ['customer_rank', '>', 0],
        ['company_id', 'in', [false, companyId]],
        ...tokens.slice(0, -1).map((token) => ['name', 'ilike', token]),
        ['city', 'ilike', location],
      ],
      CUSTOMER_FIELDS,
      { limit: 30, order: 'name,id' },
    );
  }
  if (records.length === 0 && tokens.length > 1) {
    records = await gateway.searchRead<OdooCustomerRecord>(
      'res.partner',
      [
        ['active', '=', true],
        ['customer_rank', '>', 0],
        ['company_id', 'in', [false, companyId]],
        ['name', 'ilike', customerSearchAnchor(name)],
      ],
      CUSTOMER_FIELDS,
      { limit: 30, order: 'name,id' },
    );
  }

  return records
    .map(toCustomerLookupItem)
    .sort((left, right) => customerMatchScore(right.name, name) - customerMatchScore(left.name, name)
      || left.name.localeCompare(right.name))
    .slice(0, 10);
}

export async function findCustomersByCity(
  searchCity: string,
  companyId: number,
  gateway: OdooGateway = defaultOdooGateway,
): Promise<CustomerLookupItem[]> {
  const city = searchCity.trim();
  if (!city) return [];
  const records = await gateway.searchRead<OdooCustomerRecord>(
    'res.partner',
    [
      ['active', '=', true],
      ['customer_rank', '>', 0],
      ['company_id', 'in', [false, companyId]],
      ['city', 'ilike', city],
    ],
    CUSTOMER_FIELDS,
    { limit: 100, order: 'name,id' },
  );

  return records.map(toCustomerLookupItem).sort((left, right) => (
    left.name.localeCompare(right.name)
  ));
}

export async function findCustomerById(
  customerId: number,
  companyId: number,
  gateway: OdooGateway = defaultOdooGateway,
): Promise<CustomerLookupItem | null> {
  if (!Number.isInteger(customerId) || customerId <= 0) return null;
  const records = await gateway.searchRead<OdooCustomerRecord>(
    'res.partner',
    [
      ['id', '=', customerId],
      ['active', '=', true],
      ['customer_rank', '>', 0],
      ['company_id', 'in', [false, companyId]],
    ],
    CUSTOMER_FIELDS,
    { limit: 1 },
  );
  return records[0] ? toCustomerLookupItem(records[0]) : null;
}

export function buildCustomerAssistantResponse(
  query: string,
  searchName: string,
  customers: CustomerLookupItem[],
  searchMode: 'name' | 'city' = 'name',
): CustomerAssistantResponse {
  let assistantMessage: string;
  if (!searchName) {
    assistantMessage = 'Tell me the customer name you want to find.';
  } else if (customers.length === 0) {
    assistantMessage = `I could not find an active customer matching “${searchName}” in Odoo.`;
  } else {
    assistantMessage = `I found ${customers.length} ${customers.length === 1 ? 'customer' : 'customers'} matching “${searchName}”.`;
  }
  return {
    kind: 'customer',
    query,
    searchName,
    searchMode,
    assistantMessage,
    source: 'odoo',
    fetchedAt: new Date().toISOString(),
    customers,
  };
}

function customerSearchAnchor(name: string): string {
  return customerSearchTokens(name)[0] ?? name;
}

function customerSearchTokens(name: string): string[] {
  return normalizeCustomerName(name)
    .split(' ')
    .filter((token) => token.length > 1 && !COMPANY_SUFFIXES.has(token));
}

function customerMatchScore(candidate: string, searchName: string): number {
  const candidateName = normalizeCustomerName(candidate);
  const queryName = normalizeCustomerName(searchName);
  if (candidateName === queryName) return 1_000;
  if (candidateName.startsWith(queryName)) return 850;
  if (candidateName.includes(queryName)) return 750;
  const queryTokens = queryName.split(' ').filter(Boolean);
  const candidateTokens = new Set(candidateName.split(' '));
  return queryTokens.reduce((score, token) => (
    score + (candidateTokens.has(token) ? 100 : candidateName.includes(token) ? 50 : 0)
  ), 0);
}

function normalizeCustomerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function toCustomerLookupItem(record: OdooCustomerRecord): CustomerLookupItem {
  return {
    id: record.id,
    name: record.name.trim(),
    gstNo: stringOrNull(record.vat),
    phone: stringOrNull(record.phone),
    address: formatCustomerAddress(record),
  };
}

function formatCustomerAddress(record: OdooCustomerRecord): string | null {
  const locality = [record.city, relationName(record.state_id), record.zip]
    .filter((value): value is string => Boolean(value))
    .join(', ');
  const lines = [record.street, record.street2, locality, relationName(record.country_id)]
    .filter((value): value is string => Boolean(value));
  return lines.length > 0 ? lines.join('\n') : null;
}

function relationName(value: OdooMany2one): string | null {
  return value === false ? null : value[1].trim() || null;
}

function stringOrNull(value: string | false): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
