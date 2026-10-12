import type { RulePack, RuleScalar, RuleValue } from './types.js';
import { fixed, indexed, rule, SOURCES as s } from './values.js';

const values: Record<string, RuleValue<RuleScalar>> = {};
const bracketAssumption = ['FTB October 2026 Schedule Y says 118,996 as the 8% lower boundary but prints amount over 118,966. Use published boundary 118,996 and integrate rates continuously; rounded published base-tax discrepancies are not copied.'];
const thresholds = [2291200, 5431400, 8572200, 11899600, 15039400, 76821800, 92185400, 153642600, null];
const rates = [100, 200, 400, 600, 800, 930, 1030, 1130, 1230];
thresholds.forEach((upper, i) => {
  values[`brackets.${i}.upperCents`] = rule(upper, s.california, upper === null ? fixed : indexed(100, 'nearest'), bracketAssumption, 'provisional');
  values[`brackets.${i}.rateBps`] = rule(rates[i]!, s.california);
});
const proxy = (value: number, source: typeof s.caForm | typeof s.caAmt) => rule(value, source, indexed(100, 'nearest'), [`Explicit provisional proxy: retain the published 2025 amount (${value / 100} USD) for 2026. FTB says complete 2026 indexed amounts are pending late December; statutory endpoint could not be retrieved, so no verified 2026 value is claimed.`], 'provisional');
Object.assign(values, {
  standardDeductionCents: rule(1180000, s.california, indexed(100, 'nearest')),
  personalCreditPerFilerCents: rule(15800, s.california, indexed(100, 'nearest')),
  seniorCreditPerFilerCents: rule(15800, s.california, indexed(100, 'nearest')),
  seniorCreditMinimumAge: rule(65, s.caForm),
  'creditPhaseout.startCents': proxy(50441100, s.caForm),
  'creditPhaseout.stepCents': rule(250000, s.caForm),
  'creditPhaseout.reductionPerExemptionCents': rule(600, s.caForm),
  'itemized.phaseoutStartCents': proxy(50441100, s.caForm),
  'itemized.reductionBps': rule(600, s.caDeduction),
  'itemized.maxReductionBps': rule(8000, s.caDeduction),
  'mortgage.acquisitionLimitCents': rule(100000000, s.caDeduction),
  'mortgageInsurance.allowed': rule(false, s.caMpi),
  'amt.exemptionCents': proxy(12366700, s.caAmt),
  'amt.phaseoutStartCents': proxy(46374500, s.caAmt),
  'amt.phaseoutBps': rule(2500, s.caAmt),
  'amt.rateBps': rule(700, s.caAmt),
  'surtax.thresholdCents': rule(100000000, s.caEstimate),
  'surtax.rateBps': rule(100, s.caEstimate),
  'passive.allowanceCents': rule(2500000, s.caPassive),
  'passive.phaseoutStartCents': rule(10000000, s.caPassive),
  'passive.phaseoutEndCents': rule(15000000, s.caPassive),
  'passive.reductionBps': rule(5000, s.caPassive),
  'rental.recoveryPeriodMonths': rule(330, s.rental),
  'rental.convention': rule('mid-month', s.rental),
});
export const california2026: RulePack = { jurisdiction: 'california', version: 'california-2026.1', baselineYear: 2026, values };
