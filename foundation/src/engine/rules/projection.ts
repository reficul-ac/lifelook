import type { TaxPolicy } from '../model/plan.js';
import type { Available, Issue, RuleProvenance } from '../model/results.js';
import type { RuleSet, YearRules } from './types.js';
import { Decimal, CalculationRangeError, settleCents } from '../money.js';
import { deepFreeze, loadRuleSet } from './registry.js';

export function resolveYearRules(ruleSet: RuleSet, year: number, policy: TaxPolicy): Available<YearRules> {
  const issue = (code: string, field: string, explanation: string): Issue => ({ code, field, year, severity: 'error', explanation, resolution: 'Supply a sourced rule value and an explicit provisional assumption where the publication is incomplete.' });
  if (!Number.isInteger(year) || year < 2026 || year > 9999 || ruleSet.baselineYear !== 2026 || policy.baselineYear !== 2026) return { status: 'unsupported-case', issues: [issue('unsupported-rule-year', 'year', 'The supported rule baseline is 2026; calendar years must be integers from 2026 through 9999.')] };
  if (!Number.isInteger(policy.futureIndexGrowthBps) || policy.futureIndexGrowthBps <= -10000 || policy.futureIndexGrowthBps > 100000) return { status: 'unsupported-case', issues: [issue('unsupported-rule-index', 'futureIndexGrowthBps', 'Future indexed-threshold growth must be integer basis points greater than -100% and at most 1000%.')] };
  const issues: Issue[] = [];
  const output: Record<string, unknown> = { year, baselineYear: 2026, ruleVersion: ruleSet.version };
  const provenance: Record<string, RuleProvenance> = {};
  const namespaces = ['federal', 'california', 'payroll', 'retirement'] as const;
  function put(target: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    let node = target;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) node[key] = value;
      else { node[key] ??= /^\d+$/.test(keys[i + 1]!) ? [] : {}; node = node[key] as Record<string, unknown>; }
    });
  }
  for (const namespace of namespaces) {
    const pack = ruleSet[namespace];
    const resolved: Record<string, unknown> = {};
    const leafValues: Record<string, unknown> = {};
    for (const path of Object.keys(loadRuleSet()[namespace].values)) {
      const field = `${namespace}.${path}`;
      const r = pack.values[path];
      if (!r || r.value === undefined || r.sources.length === 0 || (r.status === 'provisional' && r.assumptions.length === 0)) {
        issues.push(issue('missing-rule-value', field, `No supported value or explicit provisional assumption exists for ${field}.`));
        continue;
      }
      let value = r.value;
      let indexing = r.indexing;
      let fromYear = 2026;
      const assumptions = [...r.assumptions];
      const sources = r.sources.map(s => s.url);
      for (const transition of [...r.transitions].sort((a, b) => a.effectiveYear - b.effectiveYear)) {
        if (transition.effectiveYear <= year) { value = transition.value; indexing = transition.indexing ?? indexing; fromYear = transition.effectiveYear; sources.push(...transition.sources.map(s => s.url)); }
      }
      let status: RuleProvenance['status'] = r.status;
      try {
        if (year > fromYear && typeof value === 'number' && (indexing.kind === 'indexed' || indexing.kind === 'statutory-growth')) {
          const steps = year - Math.max(fromYear, indexing.startsAfterYear ?? fromYear);
          const growth = indexing.kind === 'statutory-growth' ? indexing.growthBps! : policy.futureIndexGrowthBps;
          const appliedGrowth = indexing.kind === 'indexed' && namespace !== 'california' ? Math.max(0, growth) : growth;
          const unrounded = new Decimal(value).mul(new Decimal(1).plus(new Decimal(appliedGrowth).div(10000)).pow(steps));
          const increment = new Decimal(indexing.incrementCents ?? 1);
          const amount = indexing.roundIncreaseOnly ? unrounded.minus(value) : unrounded;
          const rounded = amount.div(increment).toDecimalPlaces(0, indexing.rounding === 'nearest' ? Decimal.ROUND_HALF_UP : Decimal.ROUND_FLOOR).mul(increment);
          value = settleCents(indexing.roundIncreaseOnly ? rounded.plus(value) : rounded);
          if (indexing.kind === 'indexed') {
            if (status !== 'provisional') status = 'projected';
            assumptions.push(`Future legally indexed threshold scenario: compound the published 2026 baseline by ${growth} basis points per year, using the recorded jurisdiction-specific rounding. This is not a published future tax amount.`);
            if (growth < 0 && namespace !== 'california') assumptions.push('Apply the statutory no-decrease floor: a negative scenario index cannot reduce federal inflation increases or the Social Security contribution base below the baseline amount.');
          }
        }
        if (year > 2026 && indexing.kind === 'administered') {
          if (status !== 'provisional') status = 'projected';
          assumptions.push('Explicit future administered-rate assumption: carry forward the published 2026 SDI rate; threshold growth does not index this rate.');
        }
        leafValues[path] = value;
        provenance[field] = { status, baselineYear: 2026, applicableYear: year, ruleVersion: pack.version, sources: [...new Set(sources)], assumptions };
      } catch (error) {
        if (!(error instanceof CalculationRangeError)) throw error;
        issues.push(issue('monetary-overflow', field, `Projected ${field} exceeds the supported monetary range.`));
      }
    }
    for (const [path, value] of Object.entries(leafValues)) {
      const indexing = pack.values[path]!.indexing;
      if (indexing.anchorPath) {
        const anchor = leafValues[indexing.anchorPath];
        if (typeof anchor !== 'number') { issues.push(issue('missing-rule-value', `${namespace}.${path}`, 'The phaseout beginning is unavailable.')); continue; }
        try { put(resolved, path, settleCents(new Decimal(anchor).plus(indexing.fixedOffsetCents!))); }
        catch (error) { if (!(error instanceof CalculationRangeError)) throw error; issues.push(issue('monetary-overflow', `${namespace}.${path}`, 'The phaseout end exceeds the supported monetary range.')); }
      } else put(resolved, path, value);
    }
    output[namespace] = resolved;
  }
  if (issues.length) return { status: 'needs-data', issues };
  output.provenance = provenance;
  return { status: 'available', value: deepFreeze(output as unknown as YearRules) };
}
export function aggregateRuleProvenance(rules: YearRules, paths: readonly string[]): RuleProvenance {
  const fields = [...new Set(paths)].map(path => {
    const field = rules.provenance[path];
    if (!field) throw new Error(`Unknown provenance path: ${path}`);
    return field;
  });
  const status = fields.some(p => p.status === 'provisional') ? 'provisional' : fields.some(p => p.status === 'projected') ? 'projected' : 'verified';
  return { status, ruleVersion: rules.ruleVersion, baselineYear: rules.baselineYear, applicableYear: rules.year, sources: [...new Set(fields.flatMap(p => p.sources))], assumptions: [...new Set(fields.flatMap(p => p.assumptions))] };
}
