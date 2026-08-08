export interface SaleOrder {
  id: number;
  name: string;
  date_order: string;
  partner_id: [number, string] | false;
  partner_shipping_id: [number, string] | false;
  user_id: [number, string] | false;
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  invoice_status: 'upselling' | 'invoiced' | 'to invoice' | 'no';
  margin: number;
  margin_percent: number;
  currency_id: [number, string] | false;
  state: 'draft' | 'sent' | 'sale' | 'done' | 'cancel';
  invoice_ids: number[];
  order_line: number[];
  note: string | false;
}

export interface AccountMove {
  id: number;
  name: string;
  move_type: string;
  partner_id: [number, string] | false;
  invoice_date: string | false;
  invoice_date_due: string | false;
  invoice_line_ids: number[];
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  amount_residual: number;
  state: 'draft' | 'posted' | 'cancel';
  payment_state: 'not_paid' | 'in_payment' | 'paid' | 'partial' | 'reversed';
  x_studio_warranty_done?: boolean;
  x_studio_dcr_done?: boolean;
  x_studio_dcr_done_1?: boolean;
}

export interface AccountMoveLine {
  id: number;
  product_id: [number, string] | false;
  name: string;
  quantity: number;
  price_unit: number;
  price_subtotal: number;
  price_total: number;
  tax_ids?: number[] | Array<[number, string]>;
}

/**
 * Represents a tax line from account.move.line with display_type='tax'.
 * These contain the actual tax breakdown (SGST, CGST, IGST, etc.)
 * as recorded by Odoo, rather than any frontend calculation.
 */
export interface TaxLine {
  id: number;
  name: string;
  tax_line_id: [number, string] | false;
  tax_group_id: [number, string] | false;
  balance: number;
  credit: number;
  debit: number;
}

export interface ResPartner {
  id: number;
  name: string;
  street: string | false;
  street2: string | false;
  city: string | false;
  zip: string | false;
  state_id: [number, string] | false;
  country_id: [number, string] | false;
  vat: string | false;
  l10n_in_gst_treatment?: string | false;
}

export interface IrAttachment {
  id: number;
  name: string;
  mimetype: string;
  file_size: number;
  datas?: string | false;
}

export interface OdooResponse<T> {
  result: T;
}
