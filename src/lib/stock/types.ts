export type OdooMany2one = false | [number, string];

export interface OdooStockProduct {
  id: number;
  display_name: string;
  default_code: string | false;
  uom_id: OdooMany2one;
  qty_available: number;
  free_qty: number;
  virtual_available: number;
  incoming_qty: number;
  outgoing_qty: number;
}

export interface AvailableStockItem {
  id: number;
  sku: string | null;
  name: string;
  uom: string;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  outgoing: number;
  forecast: number;
}

export interface AvailableStockResponse {
  spokenQuery: string;
  searchTerms: string[];
  fetchedAt: string;
  products: AvailableStockItem[];
}

export type StockResolutionStatus = 'matched' | 'possible_match' | 'not_found';

export interface StockAssistantConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StockAssistantRequestResult {
  requested: string;
  interpretation: string;
  status: StockResolutionStatus;
  reason: string;
  products: AvailableStockItem[];
}

export interface StockAssistantResponse {
  kind: 'stock';
  query: string;
  assistantMessage: string;
  model: string;
  source: 'ai' | 'deterministic';
  warning?: string;
  fetchedAt: string;
  requests: StockAssistantRequestResult[];
  products: AvailableStockItem[];
}

export interface CustomerLookupItem {
  id: number;
  name: string;
  gstNo: string | null;
  phone: string | null;
  address: string | null;
}

export interface CustomerAssistantResponse {
  kind: 'customer';
  query: string;
  searchName: string;
  searchMode: 'name' | 'city';
  assistantMessage: string;
  source: 'odoo';
  fetchedAt: string;
  customers: CustomerLookupItem[];
}

export interface ProformaCompanySummary {
  id: number;
  name: string;
  gstNo: string | null;
  address: string | null;
}

export interface ProformaProductMatch {
  id: number;
  sku: string | null;
  name: string;
  available: number;
  listPrice: number;
  taxRate: number;
  taxNames: string[];
}

export interface ProformaDraftLine extends ProformaProductMatch {
  quantity: number;
  unitPrice: number;
  subtotal: number;
  gstAmount: number;
  total: number;
}

export interface ProformaDraft {
  company: ProformaCompanySummary;
  customer: CustomerLookupItem | null;
  lines: ProformaDraftLine[];
  issueDate: string;
  validityDays: number;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  pendingCustomerCandidates: CustomerLookupItem[];
  pendingProductCandidates: ProformaProductMatch[];
  pendingProductRequest: { query: string; quantity: number | null; unitPrice: number | null } | null;
}

export interface ProformaAssistantResponse {
  kind: 'proforma';
  query: string;
  assistantMessage: string;
  fetchedAt: string;
  action: 'needs_customer' | 'needs_product' | 'needs_choice' | 'preview' | 'finalized';
  draft: ProformaDraft;
}

export type CopilotResponse = StockAssistantResponse | CustomerAssistantResponse | ProformaAssistantResponse;
