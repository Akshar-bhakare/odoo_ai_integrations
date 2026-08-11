import { describe, expect, it } from 'vitest';
import { extractCustomerSearchCity, extractCustomerSearchName, isCustomerLookupQuery } from './query';

describe('customer assistant query', () => {
  it.each([
    ['Find customer Adhiraj Urja Solar Solution', 'Adhiraj Urja Solar Solution'],
    ['Show me the customer named Bright Power Pvt Ltd with GST number and phone', 'Bright Power Pvt Ltd'],
    ['What is the GSTIN, phone number and address for Sun Solar Enterprises?', 'Sun Solar Enterprises'],
    ['customer ABC Energy', 'ABC Energy'],
    ['Give me customer details for North Star Renewables', 'North Star Renewables'],
    ['Find customer Bright Power Pvt Ltd and show GST, phone and address', 'Bright Power Pvt Ltd'],
    ['Give me information regarding Shri Engineering Sangli.', 'Shri Engineering Sangli'],
    ['Tell me about Shri Engineering Sangli', 'Shri Engineering Sangli'],
    ['Okay. Shri. नहीं, बोल दे, बोल दे. Give me information regarding Shri Engineering Sangli.', 'Shri Engineering Sangli'],
    ['**Okay. Give me information regarding Shri Engineering Sangli.** ## Give me information regarding Shri Engineering Sangli.', 'Shri Engineering Sangli'],
  ])('extracts the customer name from: %s', (query, expected) => {
    expect(isCustomerLookupQuery(query)).toBe(true);
    expect(extractCustomerSearchName(query)).toBe(expected);
  });

  it('does not route a stock request as a customer lookup', () => {
    expect(isCustomerLookupQuery('Show available stock for customer ABC Energy')).toBe(false);
    expect(isCustomerLookupQuery('Give me information regarding available Polycab stock')).toBe(false);
  });

  it.each([
    ['give me all customers from nashik', 'nashik'],
    ['Show customers in New Delhi with phone and address', 'New Delhi'],
    ['clients located at Pune', 'Pune'],
  ])('extracts a customer city filter from: %s', (query, expected) => {
    expect(isCustomerLookupQuery(query)).toBe(true);
    expect(extractCustomerSearchCity(query)).toBe(expected);
  });

  it('does not treat a named customer query as a city filter', () => {
    expect(extractCustomerSearchCity('Find customer Bright Power')).toBeNull();
  });
});
