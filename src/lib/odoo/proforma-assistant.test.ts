import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getProformaCompany: vi.fn(),
  getInStockProformaProducts: vi.fn(),
  findCustomersByName: vi.fn(),
  findCustomerById: vi.fn(),
}));

vi.mock('@/lib/odoo/proforma', () => ({
  getProformaCompany: mocks.getProformaCompany,
  getInStockProformaProducts: mocks.getInStockProformaProducts,
}));
vi.mock('@/lib/customers/service', () => ({
  findCustomersByName: mocks.findCustomersByName,
  findCustomerById: mocks.findCustomerById,
}));

import { isProformaAssistantRequest, resolveProformaAssistant } from './proforma-assistant';

const customer = {
  id: 44,
  name: 'Shrishakti Enterprise',
  gstNo: '27ABCDE1234F1Z5',
  phone: '0201234567',
  address: 'Nashik\nMaharashtra, 422001\nIndia',
};
const product = {
  id: 10,
  sku: 'SM-10000453',
  name: 'Waaree 535Wp PERC BF DCR Solar Module',
  category: 'Solar Modules',
  available: 100,
  listPrice: 15000,
  taxIds: [1],
  taxNames: ['GST 12%'],
  taxRate: 12,
};

describe('proforma assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recognises PI creation and edits only while a PI draft exists', () => {
    expect(isProformaAssistantRequest('generate a PI for ACME', null)).toBe(true);
    expect(isProformaAssistantRequest('एएफएम के लिए वारी 535 के दो क्वांटिटी, 16,000 रुपये में बनाओ।', null)).toBe(true);
    expect(isProformaAssistantRequest('change quantity to 8', null)).toBe(false);
    expect(isProformaAssistantRequest('change quantity to 8', {})).toBe(true);
  });

  it('builds an Odoo-grounded PI preview with product GST', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: '27SUNLECTRIC', address: 'Pune' });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomersByName.mockResolvedValue([customer]);

    const result = await resolveProformaAssistant({
      query: 'generate a pi for shrishakti enterprise for waaree 535 dcr 12 quantity at 16000',
      companyId: 7,
      draft: null,
    });

    expect(result.action).toBe('preview');
    expect(result.draft.customer).toEqual(customer);
    expect(result.draft.lines).toHaveLength(1);
    expect(result.draft.lines[0]).toMatchObject({ quantity: 12, unitPrice: 16000, taxRate: 12 });
    expect(result.draft.subtotal).toBe(192000);
    expect(result.draft.gstTotal).toBe(23040);
    expect(result.draft.grandTotal).toBe(215040);
  });

  it('parses quantity and price when the user says for instead of at', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: '27SUNLECTRIC', address: 'Pune' });
    mocks.getInStockProformaProducts.mockResolvedValue([product, { ...product, id: 11, sku: 'SM-10000509', name: 'Waaree 590Wp TopCon BF DCR Solar Module' }]);
    mocks.findCustomersByName.mockResolvedValue([{ ...customer, name: 'Afm Solar Mart India Pvt Ltd' }]);

    const result = await resolveProformaAssistant({
      query: 'generate a pi for afm solar mart for waaree 535 dcr 2 quantity for 16000 rs',
      companyId: 7,
      draft: null,
    });

    expect(result.action).toBe('preview');
    expect(result.draft.lines[0]).toMatchObject({ quantity: 2, unitPrice: 16000 });
  });

  it('supports product first requests with the customer introduced by to', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: '27SUNLECTRIC', address: 'Pune' });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomersByName.mockResolvedValue([{ ...customer, name: 'Afm Solar Mart India Pvt Ltd' }]);

    const result = await resolveProformaAssistant({
      query: 'generate pi for waaree 535 dcr 2 units 16000 rs to afm',
      companyId: 7,
      draft: null,
    });

    expect(result.action).toBe('preview');
    expect(result.draft.customer?.name).toBe('Afm Solar Mart India Pvt Ltd');
    expect(result.draft.lines[0]).toMatchObject({ quantity: 2, unitPrice: 16000 });
  });

  it('understands Hindi PI requests with Devanagari quantity and currency words', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: 'Pune' });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomersByName.mockResolvedValue([{ ...customer, name: 'AFM Solar Mart India Pvt Ltd' }]);

    const result = await resolveProformaAssistant({
      query: 'एएफएम के लिए वारी 535 के दो क्वांटिटी, 16,000 रुपये में बनाओ।',
      companyId: 7,
      draft: null,
    });

    expect(result.action).toBe('preview');
    expect(result.draft.customer?.name).toBe('AFM Solar Mart India Pvt Ltd');
    expect(result.draft.lines[0]).toMatchObject({ quantity: 2, unitPrice: 16000 });
  });

  it('understands mixed Marathi-English PI requests and shorthand thousands', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: 'Pune' });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomersByName.mockResolvedValue([{ ...customer, name: 'AFM Solar Mart India Pvt Ltd' }]);

    const result = await resolveProformaAssistant({
      query: 'AFM साठी Waaree 535 चे 2 panels 16k ला तयार करा',
      companyId: 7,
      draft: null,
    });

    expect(result.action).toBe('preview');
    expect(result.draft.lines[0]).toMatchObject({ quantity: 2, unitPrice: 16000 });
  });

  it('accepts natural-language second-choice replies', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: null });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomersByName.mockResolvedValue([customer, { ...customer, id: 45, name: 'AFM Solar Mart India Pvt Ltd' }]);
    mocks.findCustomerById.mockResolvedValue({ ...customer, id: 45, name: 'AFM Solar Mart India Pvt Ltd' });

    const choices = await resolveProformaAssistant({ query: 'generate PI for AFM', companyId: 7, draft: null });
    const selected = await resolveProformaAssistant({ query: 'दूसरा वाला', companyId: 7, draft: choices.draft });

    expect(selected.draft.customer?.id).toBe(45);
  });

  it('does not duplicate lines when a complete generation request is retried', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: null });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomersByName.mockResolvedValue([customer]);

    const result = await resolveProformaAssistant({
      query: 'generate PI for shrishakti for waaree 535 2 units 16000',
      companyId: 7,
      draft: { customer, lines: [{ id: 10, quantity: 2, unitPrice: 16000 }] },
    });

    expect(result.draft.lines).toHaveLength(1);
    expect(result.draft.lines[0]?.quantity).toBe(2);
  });

  it('does not split a customer name that contains the word to', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: 'Pune' });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomersByName.mockResolvedValue([customer]);

    const result = await resolveProformaAssistant({
      query: 'generate PI for A to Z Traders', companyId: 7, draft: null,
    });

    expect(mocks.findCustomersByName).toHaveBeenCalledWith('A to Z Traders', 7);
    expect(result.draft.customer).toEqual(customer);
  });

  it('understands shorthand prices and rejects edits beyond available stock', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: null });
    mocks.getInStockProformaProducts.mockResolvedValue([{ ...product, available: 5 }]);
    mocks.findCustomersByName.mockResolvedValue([customer]);
    const created = await resolveProformaAssistant({
      query: 'generate PI for shrishakti for waaree 535 2 units 16k', companyId: 7, draft: null,
    });
    expect(created.draft.lines[0]?.unitPrice).toBe(16000);

    const edited = await resolveProformaAssistant({
      query: 'change quantity to 8', companyId: 7, draft: created.draft,
    });
    expect(edited.draft.lines[0]?.quantity).toBe(2);
    expect(edited.assistantMessage).toContain('Only 5 units');
  });

  it('asks the user to choose when Odoo has multiple customer matches', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: null });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomersByName.mockResolvedValue([customer, { ...customer, id: 45, name: 'Shrishakti Enterprise LLP' }]);

    const result = await resolveProformaAssistant({
      query: 'generate a PI for shrishakti enterprise',
      companyId: 7,
      draft: null,
    });

    expect(result.action).toBe('needs_choice');
    expect(result.draft.pendingCustomerCandidates).toHaveLength(2);
  });

  it('updates the last line quantity and keeps GST totals current', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: null });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomerById.mockResolvedValue(customer);

    const result = await resolveProformaAssistant({
      query: 'change quantity to 8',
      companyId: 7,
      draft: { customer, lines: [{ id: 10, quantity: 2, unitPrice: 16000 }] },
    });

    expect(result.draft.lines[0]?.quantity).toBe(8);
    expect(result.draft.gstTotal).toBe(15360);
  });

  it('understands natural language price updates and removes the current item', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: null });
    mocks.getInStockProformaProducts.mockResolvedValue([product]);
    mocks.findCustomerById.mockResolvedValue(customer);
    const draft = { customer, lines: [{ id: 10, quantity: 2, unitPrice: 16000 }] };

    const repriced = await resolveProformaAssistant({
      query: 'set price for this item to 17000', companyId: 7, draft,
    });
    expect(repriced.draft.lines[0]?.unitPrice).toBe(17000);

    const removed = await resolveProformaAssistant({
      query: 'remove this item', companyId: 7, draft: repriced.draft,
    });
    expect(removed.draft.lines).toHaveLength(0);
  });

  it('asks which line to edit when a product name matches multiple lines', async () => {
    mocks.getProformaCompany.mockResolvedValue({ id: 7, name: 'Sunlectric', gstNo: null, address: null });
    mocks.getInStockProformaProducts.mockResolvedValue([
      product,
      { ...product, id: 11, name: 'Waaree 590Wp TopCon BF DCR Solar Module' },
    ]);
    mocks.findCustomerById.mockResolvedValue(customer);

    const result = await resolveProformaAssistant({
      query: 'change price for Waaree to 17000',
      companyId: 7,
      draft: { customer, lines: [{ id: 10, quantity: 2, unitPrice: 16000 }, { id: 11, quantity: 2, unitPrice: 16000 }] },
    });

    expect(result.assistantMessage).toBe('Which product line should I update?');
  });
});
