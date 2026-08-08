export class OdooConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OdooConfigurationError';
  }
}

export class OdooApiError extends Error {
  code?: number;
  data?: unknown;

  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = 'OdooApiError';
    this.code = code;
    this.data = data;
  }
}

export function getOdooConfig() {
  const url = process.env.ODOO_URL;
  const apiKey = process.env.ODOO_API_KEY;

  if (!url || !apiKey) {
    const missing: string[] = [];
    if (!url) missing.push('ODOO_URL');
    if (!apiKey) missing.push('ODOO_API_KEY');
    throw new OdooConfigurationError(
      `Odoo credentials are not configured. Please define ${missing.join(' and ')} in your environment or .env.local file.`
    );
  }

  // Standardize URL
  const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  const finalBaseUrl = cleanUrl.includes('/json/2') ? cleanUrl : `${cleanUrl}/json/2`;

  return {
    baseUrl: finalBaseUrl,
    apiKey,
  };
}

export async function odooFetch<T>(
  model: string,
  method: string,
  domain: unknown[],
  fields: string[],
  extraParams: Record<string, unknown> = {}
): Promise<T> {
  return odooCall<T>(model, method, {
    domain,
    fields,
    ...extraParams,
  });
}

export async function odooCall<T>(
  model: string,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { baseUrl, apiKey } = getOdooConfig();
  const url = `${baseUrl}/${model}/${method}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      cache: 'no-store', // Always get fresh ERP data
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 429) {
        throw new OdooApiError(
          'Odoo is temporarily rate-limiting requests. Please wait a few minutes and try again.',
          429,
        );
      }
      throw new OdooApiError(
        `Odoo API returned HTTP ${response.status}: ${text}`,
        response.status
      );
    }

    const json: unknown = await response.json();

    if (isRecord(json) && isRecord(json.error)) {
      const errorMsg = typeof json.error.message === 'string'
        ? json.error.message
        : 'Unknown Odoo error';
      throw new OdooApiError(
        errorMsg,
        typeof json.error.code === 'number' ? json.error.code : undefined,
        json.error.data
      );
    }

    // In JSON-2 API, the return can be wrapped inside a standard JSON-RPC result block or direct.
    // Let's handle both cases.
    if (isRecord(json) && 'result' in json) {
      return json.result as T;
    }

    return json as T;
  } catch (error: unknown) {
    if (error instanceof OdooConfigurationError || error instanceof OdooApiError) {
      throw error;
    }
    throw new OdooApiError(
      `Failed to connect to Odoo server: ${errorMessage(error)}`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
