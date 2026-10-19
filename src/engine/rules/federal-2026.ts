import type { RulePack, RuleValue, RuleScalar } from './types.js';
import { fixed, indexed, rule, SOURCES as s } from './values.js';

const values: Record<string, RuleValue<RuleScalar>> = {};
const thresholds = [2480000, 10080000, 21140000, 40355000, 51245000, 76870000, null];
const rates = [1000, 1200, 2200, 2400, 3200, 3500, 3700];
thresholds.forEach((upper, i) => {
  values[`brackets.${i}.upperCents`] = rule(upper, [s.federal, s.federalIndex], upper === null ? fixed : indexed(5000));
  values[`brackets.${i}.rateBps`] = rule(rates[i]!, [s.federal, s.law]);
});
const saltGrowth = { kind: 'statutory-growth', growthBps: 100, incrementCents: 1, rounding: 'nearest' } as const;
Object.assign(values, {
  'capitalGains.method': rule('ordinary-long-term-gain-worksheet', [s.capitalGains, s.amtMethod]),
  'capitalGains.zeroRateMaximumCents': rule(9890000, [s.federal, s.federalIndex], indexed(5000)),
  'capitalGains.fifteenRateMaximumCents': rule(61370000, [s.federal, s.federalIndex], indexed(5000)),
  'capitalGains.middleRateBps': rule(1500, [s.federalIndex, s.capitalGains]),
  'capitalGains.upperRateBps': rule(2000, [s.federalIndex, s.capitalGains]),
  standardDeductionCents: rule(3220000, [s.federal, s.standardIndex, s.law], indexed(10000)),
  'taxTable.method': rule('federal-variable-dollar-midpoint', s.federalTaxTable, fixed, ['Explicit provisional 2026 tax-table assumption: preserve complete official 2025 bin and rounding methods while applying the published 2026 marginal rates until the 2026 annual table is published.'], 'provisional'),
  'taxTable.maximumExclusiveCents': rule(10000000, s.federalTaxTable, fixed, ['Explicit provisional 2025 tax-table/schedule boundary for 2026.'], 'provisional'),
  'taxTable.narrowBinsThroughCents': rule(300000, s.federalTaxTable, fixed, ['Explicit provisional 2025 narrow-bin endpoint for 2026.'], 'provisional'),
  'taxTable.narrowBinWidthCents': rule(2500, s.federalTaxTable, fixed, ['Explicit provisional 2025 narrow-bin width for 2026.'], 'provisional'),
  'taxTable.wideBinWidthCents': rule(5000, s.federalTaxTable, fixed, ['Explicit provisional 2025 wide-bin width for 2026.'], 'provisional'),
  'taxTable.initialUpperCents.0': rule(500, s.federalTaxTable, fixed, ['Explicit provisional 2025 first short-bin exclusive upper endpoint for 2026.'], 'provisional'),
  'taxTable.initialUpperCents.1': rule(1500, s.federalTaxTable, fixed, ['Explicit provisional 2025 second short-bin exclusive upper endpoint for 2026.'], 'provisional'),
  'taxTable.initialUpperCents.2': rule(2500, s.federalTaxTable, fixed, ['Explicit provisional 2025 third short-bin exclusive upper endpoint for 2026.'], 'provisional'),
  additionalStandardDeductionPerFilerCents: rule(165000, [s.federal, s.standardIndex], indexed(5000)),
  ageDeductionMinimumAge: rule(65, s.planning),
  'seniorDeduction.perFilerCents': rule(600000, s.law, fixed, [], 'verified', [{ effectiveYear: 2029, value: 0, sources: [s.law] }]),
  'seniorDeduction.minimumAge': rule(65, s.law),
  'seniorDeduction.phaseoutStartCents': rule(15000000, s.law),
  'seniorDeduction.reductionBps': rule(600, s.law),
  'salt.capCents': rule(4040000, [s.law, s.planning], saltGrowth, [], 'verified', [{ effectiveYear: 2030, value: 1000000, indexing: fixed, sources: [s.law] }]),
  'salt.phaseoutStartCents': rule(50500000, [s.law, s.planning], saltGrowth),
  'salt.reductionBps': rule(3000, s.law, fixed, [], 'verified', [{ effectiveYear: 2030, value: 0, sources: [s.law] }]),
  'salt.floorCents': rule(1000000, s.law),
  'itemized.restrictionNumerator': rule(2, s.law),
  'itemized.restrictionDenominator': rule(37, s.law),
  'itemized.thresholdCents': rule(76870000, [s.federal, s.law, s.federalIndex], indexed(5000)),
  'mortgage.post2017LimitCents': rule(75000000, [s.mortgage, s.law]),
  'mortgage.pre2017LimitCents': rule(100000000, s.mortgage),
  'mortgage.cutoffDate': rule('2017-12-15', s.mortgage),
  'mortgageInsurance.allowed': rule(true, s.law),
  'mortgageInsurance.phaseoutStartCents': rule(10000000, [s.mortgageStatute, s.law]),
  'mortgageInsurance.phaseoutStepCents': rule(100000, [s.mortgageStatute, s.law]),
  'mortgageInsurance.reductionBps': rule(1000, [s.mortgageStatute, s.law]),
  'amt.exemptionCents': rule(14020000, [s.federal, s.amtIndex], indexed(10000, 'nearest')),
  'amt.phaseoutStartCents': rule(100000000, [s.federal, s.amtIndex, s.law], indexed(10000, 'nearest')),
  'amt.phaseoutBps': rule(5000, s.law),
  'amt.rateSplitCents': rule(24450000, [s.federal, s.amtIndex], indexed(10000, 'nearest')),
  'amt.lowerRateBps': rule(2600, s.amtIndex),
  'amt.upperRateBps': rule(2800, s.amtIndex),
  'amt.seniorDeductionAllowed': rule(false, [s.amtStatute, s.amtMethod, s.law]),
  'amt.itemizedRestrictionApplies': rule(false, s.amtStatute),
  'passive.allowanceCents': rule(2500000, s.passive),
  'passive.phaseoutStartCents': rule(10000000, s.passive),
  'passive.phaseoutEndCents': rule(15000000, s.passive),
  'passive.reductionBps': rule(5000, s.passive),
  'niit.thresholdCents': rule(25000000, s.niit),
  'niit.rateBps': rule(380, s.niit),
  'qbi.deductionBps': rule(2000, s.qbi),
  'qbi.phaseoutStartCents': rule(40350000, [s.federal, s.law], indexed(5000)),
  // The $150,000 MFJ phase-in RANGE remains fixed; projection rebuilds its upper bound.
  'qbi.phaseoutEndCents': rule(55350000, [s.federal, s.law], { ...indexed(5000), anchorPath: 'qbi.phaseoutStartCents', fixedOffsetCents: 15000000 }),
  'qbi.wageOnlyLimitBps': rule(5000, s.qbiStatute),
  'qbi.wageMixedLimitBps': rule(2500, s.qbiStatute),
  'qbi.ubiaLimitBps': rule(250, s.qbiStatute),
  'qbi.minimumDeductionCents': rule(40000, s.law, indexed(500, 'nearest')),
  'qbi.minimumQbiCents': rule(100000, s.law, indexed(500, 'nearest')),
  'rental.recoveryPeriodMonths': rule(330, s.rental),
  'rental.convention': rule('mid-month', s.rental),
  'rental.amtPre1999RecoveryPeriodMonths': rule(480, s.amtMethod),
  'rental.amtSameRecoveryFromDate': rule('1999-01-01', s.amtMethod),
  'rental.ordinaryMacrsFromDate': rule('1987-01-01', s.rental),
});
export const federal2026: RulePack = { jurisdiction: 'federal', version: 'federal-2026.1', baselineYear: 2026, values };
