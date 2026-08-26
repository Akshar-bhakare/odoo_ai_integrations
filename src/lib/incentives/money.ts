import type { Money } from './types';

export function roundMoney(value: number): Money {
  if (!Number.isFinite(value)) {
    throw new Error(`Money value must be finite; received ${value}`);
  }

  const absoluteRounded = Math.round((Math.abs(value) + Number.EPSILON) * 100);
  return (value < 0 ? -absoluteRounded : absoluteRounded) / 100;
}

export function sumMoney(values: number[]): Money {
  return roundMoney(values.reduce((total, value) => total + value, 0));
}

export function percentageOf(base: Money, rate: number): Money {
  return roundMoney(base * rate);
}
