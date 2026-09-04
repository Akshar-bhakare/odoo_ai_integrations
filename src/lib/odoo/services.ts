import { odooFetch } from './client';
import { SaleOrder, AccountMove, AccountMoveLine, ResPartner, IrAttachment, TaxLine } from './types';

/**
 * Fetch a list of sales orders with search and status filtering.
 */
export async function getSalesOrders(filters: {
  search?: string;
  invoiceStatus?: string;
  orderStatus?: string;
} = {}): Promise<SaleOrder[]> {
  const domain: unknown[] = [];

  // Add search filter if provided
  if (filters.search) {
    // search in name (SO number) or partner name
    domain.push('|', ['name', 'ilike', filters.search], ['partner_id', 'ilike', filters.search]);
  }

  // Add invoice status filter if provided
  if (filters.invoiceStatus && filters.invoiceStatus !== 'all') {
    domain.push(['invoice_status', '=', filters.invoiceStatus]);
  }

  // Add order status filter if provided
  if (filters.orderStatus && filters.orderStatus !== 'all') {
    domain.push(['state', '=', filters.orderStatus]);
  }

  const fields = [
    'id',
    'name',
    'date_order',
    'partner_id',
    'user_id',
    'amount_untaxed',
    'amount_tax',
    'amount_total',
    'invoice_status',
    'margin',
    'margin_percent',
    'currency_id',
    'state',
    'invoice_ids',
    'order_line',
    'note'
  ];

  const orders = await odooFetch<SaleOrder[]>('sale.order', 'search_read', domain, fields, {
    order: 'date_order desc',
    limit: 100, // Fetch up to 100 recent orders
  });

  return orders;
}

/**
 * Fetch a single Sales Order and all its related customer, invoice, and attachment data.
 */
export async function getSalesOrderById(id: number): Promise<{
  order: SaleOrder;
  partner: ResPartner | null;
  invoices: AccountMove[];
  invoiceLines: AccountMoveLine[];
  attachments: IrAttachment[];
  taxLines?: TaxLine[];
}> {
  // 1. Fetch Sales Order
  const orderFields = [
    'id',
    'name',
    'date_order',
    'partner_id',
    'partner_shipping_id',
    'user_id',
    'amount_untaxed',
    'amount_tax',
    'amount_total',
    'invoice_status',
    'margin',
    'margin_percent',
    'currency_id',
    'state',
    'invoice_ids',
    'order_line',
    'note'
  ];

  const orders = await odooFetch<SaleOrder[]>('sale.order', 'search_read', [['id', '=', id]], orderFields);
  if (!orders || orders.length === 0) {
    throw new Error(`Sales Order with ID ${id} not found.`);
  }
  const order = orders[0];

  // 2. Fetch Customer (res.partner)
  let partner: ResPartner | null = null;
  if (order.partner_id) {
    const partnerId = order.partner_id[0];
    const partnerFields = [
      'id',
      'name',
      'street',
      'street2',
      'city',
      'zip',
      'state_id',
      'country_id',
      'vat',
      'l10n_in_gst_treatment'
    ];
    try {
      const partners = await odooFetch<ResPartner[]>('res.partner', 'search_read', [['id', '=', partnerId]], partnerFields);
      if (partners && partners.length > 0) {
        partner = partners[0];
      }
    } catch (err) {
      console.warn(`Failed to fetch partner info for ID ${partnerId}, continuing...`, err);
    }
  }

  // 3. Fetch Invoices (account.move)
  let invoices: AccountMove[] = [];
  if (order.invoice_ids && order.invoice_ids.length > 0) {
    const invoiceFields = [
      'id',
      'name',
      'move_type',
      'partner_id',
      'invoice_date',
      'invoice_date_due',
      'invoice_line_ids',
      'amount_untaxed',
      'amount_tax',
      'amount_total',
      'amount_residual',
      'state',
      'payment_state',
      'x_studio_warranty_done',
      'x_studio_dcr_done',
      'x_studio_dcr_done_1'
    ];
    try {
      invoices = await odooFetch<AccountMove[]>('account.move', 'search_read', [['id', 'in', order.invoice_ids]], invoiceFields);
    } catch (err) {
      console.warn('Retrying invoice query without custom studio fields...', err);
      // Fallback if custom studio fields do not exist
      const fallbackFields = [
        'id',
        'name',
        'move_type',
        'partner_id',
        'invoice_date',
        'invoice_date_due',
        'invoice_line_ids',
        'amount_untaxed',
        'amount_tax',
        'amount_total',
        'amount_residual',
        'state',
        'payment_state'
      ];
      invoices = await odooFetch<AccountMove[]>('account.move', 'search_read', [['id', 'in', order.invoice_ids]], fallbackFields);
    }
  }

  // Filter to invoice-types (e.g. out_invoice, out_refund)
  invoices = invoices.filter(inv => inv.move_type === 'out_invoice' || inv.move_type === 'out_refund' || inv.move_type === 'entry');

  // 4. Fetch Invoice Lines (account.move.line)
  let invoiceLines: AccountMoveLine[] = [];
  const lineIds = invoices.flatMap(inv => inv.invoice_line_ids || []);
  if (lineIds.length > 0) {
    const lineFields = [
      'id',
      'product_id',
      'name',
      'quantity',
      'price_unit',
      'price_subtotal',
      'price_total',
      'tax_ids'
    ];
    try {
      invoiceLines = await odooFetch<AccountMoveLine[]>('account.move.line', 'search_read', [['id', 'in', lineIds]], lineFields);
      // Filter out line items that don't have a product (e.g. tax lines or sections if they appear here)
      invoiceLines = invoiceLines.filter(line => line.product_id !== false);
    } catch (err) {
      console.warn('Failed to fetch invoice lines, continuing...', err);
    }
  }

  // 4b. Fetch Tax Lines and prepare invoiceIds
  const invoiceIds = invoices.map(inv => inv.id);
  let taxLines: TaxLine[] = [];
  if (invoiceIds.length > 0) {
    try {
      taxLines = await odooFetch<TaxLine[]>('account.move.line', 'search_read', [
        ['move_id', 'in', invoiceIds],
        ['display_type', '=', 'tax']
      ], ['id', 'name', 'tax_line_id', 'tax_group_id', 'balance', 'credit', 'debit']);
    } catch (err) {
      console.warn('Failed to fetch tax lines, continuing...', err);
    }
  }

  // 5. Fetch Attachments from account.move (invoices) and sale.order separately
  let attachments: IrAttachment[] = [];
  const attachmentFields = ['id', 'name', 'mimetype', 'file_size'];

  const filterAtts = (list: IrAttachment[]) => list.filter(att => {
    const name = (att.name || '').toLowerCase();
    const mime = (att.mimetype || '').toLowerCase();
    if (name.endsWith('.json') || mime === 'application/json') return false;
    if (name.endsWith('.xml') && (name.includes('request') || name.includes('response'))) return false;
    return true;
  });

  try {
    const orderAttachments = await odooFetch<IrAttachment[]>('ir.attachment', 'search_read',
      [['res_model', '=', 'sale.order'], ['res_id', '=', id]],
      attachmentFields
    ).catch(() => []);
    const invoiceAttachments = invoiceIds.length === 0 ? [] : await odooFetch<IrAttachment[]>(
      'ir.attachment',
      'search_read',
      [['res_model', '=', 'account.move'], ['res_id', 'in', invoiceIds]],
      attachmentFields,
    ).catch(() => []);
    const allAtts = [...orderAttachments, ...invoiceAttachments];

    // Deduplicate by id
    const seen = new Set<number>();
    const deduped = allAtts.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });

    attachments = filterAtts(deduped);

    // Sort: PDFs first, then images, then others
    attachments.sort((a, b) => {
      const score = (m: string) => m === 'application/pdf' ? 0 : m.startsWith('image/') ? 1 : 2;
      return score(a.mimetype) - score(b.mimetype);
    });
  } catch (err) {
    console.warn('Failed to fetch attachments, continuing...', err);
  }

  return { order, partner, invoices, invoiceLines, attachments, taxLines };
}

/**
 * Fetch the base64 content of a single attachment.
 */
export async function getAttachmentData(id: number): Promise<IrAttachment> {
  const fields = ['id', 'name', 'mimetype', 'file_size', 'datas'];
  const attachments = await odooFetch<IrAttachment[]>('ir.attachment', 'search_read', [['id', '=', id]], fields);
  if (!attachments || attachments.length === 0) {
    throw new Error(`Attachment with ID ${id} not found.`);
  }
  return attachments[0];
}
