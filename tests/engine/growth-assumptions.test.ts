import { describe, expect, it } from 'vitest';
import { accountGrowthRate, calculateProjection, loadRuleSet, propertyRate, validatePlan } from '../../src/engine';
import { exportPlan } from '../../src/browser/storage';
import { makeGrowthPlan } from '../helpers/growth';
import { mustValidate } from '../helpers/plans';

describe('explicit scenario growth defaults', () => {
  it('resolves explicit defaults without replacing custom fields', () => {
    const p = makeGrowthPlan({ growthAssumptions: { stocksBps: 770, propertyBps: 400 } });
    const stock = { ...p.accounts[0]!, growthSource: 'stocks-default' as const };
    expect(accountGrowthRate(stock, p.growthAssumptions)).toBe(770);
    expect(stock.annualGrowthBps).toBe(500);
    expect(accountGrowthRate(p.accounts[1]!, p.growthAssumptions)).toBe(650);
    const home = { ...p.properties[0]!, appreciationSource: 'property-default' as const,
      appreciationOverrides: [{ year: 2027, rateBps: -100 }] };
    expect(propertyRate(home, 2026, p.growthAssumptions)).toBe(400);
    expect(propertyRate(home, 2027, p.growthAssumptions)).toBe(-100);
    expect(home.appreciationBps).toBe(300);
  });

  it('compounds inherited accounts and owned property at the category rates', () => {
    const p = makeGrowthPlan({ growthAssumptions: { stocksBps: 770, propertyBps: 400 } });
    const inherited = { ...p, accounts: p.accounts.map(a => a.id === 'stock' ? { ...a, growthSource: 'stocks-default' as const } : a),
      properties: p.properties.map(home => ({ ...home, appreciationSource: 'property-default' as const })) };
    const before = structuredClone(inherited), result = calculateProjection(mustValidate(inherited), loadRuleSet());
    expect(result.years[0]!.accounts.find(a => a.accountId === 'stock')!.closingCents).toMatchObject({ status: 'available', value: 1_077_000 });
    expect(result.years[0]!.propertyValueCents).toMatchObject({ status: 'available', value: 1_040_000 });
    expect(inherited).toEqual(before);
  });

  it('keeps an unmarked stock account at its explicit five percent rate', () => {
    const p = makeGrowthPlan({ growthAssumptions: { stocksBps: 770 } });
    const result = calculateProjection(mustValidate(p), loadRuleSet());
    expect(result.years[0]!.accounts.find(a => a.accountId === 'stock')!.closingCents).toMatchObject({ status: 'available', value: 1_050_000 });
  });

  it('accepts omitted categories, explicit zero defaults, and both rate boundaries', () => {
    for (const growthAssumptions of [{ stocksBps: 0 }, { propertyBps: 0 }, { stocksBps: -9999, propertyBps: 100000 }, {}]) {
      expect(validatePlan(makeGrowthPlan({ growthAssumptions })).ok).toBe(true);
    }
    const p = makeGrowthPlan({ growthAssumptions: { stocksBps: 0, propertyBps: 0 } });
    const plan = mustValidate({ ...p, accounts: p.accounts.map(a => ({ ...a, growthSource: 'stocks-default' as const })),
      properties: p.properties.map(home => ({ ...home, appreciationSource: 'property-default' as const })) });
    const result = calculateProjection(plan, loadRuleSet());
    expect(result.years[0]!.accounts.find(a => a.accountId === 'stock')!.closingCents).toMatchObject({ status: 'available', value: 1_000_000 });
    expect(result.years[0]!.propertyValueCents).toMatchObject({ status: 'available', value: 1_000_000 });
  });

  it.each(['stocksBps', 'propertyBps'])('validates every supplied %s as an integer effective annual rate', field => {
    for (const rate of [-10000, 100001, 0.5, '770', null, NaN]) {
      const result = validatePlan({ ...makeGrowthPlan(), growthAssumptions: { [field]: rate } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ field: `growthAssumptions.${field}` }));
    }
  });

  it('requires a plain defaults object when supplied', () => {
    for (const growthAssumptions of [null, [], 770]) expect(validatePlan({ ...makeGrowthPlan(), growthAssumptions }).ok).toBe(false);
  });

  it.each(['growthSource', 'appreciationSource'])('rejects unsupported %s values and missing referenced categories', field => {
    const p = makeGrowthPlan(), account = field === 'growthSource';
    for (const marker of [account ? 'stocks-default' : 'property-default', 'custom', 'unsupported', null]) {
      const raw = account ? { ...p, accounts: p.accounts.map(a => ({ ...a, [field]: marker })) }
        : { ...p, properties: p.properties.map(home => ({ ...home, [field]: marker })) };
      const result = validatePlan(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ field }));
    }
  });

  it('continues validating retained custom rates while an asset inherits', () => {
    const p = makeGrowthPlan({ growthAssumptions: { stocksBps: 770, propertyBps: 400 } });
    expect(validatePlan({ ...p, accounts: [{ ...p.accounts[0]!, annualGrowthBps: -10000, growthSource: 'stocks-default' }] }).ok).toBe(false);
    expect(validatePlan({ ...p, properties: [{ ...p.properties[0]!, appreciationBps: 100001, appreciationSource: 'property-default' }] }).ok).toBe(false);
  });

  it('validates and exports legacy inputs without enriching their defaults or sources', () => {
    const legacy = makeGrowthPlan(), before = structuredClone(legacy), validated = mustValidate(legacy);
    expect(legacy).toEqual(before);
    expect(JSON.parse(exportPlan(validated))).toEqual(before);
    expect(validated).not.toHaveProperty('growthAssumptions');
    expect(validated.accounts.every(a => !Object.hasOwn(a, 'growthSource'))).toBe(true);
    expect(validated.properties.every(p => !Object.hasOwn(p, 'appreciationSource'))).toBe(true);
  });
});
