import { describe, expect, it } from 'vitest';
import { resolveCashYear } from '../../../src/engine/cash/income';
import { requestContributions } from '../../../src/engine/cash/contribution-requests';
import { initialTaxState } from '../../../src/engine/model/tax-state';
import { buildPropertyFacts } from '../../../src/engine/property/facts';
import { loadRuleSet } from '../../../src/engine/rules/registry';
import { resolveYearRules } from '../../../src/engine/rules/projection';
import { buildResolvedTaxFacts } from '../../../src/engine/tax/facts';
import type { ResolvedTaxFacts } from '../../../src/engine/tax/facts';
import { calculateFederalTax } from '../../../src/engine/tax/federal';
import { calculateCaliforniaTax } from '../../../src/engine/tax/california';
import type { DeductionChoice } from '../../../src/engine/tax/itemized';
import type { HouseholdTaxState } from '../../../src/engine/model/tax-state';
import { resolveIraContributions } from '../../../src/engine/tax/ira';
import { buildPreIraFacts } from '../../../src/engine/tax/modified-income';
import { resolveRentalLosses } from '../../../src/engine/tax/rental-losses';
import { resolveWorkplaceContributions } from '../../../src/engine/tax/workplace';
import { makePlan, mustValidate } from '../../helpers/plans';
import { loadReferences } from '../../helpers/references';

function household(wagesCents: number, gainCents: number, year = 2026, growthBps = 0) {
  const plan = mustValidate(makePlan({ salaries: [{ id: 'salary-a', name: 'Salary A', ownerId: 'owner-a', employerId: 'employer-a', annualGrossCents: wagesCents, startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] }] }));
  const result = resolveYearRules(loadRuleSet(), year, { ...plan.taxPolicy, futureIndexGrowthBps: growthBps });
  if (result.status !== 'available') throw new Error('Missing rules');
  const rules = result.value;
  const cash = { ...resolveCashYear(plan, year), longTermCapitalGainCents: gainCents };
  const requests = requestContributions(plan, cash);
  const workplace = resolveWorkplaceContributions(plan, cash, requests, rules);
  const opening = initialTaxState(plan);
  const property = buildPropertyFacts(plan, cash, [], opening, rules);
  const preIra = buildPreIraFacts(cash, workplace, property);
  const rental = resolveRentalLosses(preIra, opening, rules);
  const ira = resolveIraContributions(plan, preIra, rental, requests, workplace, rules);
  return { plan, cash, workplace, opening, preIra, ira, facts: buildResolvedTaxFacts(preIra, rental, ira, workplace), rules };
}

describe('generated ordinary long-term investment gains', () => {
  it('includes gains in AGI, separate AMT incomes, NIIT and every named MAGI', () => {
    // Dropping gain from pre-IRA non-rental income must fail every downstream income definition.
    const h = household(1000000, 30000000);
    for (const amount of [h.facts.federalAgiCents, h.facts.californiaAgiCents, h.facts.federalAmtIncomeCents,
      h.facts.californiaAmtIncomeCents, h.facts.niitMagiCents, h.facts.saltMagiCents,
      h.facts.traditionalIraMagiCents, h.facts.rothIraMagiCents, h.facts.passiveAllowanceMagiCents]) {
      expect(amount).toEqual({ status: 'available', value: 31000000 });
    }
    expect(h.facts.niitOtherIncomeCents).toEqual({ status: 'available', value: 30000000 });
    expect(h.facts).toMatchObject({ longTermCapitalGainCents: 30000000 });
  });

  it('keeps gains separate from earned cash, recurring income, wages and IRA compensation', () => {
    const h = household(1000000, 30000000);
    expect(h.cash.annual.grossIncomeCents).toBe(1000000);
    expect(h.cash.streams).toHaveLength(1);
    expect(h.preIra.grossWagesCents).toBe(1000000);
    expect(h.preIra.ordinaryTaxableCents).toBe(0);
    expect(h.ira.owners[0]!.compensationCents).toEqual({ status: 'available', value: 1000000 });
    expect(h.plan.household.coverageAnswers.qualifiedDividendsOrCapitalGains).toEqual({ known: true, value: false });
  });

  it('does not grant a deduction or a NIIT offset for a negative generated gain', () => {
    const h = household(1000000, -30000000);
    expect(h.facts.federalAgiCents).toEqual({ status: 'available', value: 1000000 });
    expect(h.facts.niitOtherIncomeCents).toEqual({ status: 'available', value: 0 });
  });

  it.each(loadReferences<{
    wagesCents: number; gainCents: number; amtIncomeCents?: number;
  }, Readonly<Record<string, number>>>('long-term-capital-gains-2026'))('$id', c => {
    const h = household(c.input.wagesCents, c.input.gainCents);
    const facts = c.input.amtIncomeCents === undefined ? h.facts
      : { ...h.facts, federalAmtIncomeCents: { status: 'available' as const, value: c.input.amtIncomeCents } };
    const result = calculateFederalTax(facts, { method: 'standard', standardCents: 3220000, allowedItemizedCents: 0 }, h.opening, h.rules);
    expect(result.status).toBe('available');
    if (result.status === 'available') expect(result.value).toMatchObject(c.expected);
  });

  it('subtracts net capital gain from the QBI taxable-income cap', () => {
    const c = loadReferences<{ facts: ResolvedTaxFacts; deductions: DeductionChoice; opening: HouseholdTaxState }, unknown>('federal-2026').find(c => c.id === 'qbi-qualified-low')!;
    // $100k AGI includes $90k gain; $32,200 standard deduction leaves no ordinary taxable income.
    const facts = { ...c.input.facts, longTermCapitalGainCents: 9000000 };
    const h = household(0, 0);
    const result = calculateFederalTax(facts, { method: 'standard', standardCents: 3220000, allowedItemizedCents: 0 }, c.input.opening, h.rules);
    expect(result.status).toBe('available');
    if (result.status === 'available') expect(result.value.qbiDeductionCents).toBe(0);
  });

  it('includes gains in NIIT at the joint MAGI threshold and taxes them ordinarily in California', () => {
    const h = household(24000000, 2000000);
    const deductions = { method: 'standard' as const, standardCents: 3220000, allowedItemizedCents: 0 };
    const federal = calculateFederalTax(h.facts, deductions, h.opening, h.rules);
    expect(federal.status).toBe('available');
    if (federal.status === 'available') expect(federal.value.niitCents).toBe(38000);
    const california = calculateCaliforniaTax(h.facts, { ...deductions, standardCents: 1180000 }, h.opening, h.rules);
    expect(california.status).toBe('available');
    if (california.status !== 'available') return;
    expect(california.value.taxableIncomeCents).toBe(24820000);
    // An equivalent wage-only household has identical California income tax and AMT.
    const wagesOnly = household(26000000, 0);
    expect(california).toEqual(calculateCaliforniaTax(wagesOnly.facts, { ...deductions, standardCents: 1180000 }, wagesOnly.opening, wagesOnly.rules));
  });

  it('projects sourced capital-gain thresholds with statutory $50 floor rounding', () => {
    // $98,900 × 1.025 = $101,372.50 -> $101,350; $613,700 × 1.025 -> $629,000.
    const h = household(0, 0, 2027, 250);
    expect(h.rules.federal).toMatchObject({ capitalGains: { zeroRateMaximumCents: 10135000, fifteenRateMaximumCents: 62900000, middleRateBps: 1500, upperRateBps: 2000 } });
    expect(h.rules.provenance['federal.capitalGains.zeroRateMaximumCents']?.status).toBe('projected');
  });

  it('preserves the complete no-gain federal result when the new input is omitted or zero', () => {
    const h = household(12000000, 0);
    const deductions = { method: 'standard' as const, standardCents: 3220000, allowedItemizedCents: 0 };
    expect(calculateFederalTax({ ...h.facts, longTermCapitalGainCents: 0 }, deductions, h.opening, h.rules))
      .toEqual(calculateFederalTax(h.facts, deductions, h.opening, h.rules));
  });
});
