import 'server-only';

import { defaultOdooGateway, type OdooGateway } from '../incentives/odoo/gateway';
import { extractStockSearchTerms, matchStockRequestProducts } from './query';
import type {
  AvailableStockItem,
  AvailableStockResponse,
  OdooStockProduct,
} from './types';

const STOCK_FIELDS = [
  'id', 'display_name', 'default_code', 'uom_id', 'qty_available', 'free_qty',
  'virtual_available', 'incoming_qty', 'outgoing_qty',
];

export async function getAvailableStock(
  spokenQuery = '',
  gateway: OdooGateway = defaultOdooGateway,
): Promise<AvailableStockResponse> {
  const searchTerms = extractStockSearchTerms(spokenQuery);
  const records = await gateway.searchReadAll<OdooStockProduct>(
    'product.product',
    [['qty_available', '>', 0]],
    STOCK_FIELDS,
    { order: 'default_code,id' },
  );

  const availableProducts = records
    .map(toAvailableStockItem)
    .filter((product) => product.available > 0)
    .sort((left, right) => {
      const skuOrder = (left.sku ?? '').localeCompare(right.sku ?? '');
      return skuOrder || left.name.localeCompare(right.name);
    });
  const products = spokenQuery.trim()
    ? matchStockRequestProducts(spokenQuery, availableProducts)
    : availableProducts;

  return {
    spokenQuery: spokenQuery.trim(),
    searchTerms,
    fetchedAt: new Date().toISOString(),
    products,
  };
}

function toAvailableStockItem(record: OdooStockProduct): AvailableStockItem {
  const onHand = finiteQuantity(record.qty_available);
  const available = finiteQuantity(record.free_qty);
  return {
    id: record.id,
    sku: record.default_code || null,
    name: stripSku(record.display_name),
    uom: record.uom_id === false ? 'Units' : record.uom_id[1],
    onHand,
    reserved: roundQuantity(Math.max(0, onHand - available)),
    available,
    incoming: finiteQuantity(record.incoming_qty),
    outgoing: finiteQuantity(record.outgoing_qty),
    forecast: finiteQuantity(record.virtual_available),
  };
}

function stripSku(displayName: string): string {
  return displayName.replace(/^\[[^\]]+\]\s*/, '').trim();
}

function finiteQuantity(value: number): number {
  return Number.isFinite(value) ? roundQuantity(value) : 0;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
