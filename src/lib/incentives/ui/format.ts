import type { Many2one } from './types';

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
}

export function date(value: string | false | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function monthLabel(value: string): string {
  const normalized = value.slice(0, 7);
  const parsed = new Date(`${normalized}-01T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? normalized
    : parsed.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function relationName(value: Many2one | undefined, fallback = '—'): string {
  return value === false || value === undefined ? fallback : value[1];
}

export function relationId(value: Many2one | undefined): number | null {
  return value === false || value === undefined ? null : value[0];
}
