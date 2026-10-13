import type { Cents } from '../model/plan';
import { Decimal, assertMonetaryRange, settleSeries } from '../money';

/** Allocate assessed annual income tax, independently of payroll withholding. */
export function allocateAnnualTax(liabilityCents: Cents, positiveGrossCashByMonth: readonly Cents[]): readonly Cents[] {
  if(!Number.isSafeInteger(liabilityCents)||liabilityCents<0)throw new RangeError('Annual assessed income tax must be nonnegative integer cents.');
  assertMonetaryRange(new Decimal(liabilityCents));
  if(positiveGrossCashByMonth.length!==12)throw new RangeError('An annual tax allocation requires twelve monthly income weights.');
  for(const weight of positiveGrossCashByMonth) {
    if(!Number.isSafeInteger(weight)||weight<0)throw new RangeError('Monthly income weights must be nonnegative integer cents.');
    assertMonetaryRange(new Decimal(weight));
  }
  const total=positiveGrossCashByMonth.reduce((s,v)=>s.plus(v),new Decimal(0));
  assertMonetaryRange(total);
  return settleSeries(positiveGrossCashByMonth.map(weight=>total.isZero()?new Decimal(liabilityCents).div(12):new Decimal(liabilityCents).mul(weight).div(total)));
}
