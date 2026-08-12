import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { OdooGateway } from '../incentives/odoo/gateway';
import { getAvailableStock } from './service';
import type { OdooStockProduct } from './types';

function stockGateway(records: OdooStockProduct[]): OdooGateway {
  return {
    searchReadAll: vi.fn(async () => records),
  } as unknown as OdooGateway;
}

describe('available stock service', () => {
  it('requests live on-hand records and returns only positive free stock', async () => {
    const gateway = stockGateway([
      {
        id: 2,
        display_name: '[SM-002] Waaree 650Wp TopCon Solar Module',
        default_code: 'SM-002',
        uom_id: [1, 'Units'],
        qty_available: 30,
        free_qty: 25,
        virtual_available: 28,
        incoming_qty: 3,
        outgoing_qty: 5,
      },
      {
        id: 1,
        display_name: '[SM-001] Reserved Solar Module',
        default_code: 'SM-001',
        uom_id: [1, 'Units'],
        qty_available: 10,
        free_qty: 0,
        virtual_available: 10,
        incoming_qty: 0,
        outgoing_qty: 0,
      },
    ]);

    const result = await getAvailableStock('', gateway);

    expect(gateway.searchReadAll).toHaveBeenCalledWith(
      'product.product',
      [['qty_available', '>', 0]],
      expect.arrayContaining(['qty_available', 'free_qty', 'virtual_available']),
      { order: 'default_code,id' },
    );
    expect(result.products).toEqual([{
      id: 2,
      sku: 'SM-002',
      name: 'Waaree 650Wp TopCon Solar Module',
      uom: 'Units',
      onHand: 30,
      reserved: 5,
      available: 25,
      incoming: 3,
      outgoing: 5,
      forecast: 28,
    }]);
  });

  it('applies the normalized spoken query to the returned stock', async () => {
    const gateway = stockGateway([
      {
        id: 1,
        display_name: '[SM-001] Waaree 615Wp TopCon BF DCR Solar Module',
        default_code: 'SM-001',
        uom_id: [1, 'Units'],
        qty_available: 8,
        free_qty: 8,
        virtual_available: 8,
        incoming_qty: 0,
        outgoing_qty: 0,
      },
      {
        id: 2,
        display_name: '[INV-001] Polycab Solar Inverter',
        default_code: 'INV-001',
        uom_id: [1, 'Units'],
        qty_available: 4,
        free_qty: 4,
        virtual_available: 4,
        incoming_qty: 0,
        outgoing_qty: 0,
      },
    ]);

    const result = await getAvailableStock(
      'show me Wari six fifteen watt D C R panels',
      gateway,
    );

    expect(result.searchTerms).toEqual(['waaree', '615w', 'dcr', 'module']);
    expect(result.products.map((product) => product.id)).toEqual([1]);
  });
});
