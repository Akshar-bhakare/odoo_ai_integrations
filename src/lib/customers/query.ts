const CUSTOMER_DETAILS_PATTERN = /\b(?:gst(?:in)?|phone|mobile|contact|address)\b/i;
const CUSTOMER_NOUN_PATTERN = /\b(?:customer|customers|client|clients)\b/i;
const LOOKUP_ACTION_PATTERN = /\b(?:find|search|look\s*up|lookup|show|get|give|details?|information|named?|called)\b/i;
const IMPLICIT_CUSTOMER_INFORMATION_PATTERNS = [
  /\b(?:information|details?)\s+(?:about|on|regarding|for)\s+/gi,
  /\btell(?:\s+me)?\s+about\s+/gi,
];

export function isCustomerLookupQuery(query: string): boolean {
  const value = query.trim();
  if (!value) return false;
  if (CUSTOMER_DETAILS_PATTERN.test(value)) return true;
  if (/\b(?:stock|inventory|sku|available|availability)\b/i.test(value)) return false;
  if (/^(?:customer|client)s?\b/i.test(value)) return true;
  if (lastImplicitCustomerName(value) !== null) return true;
  return CUSTOMER_NOUN_PATTERN.test(value) && LOOKUP_ACTION_PATTERN.test(value);
}

export function extractCustomerSearchCity(query: string): string | null {
  const normalized = query.replace(/\s+/g, ' ').trim();
  const match = normalized.match(
    /\b(?:customer|client)s?\s+(?:(?:located|based)\s+)?(?:from|in|at)\s+(.+)$/i,
  );
  if (!match?.[1]) return null;
  const city = cleanCustomerSearchTerm(match[1])
    .replace(/\s+(?:with|showing|including)\s+(?:gst(?:in)?|phone|contact|address)\b.*$/i, '')
    .trim();
  return city || null;
}

export function extractCustomerSearchName(query: string): string {
  const normalized = query.replace(/\s+/g, ' ').trim();
  const implicitInformationName = lastImplicitCustomerName(normalized);
  const afterCustomer = normalized.match(
    /\b(?:customer|client)s?(?:\s+(?:named?|called|by\s+name))?\s+(.+)$/i,
  )?.[1];
  const afterConnector = normalized.match(
    /\b(?:of|for)\s+(.+)$/i,
  )?.[1];
  const candidate = implicitInformationName
    ?? (afterCustomer && !/^(?:details?|information|contact)\b/i.test(afterCustomer)
      ? afterCustomer
      : afterConnector ?? afterCustomer ?? normalized);

  return cleanCustomerSearchTerm(candidate)
    .replace(/^(?:named?|called|by\s+name)\s+/i, '')
    .replace(/\s+(?:and\s+)?(?:show|include|return|display)(?:\s+me)?\s+(?:the\s+)?(?:gst(?:in)?|phone|mobile|contact|address)\b.*$/i, '')
    .replace(/\s+(?:and\s+)?(?:show|include|with|along\s+with)?\s*(?:the\s+)?(?:gst(?:in)?|gst\s+(?:number|no)|phone(?:\s+(?:number|no))?|mobile(?:\s+(?:number|no))?|contact(?:\s+details?)?|address)(?:\s+.*)?$/i, '')
    .replace(/^(?:please\s+)?(?:find|search(?:\s+for)?|look\s+up|lookup|show(?:\s+me)?|get|give\s+me)\s+/i, '')
    .replace(/^(?:the\s+)?(?:customer|client)s?(?:\s+(?:named?|called|by\s+name))?\s+/i, '')
    .trim()
    .slice(0, 200);
}

function cleanCustomerSearchTerm(value: string): string {
  return value
    .replace(/^[\s#*_`"'“”‘’]+|[\s#*_`"'“”‘’]+$/g, '')
    .replace(/[?.!,;:]+$/g, '')
    .replace(/[\s#*_`"'“”‘’]+$/g, '')
    .trim()
    .slice(0, 200);
}

function lastImplicitCustomerName(value: string): string | null {
  let lastMatchEnd = -1;
  for (const pattern of IMPLICIT_CUSTOMER_INFORMATION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const end = (match.index ?? 0) + match[0].length;
      if (end > lastMatchEnd) lastMatchEnd = end;
    }
  }
  return lastMatchEnd >= 0 ? value.slice(lastMatchEnd).trim() : null;
}
