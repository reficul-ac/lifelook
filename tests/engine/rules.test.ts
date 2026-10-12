import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadRuleSet } from '../../src/engine/rules/registry.js';
import { resolveYearRules, aggregateRuleProvenance } from '../../src/engine/rules/projection.js';
import { assertReference, loadReferences } from '../helpers/references.js';
import type { TaxPolicy } from '../../src/engine/model/plan.js';

const policy: TaxPolicy = { baselineYear: 2026, futureIndexGrowthBps: 0, actualStateTaxPaidByYear: [] };
function rules(year = 2026, growth = 0) {
  const result = resolveYearRules(loadRuleSet(), year, { ...policy, futureIndexGrowthBps: growth });
  if (result.status !== 'available') throw new Error(JSON.stringify(result.issues));
  return result.value;
}
function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, key) => (v as Record<string, unknown>)[key], value);
}

describe('sourced rule packs', () => {
  it('uses enacted 2026 SALT and published retirement amounts', () => {
    const r = rules();
    expect(r.federal.salt).toEqual({ capCents: 4040000, phaseoutStartCents: 50500000, reductionBps: 3000, floorCents: 1000000 });
    expect(r.retirement.electiveDeferralLimitCents).toBe(2450000);
    expect(r.retirement.iraLimitCents).toBe(750000);
  });
  it.each(loadReferences<TaxPolicy, Readonly<Record<string, unknown>>>('rules-2026'))('$id', c => {
    const result = resolveYearRules(loadRuleSet(), c.taxYear, c.input);
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    for (const [path, expected] of Object.entries(c.expected)) assertReference(at(result.value, path), expected, c.toleranceCents);
  });
  it('keeps published and provisional California fields separate', () => {
    const r = rules();
    expect(r.provenance['california.standardDeductionCents']?.status).toBe('verified');
    expect(r.provenance['california.brackets.4.upperCents']?.status).toBe('provisional');
    expect(r.provenance['california.amt.exemptionCents']?.status).toBe('provisional');
    expect(aggregateRuleProvenance(r, ['federal.standardDeductionCents']).status).toBe('verified');
    expect(aggregateRuleProvenance(r, ['california.amt.exemptionCents']).status).toBe('provisional');
    expect(r.provenance['california.brackets.4.upperCents']?.assumptions.join(' ')).toContain('118,966');
  });
  it('requires an explicit value and named assumption for an unresolved field', () => {
    const baseline = loadRuleSet();
    const field = baseline.california.values['amt.exemptionCents']!;
    const { value: _discard, ...missing } = field;
    const pack = { ...baseline, california: { ...baseline.california, values: { ...baseline.california.values, 'amt.exemptionCents': missing } } };
    const r = resolveYearRules(pack, 2026, policy);
    expect(r.status).toBe('needs-data');
    if (r.status === 'needs-data') {
      expect(r.issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'california.amt.exemptionCents' })]));
      expect(r).not.toHaveProperty('value');
    }
    const unqualified = { ...baseline, california: { ...baseline.california, values: { ...baseline.california.values, 'amt.exemptionCents': { ...field, assumptions: [] } } } };
    expect(resolveYearRules(unqualified, 2026, policy).status).toBe('needs-data');
  });
  it('freezes input packs and does not mutate policy or packs during projection', () => {
    const pack = loadRuleSet();
    const before = JSON.stringify(pack);
    resolveYearRules(pack, 2030, policy);
    expect(JSON.stringify(pack)).toBe(before);
    expect(Object.isFrozen(pack.federal.values)).toBe(true);
    expect(Object.isFrozen(pack.federal.values['salt.capCents'])).toBe(true);
  });
  it.each([2025, 10000, NaN, 2026.5])('rejects unsupported rule year %s', year => {
    expect(resolveYearRules(loadRuleSet(), year, policy).status).toBe('unsupported-case');
  });
  it('records metadata and a stored primary source for every field', () => {
    for (const pack of [loadRuleSet().federal, loadRuleSet().california, loadRuleSet().payroll, loadRuleSet().retirement]) {
      for (const rule of Object.values(pack.values)) {
        expect(rule.sources.length).toBeGreaterThan(0);
        expect(rule.reviewDate).toMatch(/^2026-10-12$/);
        expect(rule.applicableYear).toBe(2026);
        expect(rule.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(rule.indexing.kind).toBeDefined();
        for (const source of rule.sources) expect(existsSync(new URL(`../../sources/${source.snapshot}`, import.meta.url))).toBe(true);
      }
    }
  });
  it('pins independently stored source bytes to reviewed retrieval hashes', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../sources/manifest.json', import.meta.url), 'utf8')) as { retrievedOn: string; sources: { snapshot: string; sha256: string; url: string }[] };
    expect(manifest.retrievedOn).toBe('2026-10-12');
    expect(manifest.sources.length).toBeGreaterThan(20);
    for (const s of manifest.sources) {
      const bytes = readFileSync(new URL(`../../sources/${s.snapshot}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(s.sha256);
      expect(s.url).toMatch(/^https:\/\//);
    }
  });
});

describe('independent reference assertions', () => {
  it('permits tolerance only for named monetary leaves', () => {
    expect(() => assertReference({ taxCents: 101, rateBps: 1000 }, { taxCents: 100, rateBps: 1000 }, 1)).not.toThrow();
    expect(() => assertReference({ rateBps: 1001 }, { rateBps: 1000 }, 1)).toThrow();
    expect(() => assertReference({ taxCents: 102 }, { taxCents: 100 }, 1)).toThrow();
    expect(() => assertReference({ taxCents: 100, extra: 0 }, { taxCents: 100 }, 1)).toThrow();
    expect(() => assertReference({}, { taxCents: 0 }, 1)).toThrow();
    expect(() => assertReference({ status: 'available' }, { status: 'needs-data' }, 1)).toThrow();
    expect(() => assertReference({ taxCents: NaN }, { taxCents: 0 }, 1)).toThrow();
  });
  it('permits declared tolerance inside available cents and monetary allocation maps', () => {
    expect(() => assertReference({ eligibleCents: { status: 'available', value: 101 } }, { eligibleCents: { status: 'available', value: 100 } }, 1)).not.toThrow();
    expect(() => assertReference({ rentalCentsByUnit: { 'unit-a': 101 } }, { rentalCentsByUnit: { 'unit-a': 100 } }, 1)).not.toThrow();
    expect(() => assertReference({ eligibleCents: { status: 'available', value: 100 } }, { eligibleCents: { status: 'needs-data' } }, 1)).toThrow();
  });
  it('accepts negative projected indexing while preserving statutory no-decrease amounts', () => {
    const r = rules(2027, -200);
    expect(r.federal.standardDeductionCents).toBe(3220000);
    expect(r.payroll.socialSecurityWageBaseCents).toBe(18450000);
    expect(r.retirement.electiveDeferralLimitCents).toBe(2450000);
    expect(r.provenance['federal.standardDeductionCents']?.assumptions.join(' ')).toContain('no-decrease');
  });
  it('rejects nonexistent and unsafe suite names', () => {
    expect(() => loadReferences('does-not-exist')).toThrow();
    expect(() => loadReferences('../rules-2026')).toThrow();
  });
});
