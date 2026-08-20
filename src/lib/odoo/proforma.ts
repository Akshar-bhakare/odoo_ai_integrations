import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import { odooFetch } from './client';

interface Many2one {
  0: number;
  1: string;
}

type Relation = false | Many2one;

interface CompanyRecord {
  id: number;
  name: string;
  street: string | false;
  street2: string | false;
  city: string | false;
  zip: string | false;
  state_id: Relation;
  country_id: Relation;
  vat: string | false;
}

interface PartnerRecord extends CompanyRecord {
  customer_rank: number;
  phone: string | false;
}

interface ProductRecord {
  id: number;
  display_name: string;
  default_code: string | false;
  qty_available: number;
  list_price: number;
  categ_id: Relation;
  taxes_id: number[];
}

interface TaxRecord {
  id: number;
  name: string;
  amount: number;
}

export interface ProformaProduct {
  id: number;
  sku: string | null;
  name: string;
  category: string | null;
  available: number;
  listPrice: number;
  taxIds: number[];
  taxNames: string[];
  taxRate: number;
}

export interface ProformaCompany {
  id: number;
  name: string;
  gstNo: string | null;
  address: string | null;
}

export interface ProformaLineInput {
  productId: number;
  quantity: number;
  unitPrice: number;
}

interface ResolvedLine extends ProformaProduct {
  quantity: number;
  unitPrice: number;
  subtotal: number;
  taxAmount: number;
}

const PRODUCT_FIELDS = ['id', 'display_name', 'default_code', 'qty_available', 'list_price', 'categ_id', 'taxes_id'];
const COMPANY_FIELDS = ['id', 'name', 'street', 'street2', 'city', 'zip', 'state_id', 'country_id', 'vat'];

export async function getInStockProformaProducts(): Promise<ProformaProduct[]> {
  const records = await odooFetch<ProductRecord[]>(
    'product.product',
    'search_read',
    [['active', '=', true], ['qty_available', '>', 0]],
    PRODUCT_FIELDS,
    { order: 'default_code,id', limit: 5000 },
  );
  return resolveProducts(records);
}

export async function createProformaPdf(params: {
  companyId: number;
  customerSearch?: string;
  customerId?: number;
  lines: ProformaLineInput[];
  issueDate?: string;
  validityDays?: number;
}): Promise<{ bytes: Uint8Array; fileName: string }> {
  const [company, customer, products] = await Promise.all([
    fetchCompany(params.companyId),
    findCustomer(params.customerSearch ?? '', params.companyId, params.customerId),
    fetchProducts(params.lines.map((line) => line.productId)),
  ]);
  if (!customer) throw new Error('The selected customer was not found in Odoo.');
  const lines = resolveLines(products, params.lines);
  if (lines.length === 0) throw new Error('Add at least one valid product line.');
  const issueDate = validDate(params.issueDate) ? params.issueDate! : today();
  const validityDays = Number.isInteger(params.validityDays) && params.validityDays! > 0
    ? Math.min(params.validityDays!, 90)
    : 15;
  const expiryDate = addDays(issueDate, validityDays);
  const bytes = await renderPdf({ company, customer, lines, issueDate, expiryDate });
  const fileName = `proforma-${customer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'invoice'}.pdf`;
  return { bytes, fileName };
}

async function fetchCompany(companyId: number): Promise<CompanyRecord> {
  const records = await odooFetch<CompanyRecord[]>('res.company', 'search_read', [['id', '=', companyId]], COMPANY_FIELDS);
  if (!records[0]) throw new Error('The current Odoo company could not be loaded.');
  return records[0];
}

export async function getProformaCompany(companyId: number): Promise<ProformaCompany> {
  const company = await fetchCompany(companyId);
  return {
    id: company.id,
    name: company.name,
    gstNo: company.vat || null,
    address: formatAddress(company) || null,
  };
}

async function findCustomer(search: string, companyId: number, customerId?: number): Promise<PartnerRecord | null> {
  const term = search.trim();
  if (!Number.isInteger(customerId) && !term) return null;
  const records = await odooFetch<PartnerRecord[]>(
    'res.partner',
    'search_read',
    [
      ['active', '=', true],
      ['customer_rank', '>', 0],
      ['company_id', 'in', [false, companyId]],
      Number.isInteger(customerId) ? ['id', '=', customerId] : ['name', 'ilike', term],
    ],
    COMPANY_FIELDS.concat(['customer_rank', 'phone']),
    { limit: 1, order: 'name,id' },
  );
  return records[0] ?? null;
}

async function fetchProducts(ids: number[]): Promise<ProformaProduct[]> {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return [];
  const records = await odooFetch<ProductRecord[]>(
    'product.product',
    'search_read',
    [['active', '=', true], ['qty_available', '>', 0], ['id', 'in', uniqueIds]],
    PRODUCT_FIELDS,
  );
  return resolveProducts(records);
}

async function resolveProducts(records: ProductRecord[]): Promise<ProformaProduct[]> {
  const taxIds = [...new Set(records.flatMap((record) => record.taxes_id ?? []))];
  const taxes = taxIds.length === 0
    ? []
    : await odooFetch<TaxRecord[]>('account.tax', 'search_read', [['id', 'in', taxIds]], ['id', 'name', 'amount']);
  const taxesById = new Map(taxes.map((tax) => [tax.id, tax]));
  return records.map((record) => {
    const productTaxes = (record.taxes_id ?? []).map((id) => taxesById.get(id)).filter((tax): tax is TaxRecord => Boolean(tax));
    return {
      id: record.id,
      sku: record.default_code || null,
      name: stripSku(record.display_name),
      category: relationName(record.categ_id),
      available: record.qty_available,
      listPrice: finitePositive(record.list_price),
      taxIds: productTaxes.map((tax) => tax.id),
      taxNames: productTaxes.map((tax) => tax.name),
      taxRate: productTaxes.reduce((sum, tax) => sum + tax.amount, 0),
    };
  });
}

function resolveLines(products: ProformaProduct[], inputs: ProformaLineInput[]): ResolvedLine[] {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return inputs.map((input) => {
    const product = productsById.get(input.productId);
    const quantity = finitePositive(input.quantity);
    const unitPrice = finitePositive(input.unitPrice);
    if (!product || quantity <= 0 || unitPrice < 0 || quantity > product.available) return null;
    const subtotal = roundMoney(quantity * unitPrice);
    return { ...product, quantity, unitPrice, subtotal, taxAmount: roundMoney(subtotal * product.taxRate / 100) };
  }).filter((line): line is ResolvedLine => Boolean(line));
}

async function renderPdf(params: {
  company: CompanyRecord;
  customer: PartnerRecord;
  lines: ResolvedLine[];
  issueDate: string;
  expiryDate: string;
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([595.28, 841.89]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = page.getWidth();
  const navy = rgb(0.04, 0.16, 0.28);
  const orange = rgb(0.95, 0.53, 0.08);
  const muted = rgb(0.35, 0.4, 0.45);
  const right = pageWidth - 44;
  let y = 790;

  try {
    const logo = await fs.readFile(path.join(process.cwd(), 'public', 'WhatsApp Image 2026-08-01 at 1.15.58 PM.jpeg'));
    const image = await document.embedJpg(logo);
    page.drawImage(image, { x: 44, y: 756, width: 120, height: 36 });
  } catch {
    page.drawText(params.company.name, { x: 44, y: 770, size: 16, font: bold, color: navy });
  }
  page.drawText('PROFORMA INVOICE', { x: 380, y: 774, size: 18, font: bold, color: navy });
  page.drawLine({ start: { x: 44, y: 744 }, end: { x: right, y: 744 }, thickness: 2, color: orange });
  y = 720;
  drawLabelValue(page, 'PI No.', `PI-${params.issueDate.replace(/-/g, '')}`, 44, y, regular, bold, muted, navy);
  drawLabelValue(page, 'Issue Date', formatDate(params.issueDate), 220, y, regular, bold, muted, navy);
  drawLabelValue(page, 'Valid Until', formatDate(params.expiryDate), 400, y, regular, bold, muted, navy);
  y -= 54;
  page.drawText('FROM', { x: 44, y, size: 8, font: bold, color: orange });
  page.drawText('BILL TO', { x: 315, y, size: 8, font: bold, color: orange });
  drawAddress(page, params.company, 44, y - 18, regular, bold, navy, muted);
  drawAddress(page, params.customer, 315, y - 18, regular, bold, navy, muted);
  y -= 128;
  const columns = [44, 66, 198, 238, 292, 330, 390, 455];
  page.drawRectangle({ x: 44, y: y - 8, width: right - 44, height: 24, color: navy });
  ['#', 'PRODUCT / SKU', 'QTY', 'UNIT PRICE', 'GST %', 'SUBTOTAL', 'GST AMT', 'TOTAL'].forEach((label, index) => {
    page.drawText(label, { x: columns[index], y, size: 8, font: bold, color: rgb(1, 1, 1) });
  });
  y -= 30;
  params.lines.forEach((line, index) => {
    if (index % 2 === 0) page.drawRectangle({ x: 44, y: y - 8, width: right - 44, height: 30, color: rgb(0.96, 0.97, 0.98) });
    page.drawText(String(index + 1), { x: columns[0], y, size: 8, font: regular, color: muted });
    page.drawText(trimText(`${line.name}${line.sku ? ` (${line.sku})` : ''}`, 23), { x: columns[1], y, size: 7, font: regular, color: navy });
    page.drawText(formatNumber(line.quantity), { x: columns[2], y, size: 8, font: regular, color: navy });
    page.drawText(formatMoney(line.unitPrice), { x: columns[3], y, size: 8, font: regular, color: navy });
    page.drawText(`${line.taxRate}%`, { x: columns[4], y, size: 7, font: regular, color: navy });
    page.drawText(formatMoney(line.subtotal), { x: columns[5], y, size: 7, font: regular, color: navy });
    page.drawText(formatMoney(line.taxAmount), { x: columns[6], y, size: 7, font: regular, color: navy });
    page.drawText(formatMoney(line.subtotal + line.taxAmount), { x: columns[7], y, size: 7, font: regular, color: navy });
    y -= 30;
  });
  page.drawLine({ start: { x: 44, y: y + 10 }, end: { x: right, y: y + 10 }, thickness: 0.6, color: rgb(0.8, 0.83, 0.85) });
  const subtotal = params.lines.reduce((sum, line) => sum + line.subtotal, 0);
  const tax = params.lines.reduce((sum, line) => sum + line.taxAmount, 0);
  const total = subtotal + tax;
  const summaryY = y - 20;
  drawLabelValue(page, 'Subtotal', formatMoney(subtotal), 390, summaryY, regular, bold, muted, navy);
  drawLabelValue(page, 'GST', formatMoney(tax), 390, summaryY - 22, regular, bold, muted, navy);
  page.drawRectangle({ x: 380, y: summaryY - 58, width: right - 380, height: 28, color: orange });
  page.drawText('TOTAL', { x: 394, y: summaryY - 48, size: 10, font: bold, color: rgb(1, 1, 1) });
  page.drawText(formatMoney(total), { x: 480, y: summaryY - 48, size: 10, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Terms and Conditions', { x: 44, y: 210, size: 10, font: bold, color: navy });
  page.drawText(`This proforma invoice is valid until ${formatDate(params.expiryDate)}. Prices and taxes are based on current Odoo product configuration.`, { x: 44, y: 192, size: 8, font: regular, color: muted, maxWidth: 330 });
  page.drawText('For Sunlectric', { x: 430, y: 150, size: 9, font: bold, color: navy });
  page.drawText('Authorized Signatory', { x: 430, y: 105, size: 8, font: regular, color: muted });
  page.drawLine({ start: { x: 44, y: 62 }, end: { x: right, y: 62 }, thickness: 1, color: orange });
  page.drawText('Thank you for your business', { x: 44, y: 44, size: 8, font: regular, color: muted });
  return document.save();
}

function drawAddress(page: PDFPage, record: CompanyRecord, x: number, y: number, regular: PDFFont, bold: PDFFont, color: ReturnType<typeof rgb>, muted: ReturnType<typeof rgb>) {
  page.drawText(record.name, { x, y, size: 10, font: bold, color });
  const phone = 'phone' in record && typeof record.phone === 'string' ? record.phone : null;
  const lines = [formatAddress(record), record.vat ? `GSTIN: ${record.vat}` : null, phone ? `Phone: ${phone}` : null].filter((line): line is string => Boolean(line));
  lines.forEach((line, index) => page.drawText(trimText(line, 48), { x, y: y - 15 - index * 13, size: 8, font: regular, color: muted }));
}

function drawLabelValue(page: PDFPage, label: string, value: string, x: number, y: number, regular: PDFFont, bold: PDFFont, muted: ReturnType<typeof rgb>, color: ReturnType<typeof rgb>) {
  page.drawText(label, { x, y, size: 7, font: regular, color: muted });
  page.drawText(value, { x, y: y - 13, size: 9, font: bold, color });
}

function formatAddress(record: CompanyRecord): string {
  return [record.street, record.street2, record.city, relationName(record.state_id), record.zip, relationName(record.country_id)]
    .filter((value): value is string => Boolean(value))
    .join(', ');
}

function relationName(value: Relation): string | null {
  return value === false ? null : value[1];
}

function stripSku(value: string): string {
  return value.replace(/^\[[^\]]+\]\s*/, '').trim();
}

function finitePositive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validDate(value: string | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value);
}

function trimText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
