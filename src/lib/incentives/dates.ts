import type { CalendarMonth, IsoDate } from './types';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

export function assertCalendarMonth(value: string): asserts value is CalendarMonth {
  if (!MONTH_PATTERN.test(value)) {
    throw new Error(`Invalid calendar month: ${value}`);
  }
}

export function assertIsoDate(value: string): asserts value is IsoDate {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
}

export function monthStart(month: CalendarMonth): IsoDate {
  assertCalendarMonth(month);
  return `${month}-01`;
}

export function monthOf(date: IsoDate): CalendarMonth {
  assertIsoDate(date);
  return date.slice(0, 7);
}

export function nextMonth(month: CalendarMonth): CalendarMonth {
  assertCalendarMonth(month);
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonthNumber = monthNumber === 12 ? 1 : monthNumber + 1;
  return `${nextYear}-${String(nextMonthNumber).padStart(2, '0')}`;
}

export function daysBetween(start: IsoDate, end: IsoDate): number {
  assertIsoDate(start);
  assertIsoDate(end);
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  return Math.round((endTime - startTime) / 86_400_000);
}
