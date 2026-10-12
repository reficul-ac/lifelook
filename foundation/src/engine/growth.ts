import type { BasisPoints, Cents, Property } from './model/plan';
import { Decimal, assertMonetaryRange, settleCents } from './money';

/** Internal calculation record: closingExact must never enter JSON reporting. */
export interface GrowthMonth {
  readonly closingExact: Decimal;
  readonly openingCents: Cents;
  readonly depositsCents: Cents;
  readonly growthCents: Cents;
  readonly closingCents: Cents;
}
export function effectiveMonthlyRate(annualBps: BasisPoints): Decimal {
  if(!Number.isSafeInteger(annualBps)||annualBps<=-10000||annualBps>100000)throw new RangeError('Effective annual growth must be greater than -100% and at most 1000%.');
  return new Decimal(1).plus(new Decimal(annualBps).div(10000)).pow(new Decimal(1).div(12)).minus(1);
}
export function growMonth(opening: Decimal, annualBps: BasisPoints, monthEndDepositCents: Cents): GrowthMonth {
  assertMonetaryRange(opening);
  if(!Number.isSafeInteger(monthEndDepositCents)||monthEndDepositCents<0)throw new RangeError('Account deposits must be nonnegative integer cents.');
  const depositsCents=settleCents(new Decimal(monthEndDepositCents));
  const closingExact=opening.mul(new Decimal(1).plus(effectiveMonthlyRate(annualBps))).plus(depositsCents);
  const openingCents=settleCents(opening),closingCents=settleCents(closingExact);
  const growthCents=settleCents(new Decimal(closingCents).minus(openingCents).minus(depositsCents));
  return {closingExact,openingCents,depositsCents,growthCents,closingCents};
}
export function propertyRate(property: Property, year: number): BasisPoints {
  return property.appreciationOverrides.find(o=>o.year===year)?.rateBps??property.appreciationBps;
}
