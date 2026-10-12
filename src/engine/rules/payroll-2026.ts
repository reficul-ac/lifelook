import type { RulePack } from './types.js';
import { indexed, rule, SOURCES as s } from './values.js';
export const payroll2026: RulePack = { jurisdiction: 'payroll', version: 'payroll-2026.1', baselineYear: 2026, values: {
  socialSecurityRateBps: rule(620, s.payroll),
  socialSecurityWageBaseCents: rule(18450000, [s.socialSecurity, s.socialSecurityIndex], indexed(30000, 'nearest')),
  medicareRateBps: rule(145, s.payroll),
  additionalMedicareRateBps: rule(90, s.additionalMedicare),
  additionalMedicareThresholdCents: rule(25000000, s.additionalMedicare),
  sdiRateBps: rule(130, s.sdi, { kind: 'administered' }),
  sdiWageBaseCents: rule(null, s.sdi),
} };
