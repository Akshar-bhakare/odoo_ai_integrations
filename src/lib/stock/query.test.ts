import { describe, expect, it } from 'vitest';
import {
  extractStockSearchTerms,
  matchStockRequestProducts,
  matchesStockQuery,
  normalizeStockText,
} from './query';
import type { AvailableStockItem } from './types';

describe('voice stock query', () => {
  it('treats a generic availability request as all available stock', () => {
    expect(extractStockSearchTerms('Show me all the available stock')).toEqual([]);
  });

  it('normalizes common solar vocabulary and spoken wattage', () => {
    expect(extractStockSearchTerms('Do we have Wari six fifteen D C R panels?')).toEqual([
      'waaree', '615', 'dcr', 'module',
    ]);
    expect(extractStockSearchTerms('Wari six fifteen watts D C R panels')).toEqual([
      'waaree', '615w', 'dcr', 'module',
    ]);
  });

  it('normalizes NDCR before DCR', () => {
    expect(normalizeStockText('N D C R')).toBe('ndcr');
  });

  it('does not interpret conversational homophones as numbers', () => {
    expect(extractStockSearchTerms('I want to check stock for Polycab')).toEqual(['polycab']);
  });

  it.each([
    'Give me the available stock of Polycab 5 kilowatt',
    'poly cab five kilo watts',
    'polly cap 5 k w inverter',
    'Polycab 5000 watts',
    'policab five thousand watt',
    'polycab 5kw single phase inverter one mppt',
  ])('understands Polycab 5 kW transcription: %s', (utterance) => {
    const product = {
      sku: 'Inv-20000230',
      name: 'Polycab 5 KW Single Phase Solar Inverter 1MPPT',
    };

    expect(matchesStockQuery(product, extractStockSearchTerms(utterance))).toBe(true);
  });

  it('keeps numeric ratings exact instead of matching number substrings', () => {
    const terms = extractStockSearchTerms('Polycab 5 kilowatt');
    expect(matchesStockQuery({
      sku: 'Inv-20000230',
      name: 'Polycab 5 KW Single Phase Solar Inverter 1MPPT',
    }, terms)).toBe(true);
    expect(matchesStockQuery({
      sku: 'Inv-20000231',
      name: 'Polycab 6 KW Single Phase Solar Inverter 1MPPT',
    }, terms)).toBe(false);
  });

  it('derives inverter capacity from common TL model names', () => {
    expect(matchesStockQuery({
      sku: 'Inv-20000125',
      name: 'Growatt MIN 5000TL-X2 (Pro) Solar Inverter',
    }, extractStockSearchTerms('grow watt five kilowatt'))).toBe(true);
    expect(matchesStockQuery({
      sku: 'Inv-20000132',
      name: 'Growatt MOD 10KTL3-X2(Pro) Solar Inverter',
    }, extractStockSearchTerms('Growatt ten kilowatt'))).toBe(true);
  });

  it('normalizes cable dimensions and speech-recognition spelling errors', () => {
    const product = {
      sku: 'Acc-30000014',
      name: 'POLYCAB Solar DC Cable 4mm² Black',
    };
    expect(matchesStockQuery(product, extractStockSearchTerms('polly cab four square mm cable black')))
      .toBe(true);
  });

  it('tolerates small non-numeric transcription errors', () => {
    const product = {
      sku: 'SM-10000514',
      name: 'Waaree 615Wp TopCon BF DCR Solar Module',
    };
    expect(matchesStockQuery(product, extractStockSearchTerms('waare 615 watt top con dcr module')))
      .toBe(true);
    expect(matchesStockQuery(product, extractStockSearchTerms('Waaree 615 DCR'))).toBe(true);
    expect(matchesStockQuery(product, ['waaree', '615w', 'ndcr'])).toBe(false);
  });

  it('matches every extracted term against the SKU and product name', () => {
    const product = {
      sku: 'SM-10000514',
      name: 'Waaree 615Wp TopCon BF DCR Solar Module',
    };
    expect(matchesStockQuery(product, ['waaree', '615w', 'dcr'])).toBe(true);
    expect(matchesStockQuery(product, ['waaree', '615w', 'ndcr'])).toBe(false);
  });

  it('matches spoken multi-product lists and coordinated variants', () => {
    const inventory = [
      stockItem(1, 'POLYCAB Solar DC Cable 4mm² Black'),
      stockItem(2, 'POLYCAB Solar DC Cable 4mm² Red'),
      stockItem(3, 'Earthing Kit (AF)'),
      stockItem(4, 'Growatt MIN 5000TL-X2 (Pro) Solar Inverter'),
    ];

    const result = matchStockRequestProducts(
      'Polycab solar DC cable 4 mm black and red, earthing kit and Growatt 5000 X2 Pro',
      inventory,
    );

    expect(result.map((product) => product.id)).toEqual([1, 2, 3, 4]);
  });
});

function stockItem(id: number, name: string): AvailableStockItem {
  return {
    id,
    sku: `SKU-${id}`,
    name,
    uom: 'Units',
    onHand: 10,
    reserved: 0,
    available: 10,
    incoming: 0,
    outgoing: 0,
    forecast: 10,
  };
}
