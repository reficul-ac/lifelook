import type { RulePack } from './types.js';
import { indexed, rule, SOURCES as s } from './values.js';
export const retirement2026: RulePack = { jurisdiction: 'retirement', version: 'retirement-2026.1', baselineYear: 2026, values: {
  electiveDeferralLimitCents: rule(2450000, [s.retirement, s.deferralIndex], indexed(50000, 'floor', true)),
  regularCatchupCents: rule(800000, [s.retirement, s.catchupIndex], indexed(50000, 'floor', true)),
  enhancedCatchupCents: rule(1125000, [s.retirement, s.catchupIndex], indexed(50000, 'floor', true)),
  catchupMinimumAge: rule(50, s.catchup),
  enhancedCatchupMinimumAge: rule(60, s.catchup),
  enhancedCatchupMaximumAge: rule(63, s.catchup),
  rothCatchupPriorYearWageThresholdCents: rule(15000000, [s.retirement, s.catchupIndex], indexed(500000, 'floor', true)),
  mandatoryRothCatchup: rule(true, s.catchup),
  iraLimitCents: rule(750000, [s.retirement, s.iraIndex], indexed(50000)),
  iraCatchupCents: rule(110000, [s.retirement, s.iraIndex], indexed(10000)),
  iraCatchupMinimumAge: rule(50, s.retirement),
  'iraDeductionCovered.startCents': rule(12900000, [s.retirement, s.iraIndex], indexed(100000, 'nearest')),
  'iraDeductionCovered.endCents': rule(14900000, [s.retirement, s.iraIndex], { ...indexed(100000, 'nearest'), anchorPath: 'iraDeductionCovered.startCents', fixedOffsetCents: 2000000 }),
  'iraDeductionSpouseCovered.startCents': rule(24200000, [s.retirement, s.iraIndex], indexed(100000, 'nearest')),
  'iraDeductionSpouseCovered.endCents': rule(25200000, [s.retirement, s.iraIndex], { ...indexed(100000, 'nearest'), anchorPath: 'iraDeductionSpouseCovered.startCents', fixedOffsetCents: 1000000 }),
  'rothIra.startCents': rule(24200000, [s.retirement, s.rothIndex], indexed(100000, 'nearest')),
  'rothIra.endCents': rule(25200000, [s.retirement, s.rothIndex], { ...indexed(100000, 'nearest'), anchorPath: 'rothIra.startCents', fixedOffsetCents: 1000000 }),
} };
