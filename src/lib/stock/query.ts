import type { AvailableStockItem } from './types';
import { MAX_STOCK_REQUEST_ITEMS } from './limits';

const STOP_WORDS = new Set([
  'a', 'all', 'also', 'and', 'any', 'available', 'availability', 'can', 'check', 'could',
  'current', 'do', 'fetch', 'find', 'for', 'get', 'give', 'have', 'how', 'i',
  'in', 'inventory', 'is', 'item', 'items', 'live', 'looking', 'me', 'much',
  'need', 'of', 'only', 'or', 'please', 'plus', 'product', 'products', 'quantity', 'quantities',
  'show', 'some', 'stock', 'tell', 'the', 'to', 'today', 'too', 'units', 'want',
  'we', 'what', 'with', 'you',
]);

const CONCEPT_START = '(?:polycab|poly\\s+cab|growatt|grow\\s+watt|waaree|renew|premier|earthing|acdb|dcdb|inverter|solar\\s+module|module|cable)';
const VARIANT_GROUPS = [
  new Set(['black', 'red', 'blue', 'green', 'white', 'yellow']),
];

// Put more specific phrases before their shorter forms. These aliases cover
// vocabulary that speech recognizers commonly split, respell, or expand.
const PHRASE_ALIASES: Array<[RegExp, string]> = [
  [/\bn\s*d\s*c\s*r\b/gi, 'ndcr'],
  [/\bd\s*c\s*r\b/gi, 'dcr'],
  [/\ba\s*c\s*d\s*b\b/gi, 'acdb'],
  [/\bd\s*c\s*d\s*b\b/gi, 'dcdb'],
  [/\bm\s*p\s*p\s*t\b/gi, 'mppt'],
  [/\bp\s*e\s*r\s*c\b/gi, 'perc'],
  [/\btop\s*con\b/gi, 'topcon'],
  [/\b(?:wari|waree|waari|warree|wheree|waaree)\b/gi, 'waaree'],
  [/\b(?:poly|polly|poli|polee)\s*(?:cab|cap)\b/gi, 'polycab'],
  [/\b(?:grow\s*watt|growat|growatt)\b/gi, 'growatt'],
  [/\bsolar\s+panels?\b/gi, 'solar module'],
  [/\bpanels?\b/gi, 'module'],
  [/\binvertors?\b/gi, 'inverter'],
  [/\bsix\s+fifteen\b/gi, '615'],
  [/\bsix\s+fifty\b/gi, '650'],
  [/\bsix\s+hundred\b/gi, '600'],
  [/\bfive\s+ninety\b/gi, '590'],
  [/\bfive\s+fifty\b/gi, '550'],
  [/\bfive\s+thirty[ -]?five\b/gi, '535'],
  [/\b(?:single|one|1)\s*[- ]?phase\b/gi, '1ph'],
  [/\b(?:three|3)\s*[- ]?phase\b/gi, '3ph'],
];

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

export function normalizeStockText(value: string): string {
  let normalized = value.toLowerCase().replaceAll('²', '2');
  for (const [pattern, replacement] of PHRASE_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (number) => number.replaceAll(',', ''));
  normalized = normalized
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  normalized = normalizeSpokenNumbers(normalized);
  normalized = normalizeMeasurements(normalized);

  return normalized
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function extractStockSearchTerms(utterance: string): string[] {
  const normalized = normalizeStockText(utterance);
  if (!normalized) return [];

  const terms = normalized
    .split(' ')
    .filter((term) => term && !STOP_WORDS.has(term))
    .map(singularize);

  return [...new Set(terms)];
}

export function matchesStockQuery(
  product: { name: string; sku: string | null },
  terms: string[],
): boolean {
  if (terms.length === 0) return true;
  const productTerms = normalizeStockText(`${product.sku ?? ''} ${product.name}`)
    .split(' ')
    .map(singularize);

  return terms.every((term) => productTerms.some((candidate) => similarStockTerm(term, candidate)));
}

export function splitStockRequests(query: string): string[] {
  const separated = query
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*[-*•]+\s*/gm, '')
    .replace(new RegExp(`\\s+(?:and|also|plus)\\s+(?=${CONCEPT_START}\\b)`, 'gi'), '\n')
    .replace(new RegExp(`,\\s*(?=${CONCEPT_START}\\b)`, 'gi'), '\n');
  const requests = separated
    .split(/[;\n]+/)
    .map((part) => part.trim().replace(/^\d+[.)]\s*/, ''))
    .filter(Boolean);
  return (requests.length > 0 ? requests : [query.trim()]).slice(0, MAX_STOCK_REQUEST_ITEMS);
}

export function matchStockRequestProducts(
  query: string,
  inventory: AvailableStockItem[],
): AvailableStockItem[] {
  const matches = splitStockRequests(query).flatMap((requested) => (
    matchSingleStockRequest(requested, inventory)
  ));
  return [...new Map(matches.map((product) => [product.id, product])).values()];
}

function matchSingleStockRequest(
  requested: string,
  inventory: AvailableStockItem[],
): AvailableStockItem[] {
  const terms = extractStockSearchTerms(requested);
  if (terms.length === 0) return inventory;
  const direct = inventory.filter((product) => matchesStockQuery(product, terms));
  if (direct.length > 0) return direct;

  for (const variants of VARIANT_GROUPS) {
    const requestedVariants = terms.filter((term) => variants.has(term));
    if (requestedVariants.length < 2) continue;
    const baseTerms = terms.filter((term) => !variants.has(term));
    const variantMatches = requestedVariants.flatMap((variant) => (
      inventory.filter((product) => matchesStockQuery(product, [...baseTerms, variant]))
    ));
    if (variantMatches.length > 0) {
      return [...new Map(variantMatches.map((product) => [product.id, product])).values()];
    }
  }
  return [];
}

function normalizeMeasurements(value: string): string {
  return value
    // Model names such as 5000TL-X2 and 10KTL3 encode inverter wattage.
    .replace(/\b(\d{4,5})(?=tl\d*\b)/g, (_, amount: string) => (
      `${amount}w ${formatNumber(Number(amount) / 1000)}kw ${amount}`
    ))
    .replace(/\b(\d+(?:\.\d+)?)\s*k(?=tl\d*\b)/g, (_, amount: string) => (
      `${formatNumber(Number(amount) * 1000)}w ${amount}kw ${amount}k`
    ))
    .replace(
      /\b(\d+(?:\.\d+)?)\s*(?:kilo\s*watts?|kilowatts?|k\s*w|kw)\b/g,
      (_, amount: string) => `${formatNumber(Number(amount) * 1000)}w ${amount}kw`,
    )
    .replace(
      /\b(\d+(?:\.\d+)?)\s*(?:watt\s*peaks?|watts?|w\s*p|wp|w)\b/g,
      (_, amount: string) => `${formatNumber(Number(amount))}w`,
    )
    .replace(
      /\b(\d+(?:\.\d+)?)\s*(?:square\s*(?:millimet(?:er|re)s?|mm)|sq\s*mm|sqmm|mm2|mm)\b/g,
      (_, amount: string) => `${formatNumber(Number(amount))}mm2`,
    )
    .replace(/\b(\d+)\s*mppt\b/g, '$1mppt');
}

function normalizeSpokenNumbers(value: string): string {
  const tokens = value.split(' ');
  const output: string[] = [];

  for (let index = 0; index < tokens.length;) {
    const parsed = parseNumberWords(tokens, index);
    if (!parsed) {
      output.push(tokens[index]);
      index += 1;
      continue;
    }
    output.push(parsed.value);
    index = parsed.nextIndex;
  }

  return output.join(' ');
}

function parseNumberWords(
  tokens: string[],
  startIndex: number,
): { value: string; nextIndex: number } | null {
  let current = 0;
  let total = 0;
  let index = startIndex;
  let sawNumber = false;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token in SMALL_NUMBERS) {
      current += SMALL_NUMBERS[token];
      sawNumber = true;
    } else if (token in TENS) {
      current += TENS[token];
      sawNumber = true;
    } else if (token === 'hundred' && sawNumber) {
      current = Math.max(1, current) * 100;
    } else if (token === 'thousand' && sawNumber) {
      total += Math.max(1, current) * 1000;
      current = 0;
    } else if (token === 'and' && sawNumber && isNumberWord(tokens[index + 1])) {
      index += 1;
      continue;
    } else if (token === 'point' && sawNumber) {
      const decimalDigits: string[] = [];
      let decimalIndex = index + 1;
      while (decimalIndex < tokens.length && tokens[decimalIndex] in SMALL_NUMBERS) {
        const digit = SMALL_NUMBERS[tokens[decimalIndex]];
        if (digit > 9) break;
        decimalDigits.push(String(digit));
        decimalIndex += 1;
      }
      if (decimalDigits.length > 0) {
        return {
          value: `${total + current}.${decimalDigits.join('')}`,
          nextIndex: decimalIndex,
        };
      }
      break;
    } else {
      break;
    }
    index += 1;
  }

  return sawNumber ? { value: String(total + current), nextIndex: index } : null;
}

function isNumberWord(token: string | undefined): boolean {
  return Boolean(token && (token in SMALL_NUMBERS || token in TENS || token === 'hundred'));
}

function similarStockTerm(term: string, candidate: string): boolean {
  if (term === candidate) return true;
  if (/^\d+(?:\.\d+)?$/.test(term)) {
    return candidate.startsWith(term)
      && /^(?:kw|w|mm2|mppt|tl\d*)$/.test(candidate.slice(term.length));
  }
  if (/\d/.test(term) || /\d/.test(candidate)) return false;
  if (term.length < 4 || candidate.length < 4) return false;

  const longest = Math.max(term.length, candidate.length);
  const maximumDistance = longest >= 8 ? 2 : 1;
  return levenshteinDistance(term, candidate, maximumDistance) <= maximumDistance;
}

function levenshteinDistance(left: string, right: string, cutoff: number): number {
  if (Math.abs(left.length - right.length) > cutoff) return cutoff + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
      rowMinimum = Math.min(rowMinimum, current[rightIndex]);
    }
    if (rowMinimum > cutoff) return cutoff + 1;
    previous = current;
  }

  return previous[right.length];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function singularize(term: string): string {
  if (term.length > 4 && term.endsWith('s') && !term.endsWith('ss')) {
    return term.slice(0, -1);
  }
  return term;
}
