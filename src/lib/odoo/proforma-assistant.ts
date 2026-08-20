import 'server-only';

import { findCustomerById, findCustomersByName } from '@/lib/customers/service';
import {
  getInStockProformaProducts,
  getProformaCompany,
  type ProformaProduct,
} from '@/lib/odoo/proforma';
import type {
  CustomerLookupItem,
  ProformaAssistantResponse,
  ProformaCompanySummary,
  ProformaDraft,
  ProformaDraftLine,
  ProformaProductMatch,
} from '@/lib/stock/types';

const PROFORMA_PATTERN = /\b(?:pi|proforma|pro-forma|invoice)\b/i;
const LOCALIZED_PROFORMA_PATTERN = /(?:बनाओ|बनवा|तैयार\s+करो|तयार\s+करा|निर्माण\s+करो|प्रोफॉर्मा|इनवॉइस)/i;
const FINALIZE_PATTERN = /\b(?:generate|finali[sz]e|create)(?:\s+(?:the|this))?(?:\s+(?:pdf|pi|proforma|invoice))?\s*$/i;
const REMOVE_LAST_PATTERN = /\bremove\s+(?:the\s+)?last(?:\s+(?:product|item|line))?\b/i;
const REMOVE_CURRENT_PATTERN = /\bremove\s+(?:this|the)\s+(?:product|item|line)\b/i;
const CUSTOMER_CHANGE_PATTERN = /\b(?:switch|replace|change)\s+(?:the\s+)?customer\s+(?:to|with)\s+(.+)$/i;

type ProductRequest = { query: string; quantity: number | null; unitPrice: number | null };

export function isProformaAssistantRequest(query: string, draft: unknown): boolean {
  if (PROFORMA_PATTERN.test(query) || LOCALIZED_PROFORMA_PATTERN.test(query)) return true;
  if (!isRecord(draft)) return false;
  return /\b(?:add|remove|change|update|set|switch|replace|customer\s+\d+|product\s+\d+|this\s+(?:one|customer|product)|generate)\b/i.test(query);
}

export async function resolveProformaAssistant(params: {
  query: string;
  companyId: number;
  draft: unknown;
}): Promise<ProformaAssistantResponse> {
  const [company, catalog] = await Promise.all([
    getProformaCompany(params.companyId),
    getInStockProformaProducts(),
  ]);
  const draft = await hydrateDraft(params.draft, company, catalog, params.companyId);
  const query = normalizePiLanguage(params.query.trim());
  let assistantMessage = '';
  let action: ProformaAssistantResponse['action'] = 'needs_customer';

  const selectedCustomer = customerSelection(query, draft.pendingCustomerCandidates);
  if (selectedCustomer) {
    const customer = await findCustomerById(selectedCustomer.id, params.companyId);
    if (!customer) {
      draft.pendingCustomerCandidates = [];
      assistantMessage = 'That customer is no longer available in Odoo. Please search again.';
    } else {
      draft.customer = customer;
      draft.pendingCustomerCandidates = [];
      assistantMessage = `Customer set to ${customer.name}.`;
      if (draft.pendingProductRequest) {
        const productResult = addProductRequest(draft, draft.pendingProductRequest, catalog);
        assistantMessage = `${assistantMessage} ${productResult.message}`.trim();
      }
    }
    return response(query, draft, assistantMessage, chooseAction(draft));
  }

  const selectedProduct = productSelection(query, draft.pendingProductCandidates);
  if (selectedProduct) {
    const request = draft.pendingProductRequest;
    if (!request) {
      assistantMessage = 'Tell me the quantity and unit price for the selected product.';
    } else {
      const product = catalog.find((item) => item.id === selectedProduct.id);
      if (!product) {
        draft.pendingProductCandidates = [];
        assistantMessage = 'That product is no longer available in Odoo. Please search again.';
      } else if (request.quantity === null) {
        assistantMessage = `How many units of ${product.name} should I add?`;
      } else {
        const price = request.unitPrice ?? product.listPrice;
        if (price <= 0) {
          assistantMessage = `What unit price should I use for ${product.name}?`;
        } else {
          addLine(draft, product, request.quantity, price);
          draft.pendingProductCandidates = [];
          draft.pendingProductRequest = null;
          assistantMessage = `Added ${product.name} to the PI draft.`;
        }
      }
    }
    return response(query, draft, assistantMessage, chooseAction(draft));
  }

  const customerChange = query.match(CUSTOMER_CHANGE_PATTERN)?.[1];
  if (customerChange) {
    assistantMessage = await setCustomerFromQuery(draft, customerChange, params.companyId);
    return response(query, draft, assistantMessage, chooseAction(draft));
  }

  if (REMOVE_LAST_PATTERN.test(query) || REMOVE_CURRENT_PATTERN.test(query)) {
    const line = findEditedLine(draft.lines, query);
    const removed = line ? draft.lines.splice(draft.lines.indexOf(line), 1)[0] : null;
    assistantMessage = removed ? `Removed ${removed.name}.` : 'There is no product line to remove.';
    return response(query, draft, assistantMessage, chooseAction(draft));
  }

  if (draft.lines.length > 0 && /\b(?:change|update|set)\b/i.test(query)) {
    const edit = parseLineEdit(query);
    if (edit) {
      const line = findEditedLine(draft.lines, query);
      if (!line) {
        assistantMessage = 'Which product line should I update?';
      } else if (edit.quantity !== null && edit.quantity > line.available) {
        assistantMessage = `Only ${line.available} units of ${line.name} are available in Odoo.`;
      } else {
        if (edit.quantity !== null) line.quantity = edit.quantity;
        if (edit.unitPrice !== null) line.unitPrice = edit.unitPrice;
        recalculateLine(line);
        assistantMessage = `Updated ${line.name}.`;
      }
      return response(query, draft, assistantMessage, chooseAction(draft));
    }
  }

  const addRequest = parseAddProductRequest(query);
  if (addRequest) {
    const productResult = addProductRequest(draft, addRequest, catalog);
    return response(query, draft, productResult.message, chooseAction(draft));
  }

  if (FINALIZE_PATTERN.test(query) && draft.customer && draft.lines.length > 0) {
    return response(query, draft, 'Your PI is ready. Generating the PDF now.', 'finalized');
  }

  if (PROFORMA_PATTERN.test(query)) {
    const initial = parseInitialRequest(query);
    if (initial.customerQuery && initial.productRequest && /\b(?:generate|create|finali[sz]e)\b/i.test(query)) {
      draft.customer = null;
      draft.lines = [];
      draft.pendingCustomerCandidates = [];
      draft.pendingProductCandidates = [];
      draft.pendingProductRequest = null;
    }
    if (initial.customerQuery) assistantMessage = await setCustomerFromQuery(draft, initial.customerQuery, params.companyId);
    if (initial.productRequest) {
      const productResult = addProductRequest(draft, initial.productRequest, catalog);
      assistantMessage = [assistantMessage, productResult.message].filter(Boolean).join(' ');
    }
    if (!assistantMessage) assistantMessage = 'Which customer should this PI be for?';
    action = chooseAction(draft);
    return response(query, draft, assistantMessage, action);
  }

  return response(query, draft, draft.customer
    ? 'Tell me the product, quantity, and unit price to add.'
    : 'Which customer should this PI be for?', chooseAction(draft));
}

async function hydrateDraft(
  value: unknown,
  company: ProformaCompanySummary,
  catalog: ProformaProduct[],
  companyId: number,
): Promise<ProformaDraft> {
  const source = isRecord(value) ? value : {};
  const customerId = isRecord(source.customer) && integer(source.customer.id);
  const customer = customerId ? await findCustomerById(customerId, companyId) : null;
  const lines = Array.isArray(source.lines)
    ? source.lines.flatMap((line) => hydrateLine(line, catalog))
    : [];
  const draft: ProformaDraft = {
    company,
    customer,
    lines,
    issueDate: dateOrToday(source.issueDate),
    validityDays: validityDays(source.validityDays),
    subtotal: 0,
    gstTotal: 0,
    grandTotal: 0,
    pendingCustomerCandidates: readCustomers(source.pendingCustomerCandidates),
    pendingProductCandidates: readProducts(source.pendingProductCandidates),
    pendingProductRequest: readProductRequest(source.pendingProductRequest),
  };
  recalculateDraft(draft);
  return draft;
}

function hydrateLine(value: unknown, catalog: ProformaProduct[]): ProformaDraftLine[] {
  if (!isRecord(value)) return [];
  const product = catalog.find((item) => item.id === integer(value.id));
  const quantity = positive(value.quantity);
  const unitPrice = nonNegative(value.unitPrice);
  if (!product || quantity === null || unitPrice === null || quantity > product.available) return [];
  return [makeLine(product, quantity, unitPrice)];
}

async function setCustomerFromQuery(draft: ProformaDraft, query: string, companyId: number): Promise<string> {
  const customers = await findCustomersByName(cleanCustomerQuery(query), companyId);
  if (customers.length === 1) {
    draft.customer = customers[0];
    draft.pendingCustomerCandidates = [];
    return `Customer set to ${customers[0].name}.`;
  }
  draft.pendingCustomerCandidates = customers;
  if (customers.length === 0) return 'I could not find that customer in Odoo. Please include a more specific name or location.';
  return 'I found multiple matching customers. Which one do you want?';
}

function addProductRequest(draft: ProformaDraft, request: ProductRequest, catalog: ProformaProduct[]): { message: string } {
  if (!request.query) return { message: 'Which product should I add?' };
  const products = findProductMatches(request.query, catalog);
  draft.pendingProductRequest = request;
  if (products.length === 0) {
    draft.pendingProductCandidates = [];
    return { message: `I could not find “${request.query}” in available Odoo products.` };
  }
  if (products.length > 1) {
    draft.pendingProductCandidates = products;
    return { message: 'I found multiple matching products. Which one do you want?' };
  }
  const product = catalog.find((item) => item.id === products[0].id)!;
  if (request.quantity === null) return { message: `How many units of ${product.name} should I add?` };
  const unitPrice = request.unitPrice ?? product.listPrice;
  if (unitPrice <= 0) return { message: `What unit price should I use for ${product.name}?` };
  if (request.quantity > product.available) {
    return { message: `Only ${product.available} units of ${product.name} are available in Odoo.` };
  }
  addLine(draft, product, request.quantity, unitPrice);
  draft.pendingProductCandidates = [];
  draft.pendingProductRequest = null;
  return { message: `Added ${product.name} to the PI draft.` };
}

function parseInitialRequest(query: string): { customerQuery: string | null; productRequest: ProductRequest | null } {
  const afterPi = query
    .replace(/^.*?\b(?:pi|proforma|pro-forma|invoice)\b\s*/i, '')
    .replace(/^for\s+/i, '');
  const productToCustomer = afterPi.match(/^(.+?)\s+to\s+(.+)$/i);
  if (productToCustomer) {
    const productRequest = parseProductRequest(productToCustomer[1].replace(/^for\s+/i, '').trim());
    if (productRequest.quantity === null && productRequest.unitPrice === null) {
      return { customerQuery: afterPi, productRequest: null };
    }
    return {
      customerQuery: productToCustomer[2].trim(),
      productRequest,
    };
  }
  const parts = afterPi.split(/\s+for\s+/i).map((value) => value.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { customerQuery: parts[0], productRequest: parseProductRequest(parts.slice(1).join(' for ')) };
  }
  const single = parts[0]?.replace(/^for\s+/i, '') ?? '';
  const split = single.match(/^(.+?),\s*(?=\d+(?:\.\d+)?\s+(?:qty|quantity|units?|pcs?|panels?|modules?))/i);
  if (split) {
    return { customerQuery: split[1], productRequest: parseProductRequest(single.slice(split[0].length)) };
  }
  return { customerQuery: single || null, productRequest: null };
}

function parseAddProductRequest(query: string): ProductRequest | null {
  if (!/\badd(?:\s+another)?(?:\s+(?:item|product|line))?\b/i.test(query)) return null;
  const value = query.replace(/^.*?\badd(?:\s+another)?(?:\s+(?:item|product|line))?\s*:?[\s]*/i, '');
  return parseProductRequest(value);
}

function parseProductRequest(value: string): ProductRequest {
  const normalized = value.trim().replace(/[.?!]+$/, '');
  const leading = normalized.match(/^(\d+(?:\.\d+)?)\s*(?:qty|quantity|units?|pcs?|panels?|modules?)?\s+(?:of\s+)?(.+?)\s+(?:(?:at|for|@)\s*)?(?:₹|rs\.?\s*)?([\d,]+(?:\.\d+)?)(?:\s*(k|thousand|rs\.?|rupees?))?$/i);
  if (leading) {
    return { query: leading[2].trim(), quantity: Number(leading[1]), unitPrice: money(leading[3], leading[4]) };
  }
  const trailing = normalized.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(?:qty|quantity|units?|pcs?|panels?|modules?)\s*(?:(?:at|for|@)\s*)?(?:₹|rs\.?\s*)?([\d,]+(?:\.\d+)?)(?:\s*(k|thousand|rs\.?|rupees?))?$/i);
  if (trailing) {
    return { query: trailing[1].trim(), quantity: Number(trailing[2]), unitPrice: money(trailing[3], trailing[4]) };
  }
  const quantityOnly = normalized.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(?:qty|quantity|units?|pcs?|panels?|modules?)$/i);
  if (quantityOnly) return { query: quantityOnly[1].trim(), quantity: Number(quantityOnly[2]), unitPrice: null };
  return { query: normalized, quantity: null, unitPrice: null };
}

function normalizePiLanguage(value: string): string {
  const localizedGeneration = /बनाओ|बनवा|तैयार\s+करो|तयार\s+करा|निर्माण\s+करो/i.test(value);
  let normalized = value
    .replace(/[०-९]/g, (digit) => String('०१२३४५६७८९'.indexOf(digit)))
    .replace(/एएफएम/gi, 'AFM')
    .replace(/वारी/gi, 'Waaree')
    .replace(/के\s+लिए|साठी/gi, 'for')
    .replace(/रुपये\s+में|रुपयांना|रुपयांत|रुपये/gi, '')
    .replace(/हज़ार|हजार/gi, 'thousand')
    .replace(/सोलह|सोळा/gi, '16')
    .replace(/क्वांटिटी|क्वान्टिटी|मात्रा|प्रमाण/gi, 'quantity')
    .replace(/बनाओ|बनवा|तैयार\s+करो|तयार\s+करा|निर्माण\s+करो/gi, '')
    .replace(/दो|दोन/gi, '2')
    .replace(/एक/gi, '1')
    .replace(/तीन/gi, '3')
    .replace(/चार/gi, '4')
    .replace(/पाँच|पाच/gi, '5')
    .replace(/छह|सहा/gi, '6')
    .replace(/सात/gi, '7')
    .replace(/आठ/gi, '8')
    .replace(/नौ|नऊ/gi, '9')
    .replace(/दस|दहा/gi, '10')
    .replace(/\s+(?:के|का|की|चे|चा|ची|में|मध्ये|ला)\s+/gi, ' ')
    .replace(/पहला|पहिली|पहिला/gi, 'option 1')
    .replace(/दूसरा|दुसरा|दुसरी/gi, 'option 2')
    .replace(/तीसरा|तिसरा/gi, 'option 3')
    .replace(/।+/g, ' ')
    .replace(/,\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return localizedGeneration ? `generate pi ${normalized}` : normalized;
}

function parseLineEdit(query: string): { quantity: number | null; unitPrice: number | null } | null {
  const quantity = query.match(/\b(?:quantity|qty)\b[^\d]{0,24}(\d+(?:\.\d+)?)/i)?.[1]
    ?? query.match(/\b(\d+(?:\.\d+)?)\s*(?:quantity|qty)\b/i)?.[1];
  const unitPrice = query.match(/\b(?:price|rate)\b[^\d₹]{0,32}(?:₹|rs\.?\s*)?([\d,]+(?:\.\d+)?)/i)?.[1];
  if (!quantity && !unitPrice) return null;
  return { quantity: quantity ? Number(quantity) : null, unitPrice: unitPrice ? money(unitPrice) : null };
}

function findEditedLine(lines: ProformaDraftLine[], query: string): ProformaDraftLine | null {
  const normalized = normalize(query);
  const index = query.match(/\b(?:line|item|product)\s*(\d+)\b/i)?.[1];
  if (index) return lines[Number(index) - 1] ?? null;
  const named = lines.filter((line) => normalize(line.name).split(' ').filter((token) => token.length > 2).some((token) => normalized.includes(token)));
  if (named.length === 1) return named[0];
  if (named.length > 1) return null;
  return lines[lines.length - 1] ?? null;
}

function customerSelection(query: string, candidates: CustomerLookupItem[]): CustomerLookupItem | null {
  if (candidates.length === 0) return null;
  const index = query.match(/\b(?:customer|option)\s*(\d+)\b/i)?.[1]
    ?? query.match(/\b(\d+)(?:st|nd|rd|th)?\s*(?:one|customer|option)\b/i)?.[1];
  if (index) return candidates[Number(index) - 1] ?? null;
  return /\b(?:this|correct)\s+(?:one|customer)\b/i.test(query) && candidates.length === 1 ? candidates[0] : null;
}

function productSelection(query: string, candidates: ProformaProductMatch[]): ProformaProductMatch | null {
  if (candidates.length === 0) return null;
  const index = query.match(/\b(?:product|item|option)\s*(\d+)\b/i)?.[1]
    ?? query.match(/\b(\d+)(?:st|nd|rd|th)?\s*(?:one|product|item|option)\b/i)?.[1];
  if (index) return candidates[Number(index) - 1] ?? null;
  return /\b(?:this|correct)\s+(?:one|product|item)\b/i.test(query) && candidates.length === 1 ? candidates[0] : null;
}

function findProductMatches(query: string, catalog: ProformaProduct[]): ProformaProductMatch[] {
  const terms = normalize(query).split(' ').filter((term) => term.length > 1 && !['solar', 'module', 'panel', 'product', 'item'].includes(term));
  if (terms.length === 0) return [];
  const matches = catalog
    .map((product) => ({ product, score: productScore(product, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.product.name.localeCompare(right.product.name));
  const bestScore = matches[0]?.score ?? 0;
  return matches
    .filter((item) => item.score === bestScore)
    .slice(0, 6)
    .map((item) => productMatch(item.product));
}

function productScore(product: ProformaProduct, terms: string[]): number {
  const value = normalize(`${product.sku ?? ''} ${product.name}`);
  const matches = terms.reduce((score, term) => score + (value.split(' ').includes(term) ? 100 : value.includes(term) ? 45 : 0), 0);
  return matches >= Math.min(terms.length, 2) * 45 ? matches : 0;
}

function addLine(draft: ProformaDraft, product: ProformaProduct, quantity: number, unitPrice: number): void {
  const existing = draft.lines.find((line) => line.id === product.id && line.unitPrice === unitPrice);
  if (existing) {
    existing.quantity += quantity;
    recalculateLine(existing);
  } else {
    draft.lines.push(makeLine(product, quantity, unitPrice));
  }
  recalculateDraft(draft);
}

function makeLine(product: ProformaProduct, quantity: number, unitPrice: number): ProformaDraftLine {
  const line: ProformaDraftLine = { ...productMatch(product), quantity, unitPrice, subtotal: 0, gstAmount: 0, total: 0 };
  recalculateLine(line);
  return line;
}

function productMatch(product: ProformaProduct): ProformaProductMatch {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    available: product.available,
    listPrice: product.listPrice,
    taxRate: product.taxRate,
    taxNames: product.taxNames,
  };
}

function recalculateDraft(draft: ProformaDraft): void {
  draft.lines.forEach(recalculateLine);
  draft.subtotal = round(draft.lines.reduce((sum, line) => sum + line.subtotal, 0));
  draft.gstTotal = round(draft.lines.reduce((sum, line) => sum + line.gstAmount, 0));
  draft.grandTotal = round(draft.subtotal + draft.gstTotal);
}

function recalculateLine(line: ProformaDraftLine): void {
  line.subtotal = round(line.quantity * line.unitPrice);
  line.gstAmount = round(line.subtotal * line.taxRate / 100);
  line.total = round(line.subtotal + line.gstAmount);
}

function chooseAction(draft: ProformaDraft): ProformaAssistantResponse['action'] {
  if (draft.pendingCustomerCandidates.length || draft.pendingProductCandidates.length) return 'needs_choice';
  if (!draft.customer) return 'needs_customer';
  if (draft.lines.length === 0) return 'needs_product';
  return 'preview';
}

function response(query: string, draft: ProformaDraft, assistantMessage: string, action: ProformaAssistantResponse['action']): ProformaAssistantResponse {
  recalculateDraft(draft);
  return { kind: 'proforma', query, assistantMessage, fetchedAt: new Date().toISOString(), action, draft };
}

function readCustomers(value: unknown): CustomerLookupItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => isRecord(item) && integer(item.id) && typeof item.name === 'string'
    ? [{ id: integer(item.id)!, name: item.name, gstNo: stringOrNull(item.gstNo), phone: stringOrNull(item.phone), address: stringOrNull(item.address) }]
    : []);
}

function readProducts(value: unknown): ProformaProductMatch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => isRecord(item) && integer(item.id) && typeof item.name === 'string'
    ? [{ id: integer(item.id)!, sku: stringOrNull(item.sku), name: item.name, available: nonNegative(item.available) ?? 0, listPrice: nonNegative(item.listPrice) ?? 0, taxRate: nonNegative(item.taxRate) ?? 0, taxNames: Array.isArray(item.taxNames) ? item.taxNames.filter((name): name is string => typeof name === 'string') : [] }]
    : []);
}

function readProductRequest(value: unknown): ProductRequest | null {
  if (!isRecord(value) || typeof value.query !== 'string') return null;
  return { query: value.query.slice(0, 200), quantity: positive(value.quantity), unitPrice: nonNegative(value.unitPrice) };
}

function cleanCustomerQuery(value: string): string {
  return value.replace(/^(?:for|to)\s+/i, '').replace(/[.?!]+$/, '').trim().slice(0, 200);
}

function dateOrToday(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

function validityDays(value: unknown): number {
  const days = integer(value);
  return days && days > 0 ? Math.min(days, 90) : 15;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function money(value: string, suffix?: string): number | null {
  const parsed = Number(value.replace(/,/g, ''));
  const multiplier = suffix?.toLowerCase() === 'k' || suffix?.toLowerCase() === 'thousand' ? 1000 : 1;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * multiplier : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
