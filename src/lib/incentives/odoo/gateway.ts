import { odooCall } from '../../odoo/client';

export interface SearchReadOptions {
  limit?: number;
  offset?: number;
  order?: string;
  context?: Record<string, unknown>;
}

export interface OdooGateway {
  searchCount(model: string, domain: unknown[]): Promise<number>;
  searchRead<T>(
    model: string,
    domain: unknown[],
    fields: string[],
    options?: SearchReadOptions,
  ): Promise<T[]>;
  searchReadAll<T>(
    model: string,
    domain: unknown[],
    fields: string[],
    options?: Omit<SearchReadOptions, 'limit' | 'offset'>,
  ): Promise<T[]>;
  create<T>(model: string, values: Record<string, unknown>[]): Promise<T>;
  write(model: string, ids: number[], values: Record<string, unknown>): Promise<boolean>;
  unlink(model: string, ids: number[]): Promise<boolean>;
}

const PAGE_SIZE = 500;

export const defaultOdooGateway: OdooGateway = {
  async searchCount(model: string, domain: unknown[]) {
    return odooCall<number>(model, 'search_count', { domain });
  },
  async searchRead<T>(
    model: string,
    domain: unknown[],
    fields: string[],
    options: SearchReadOptions = {},
  ) {
    return odooCall<T[]>(model, 'search_read', {
      domain,
      fields,
      ...options,
    });
  },

  async searchReadAll<T>(
    model: string,
    domain: unknown[],
    fields: string[],
    options: Omit<SearchReadOptions, 'limit' | 'offset'> = {},
  ) {
    const records: T[] = [];
    let offset = 0;
    while (true) {
      const page = await odooCall<T[]>(model, 'search_read', {
        domain,
        fields,
        ...options,
        limit: PAGE_SIZE,
        offset,
      });
      records.push(...page);
      if (page.length < PAGE_SIZE) {
        return records;
      }
      offset += PAGE_SIZE;
    }
  },

  async create<T>(model: string, values: Record<string, unknown>[]) {
    return odooCall<T>(model, 'create', { vals_list: values });
  },

  async write(model: string, ids: number[], values: Record<string, unknown>) {
    return odooCall<boolean>(model, 'write', { ids, vals: values });
  },

  async unlink(model: string, ids: number[]) {
    return odooCall<boolean>(model, 'unlink', { ids });
  },
};
