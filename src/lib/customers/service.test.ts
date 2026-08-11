import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { OdooGateway } from '@/lib/incentives/odoo/gateway';
import { buildCustomerAssistantResponse, findCustomersByCity, findCustomersByName } from './service';

describe('customer lookup service', () => {
  it('scopes Odoo customers to the current company and formats their details', async () => {
    const searchRead = vi.fn(async () => [
      {
        id: 20,
        name: 'Adhiraj Urja Solar Solution Pvt Ltd',
        vat: '27ABCDE1234F1Z5',
        phone: '020-12345678',
        street: 'Plot 12, Solar Park',
        street2: 'MIDC Road',
        city: 'Pune',
        zip: '411001',
        state_id: [27, 'Maharashtra'],
        country_id: [104, 'India'],
      },
    ]);
    const gateway = { searchRead } as unknown as OdooGateway;

    const customers = await findCustomersByName('Adhiraj Urja', 7, gateway);

    expect(searchRead).toHaveBeenCalledWith(
      'res.partner',
      expect.arrayContaining([
        ['customer_rank', '>', 0],
        ['company_id', 'in', [false, 7]],
        ['name', 'ilike', 'adhiraj'],
        ['name', 'ilike', 'urja'],
      ]),
      expect.arrayContaining(['name', 'vat', 'phone', 'street']),
      { limit: 30, order: 'name,id' },
    );
    expect(customers).toEqual([{
      id: 20,
      name: 'Adhiraj Urja Solar Solution Pvt Ltd',
      gstNo: '27ABCDE1234F1Z5',
      phone: '020-12345678',
      address: 'Plot 12, Solar Park\nMIDC Road\nPune, Maharashtra, 411001\nIndia',
    }]);
  });

  it('tries the final term as a city before falling back to a broad name match', async () => {
    const searchRead = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const gateway = { searchRead } as unknown as OdooGateway;

    await findCustomersByName('Shri Engineering Sangli', 7, gateway);

    expect(searchRead).toHaveBeenCalledTimes(3);
    expect(searchRead.mock.calls[0][1]).toEqual(expect.arrayContaining([
      ['name', 'ilike', 'engineering'],
      ['name', 'ilike', 'sangli'],
    ]));
    expect(searchRead.mock.calls[1][1]).toEqual(expect.arrayContaining([
      ['name', 'ilike', 'engineering'],
      ['city', 'ilike', 'sangli'],
    ]));
    expect(searchRead.mock.calls[2][1]).toEqual(expect.arrayContaining([
      ['name', 'ilike', 'engineering'],
    ]));
  });

  it('returns a useful empty response without inventing customer details', () => {
    const response = buildCustomerAssistantResponse(
      'Find customer Missing Company',
      'Missing Company',
      [],
    );

    expect(response.kind).toBe('customer');
    expect(response.customers).toEqual([]);
    expect(response.assistantMessage).toContain('could not find');
  });

  it('filters active customers by city and keeps the company scope', async () => {
    const searchRead = vi.fn(async () => [
      {
        id: 51,
        name: 'Nashik Solar Traders',
        vat: false,
        phone: false,
        street: false,
        street2: false,
        city: 'Nashik',
        zip: '422001',
        state_id: [27, 'Maharashtra'],
        country_id: [104, 'India'],
      },
    ]);
    const gateway = { searchRead } as unknown as OdooGateway;

    const customers = await findCustomersByCity('nashik', 7, gateway);

    expect(searchRead).toHaveBeenCalledWith(
      'res.partner',
      expect.arrayContaining([
        ['customer_rank', '>', 0],
        ['company_id', 'in', [false, 7]],
        ['city', 'ilike', 'nashik'],
      ]),
      expect.arrayContaining(['name', 'city']),
      { limit: 100, order: 'name,id' },
    );
    expect(customers[0].name).toBe('Nashik Solar Traders');
  });
});
