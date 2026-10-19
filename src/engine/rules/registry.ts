import { federal2026 } from './federal-2026.js';
import { california2026 } from './california-2026.js';
import { payroll2026 } from './payroll-2026.js';
import { retirement2026 } from './retirement-2026.js';
import type { RuleSet } from './types.js';

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const baseline: RuleSet = deepFreeze({ version: 'us-ca-2026.5', baselineYear: 2026, federal: federal2026, california: california2026, payroll: payroll2026, retirement: retirement2026 });
export function loadRuleSet(): RuleSet { return baseline; }
