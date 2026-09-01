import type { OdooGateway } from '@/lib/incentives/odoo/gateway';

type Many2one = false | [number, string];

interface SaleOrderLineRecord {
  id: number;
  order_id: Many2one;
  salesman_id: Many2one;
}

interface SaleOrderRecord {
  id: number;
  name: string;
  user_id: Many2one;
  invoice_ids: number[];
  x_studio_transport_charges: number | false;
  x_studio_loading_charges: number | false;
}

export interface MoveSaleLinks {
  moveId: number;
  saleLineIds: number[];
}

export interface SalesOrderAttribution {
  salespersonUserId: number | null;
  salespersonName: string;
  salesOrderIds: number[];
  salesOrderNames: string[];
  transport: number;
  loading: number;
}

function relationId(value: Many2one): number | null {
  return value === false ? null : value[0];
}

function relationName(value: Many2one): string {
  return value === false ? '' : value[1];
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}

export async function fetchSalesOrderAttribution(
  gateway: OdooGateway,
  links: MoveSaleLinks[],
): Promise<Map<number, SalesOrderAttribution>> {
  const moveIds = unique(links.map((link) => link.moveId));
  const saleLineIds = unique(links.flatMap((link) => link.saleLineIds));
  const saleLines = saleLineIds.length === 0 ? [] : await gateway.searchReadAll<SaleOrderLineRecord>(
    'sale.order.line',
    [['id', 'in', saleLineIds]],
    ['id', 'order_id', 'salesman_id'],
  );
  const saleLineById = new Map(saleLines.map((line) => [line.id, line]));
  const linkedOrderIds = unique(saleLines.flatMap((line) => {
    const id = relationId(line.order_id);
    return id === null ? [] : [id];
  }));
  const orders = moveIds.length === 0 ? [] : await gateway.searchReadAll<SaleOrderRecord>(
    'sale.order',
    linkedOrderIds.length > 0
      ? ['|', ['id', 'in', linkedOrderIds], ['invoice_ids', 'in', moveIds]]
      : [['invoice_ids', 'in', moveIds]],
    [
      'id', 'name', 'user_id', 'invoice_ids',
      'x_studio_transport_charges', 'x_studio_loading_charges',
    ],
  );
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const ordersByMoveId = new Map<number, SaleOrderRecord[]>();
  for (const order of orders) {
    for (const moveId of order.invoice_ids ?? []) {
      ordersByMoveId.set(moveId, [...(ordersByMoveId.get(moveId) ?? []), order]);
    }
  }

  return new Map(links.map((link) => {
    const directSaleLines = unique(link.saleLineIds)
      .map((id) => saleLineById.get(id))
      .filter((line): line is SaleOrderLineRecord => Boolean(line));
    const directOrders = directSaleLines
      .map((line) => relationId(line.order_id))
      .filter((id): id is number => id !== null)
      .map((id) => orderById.get(id))
      .filter((order): order is SaleOrderRecord => Boolean(order));
    const associatedOrders = [...new Map(
      [...directOrders, ...(ordersByMoveId.get(link.moveId) ?? [])]
        .map((order) => [order.id, order]),
    ).values()];
    const directSalesperson = directSaleLines
      .map((line) => line.salesman_id)
      .find((value) => value !== false);
    const orderSalesperson = associatedOrders
      .map((order) => order.user_id)
      .find((value) => value !== false);
    const salesperson = directSalesperson || orderSalesperson || false;
    return [link.moveId, {
      salespersonUserId: relationId(salesperson),
      salespersonName: relationName(salesperson),
      salesOrderIds: associatedOrders.map((order) => order.id).sort((a, b) => a - b),
      salesOrderNames: associatedOrders.map((order) => order.name).sort(),
      transport: associatedOrders.reduce(
        (sum, order) => sum + Number(order.x_studio_transport_charges || 0),
        0,
      ),
      loading: associatedOrders.reduce(
        (sum, order) => sum + Number(order.x_studio_loading_charges || 0),
        0,
      ),
    }];
  }));
}
