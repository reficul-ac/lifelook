import DecimalJs from 'decimal.js';
import type { Cents } from './model/plan';

/** Private clone: other packages cannot alter this engine's decimal precision. */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = DecimalJs;
export const MAX_CENTS = 99_999_999_999_999;
export class CalculationRangeError extends RangeError {
  readonly code = 'monetary-overflow' as const;
  constructor(message = 'monetary-overflow: The calculation exceeds the supported monetary range.') { super(message); this.name = 'CalculationRangeError'; }
}
export function assertMonetaryRange(value: Decimal): void {
  if (!value.isFinite() || value.abs().gt(MAX_CENTS)) throw new CalculationRangeError();
}
export function settleCents(value: Decimal): Cents {
  assertMonetaryRange(value);
  const rounded = value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  assertMonetaryRange(rounded);
  const cents = rounded.toNumber();
  if (!Number.isSafeInteger(cents)) throw new CalculationRangeError();
  return cents === 0 ? 0 : cents;
}
/** Settle rounded cumulative totals, distributing fractional remainders deterministically. */
export function settleSeries(values: readonly Decimal[]): readonly Cents[] {
  let cumulative = new Decimal(0);
  let settled = new Decimal(0);
  return values.map(value => {
    assertMonetaryRange(value);
    cumulative = cumulative.plus(value);
    assertMonetaryRange(cumulative);
    const next = new Decimal(settleCents(cumulative));
    const result = settleCents(next.minus(settled));
    settled = next;
    return result;
  });
}

