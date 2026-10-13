import { describe, expect, it } from 'vitest';
import { projectionSummary } from '../../src/browser/projection-summary';
import { calculateProjection, loadRuleSet } from '../../src/engine';
import type { AccountProjection, AnnualProjection, Available, Cents, Issue, PlanDocument, ProjectionResult } from '../../src/engine';
import { MAX_CENTS } from '../../src/engine/money';
import { makePlan, mustValidate } from '../helpers/plans';
import { loadReferences } from '../helpers/references';

const available = (value: Cents): Available<Cents> => ({ status: 'available', value });
const emptyYear = calculateProjection(mustValidate(makePlan()), loadRuleSet()).years[0]!;
const summary = (overrides: Partial<AnnualProjection> = {}) => projectionSummary({ ...emptyYear, ...overrides });
const issue: Issue = { code: 'required-tax', year: 2026, field: 'tax', severity: 'warning', explanation: 'Tax requires a missing opening history.', resolution: 'Supply the opening history.' };
const missing: Available<Cents> = { status: 'needs-data', issues: [issue] };
const unsupported: Available<Cents> = { status: 'unsupported-case', issues: [{ ...issue, code: 'unsupported-tax' }] };
const account = (accountId: string, withholdingCents?: Available<Cents>): AccountProjection => ({ accountId, openingCents: available(0), contributionCents: available(0), growthCents: available(0), closingCents: available(0), ...(withholdingCents ? { withholdingCents } : {}) });

describe('annual cash summary', () => {
  it('counts all cash income and full debt outlays before investment contributions', () => {
    const fixture = loadReferences<PlanDocument, ProjectionResult>('projection').find(item => item.id === 'two-salaries-home-adu')!;
    const year = calculateProjection(mustValidate(fixture.input), loadRuleSet()).years[0]!;
    expect(projectionSummary(year)).toEqual({
      year: 2026,
      netWorthCents: available(36353605),
      totalIncomeCents: available(12797487),
      cashIncomeCents: available(12797487),
      postTaxIncomeCents: available(10578413),
      expensesCents: available(1820000),
      cashFlowCents: available(8758413),
    });
  });

  it('keeps investment-only funding gaps out of cash flow before investments', () => {
    const fixture = loadReferences<PlanDocument, ProjectionResult>('projection').find(item => item.id === 'cash-only-funding-gap')!;
    const year = calculateProjection(mustValidate(fixture.input), loadRuleSet()).years[0]!;
    expect(year.cashFlowCents).toEqual(available(-240000));
    expect(projectionSummary(year).cashFlowCents).toEqual(available(0));
    expect(summary({ eligibleContributionCents: unsupported, cashFlowCents: unsupported }).cashFlowCents).toEqual(available(0));
  });

  it('excludes retained RSUs from cash income and credits withholding against tax once', () => {
    const result = summary({
      salaryCents: available(12000000), otherIncomeCents: available(200000), rentCents: available(2400000),
      grossIncomeCents: available(26600000), totalTaxCents: available(6000000),
      expensesCents: available(3000000), debtPaymentCents: available(1200000),
      accounts: [account('first-equity', available(2400000)), account('brokerage'), account('second-equity', available(1200000))],
    });
    expect(result.totalIncomeCents).toEqual(available(26600000));
    expect(result.cashIncomeCents).toEqual(available(14600000));
    expect(result.postTaxIncomeCents).toEqual(available(12200000));
    expect(result.expensesCents).toEqual(available(4200000));
    expect(result.cashFlowCents).toEqual(available(8000000));
  });

  it('keeps known cash amounts available when unvested RSU paper valuation overflows', () => {
    const plan = makePlan({ openingCashCents: 10000, accounts: [{ id: 'equity', name: 'Synthetic equity', ownerId: 'owner-a', type: 'rsu', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: false }, rsu: { employerId: 'employer', currentSharePriceCents: 2, grants: [{ id: 'grant', name: 'Synthetic grant', startDate: '2026-01-01', grantValueCents: 60000000000000, grantSharePriceCents: 1, vestingMonths: 48, vestingFrequency: 'annual', cliffMonths: 48, withholdingBps: 0, taxTreatment: 'settle-at-vest', openingHeldShares: 0, openingBasis: { known: true, value: 0 } }] } }] });
    const year = calculateProjection(mustValidate(plan), loadRuleSet()).years[0]!;
    expect(year.rsu?.status).toBe('unsupported-case');
    expect(projectionSummary(year)).toEqual({ year: 2026, netWorthCents: available(10000), totalIncomeCents: available(0), cashIncomeCents: available(0), postTaxIncomeCents: available(0), expensesCents: available(0), cashFlowCents: available(0) });
  });

  it('preserves independent income and expenses when taxes need data', () => {
    const result = summary({ salaryCents: available(100000), grossIncomeCents: available(100000), totalTaxCents: missing, expensesCents: available(12000), debtPaymentCents: available(8000), netWorthCents: missing });
    expect(result.cashIncomeCents).toEqual(available(100000));
    expect(result.expensesCents).toEqual(available(20000));
    expect(result.postTaxIncomeCents).toEqual(missing);
    expect(result.cashFlowCents).toEqual(missing);
    expect(result.netWorthCents).toEqual(missing);
  });

  it('propagates unavailable withholding with unsupported precedence and distinct causes', () => {
    const result = summary({ salaryCents: missing, totalTaxCents: missing, accounts: [account('equity', unsupported)] });
    expect(result.cashIncomeCents).toEqual(missing);
    expect(result.postTaxIncomeCents).toEqual({ status: 'unsupported-case', issues: [issue, { ...issue, code: 'unsupported-tax' }] });
    expect(result.cashFlowCents).toEqual(result.postTaxIncomeCents);
    expect(result.expensesCents).toEqual(available(0));
  });

  it.each([
    { field: 'cashIncomeCents', overrides: { salaryCents: available(MAX_CENTS), otherIncomeCents: available(1) } },
    { field: 'postTaxIncomeCents', overrides: { salaryCents: available(MAX_CENTS), accounts: [account('equity', available(1))] } },
    { field: 'expensesCents', overrides: { expensesCents: available(MAX_CENTS), debtPaymentCents: available(1) } },
    { field: 'cashFlowCents', overrides: { totalTaxCents: available(MAX_CENTS), expensesCents: available(1) } },
  ] as const)('locates $field overflow without throwing or hiding independent balances', ({ field, overrides }) => {
    const result = summary({ netWorthCents: available(12345), ...overrides });
    expect(result[field]).toMatchObject({ status: 'unsupported-case', issues: [expect.objectContaining({ code: 'monetary-overflow', year: 2026, field: `summary.${field}` })] });
    expect(result[field]).not.toHaveProperty('value');
    expect(result.netWorthCents).toEqual(available(12345));
  });

  it('locates withholding total overflow independently of income and spending', () => {
    const result = summary({ accounts: [account('first-equity', available(MAX_CENTS)), account('second-equity', available(1))] });
    expect(result.postTaxIncomeCents).toMatchObject({ status: 'unsupported-case', issues: [expect.objectContaining({ code: 'monetary-overflow', year: 2026, field: 'summary.rsuWithholdingCents' })] });
    expect(result.cashIncomeCents).toEqual(available(0));
    expect(result.expensesCents).toEqual(available(0));
  });

  it('retains exact cents at the monetary boundary after offsetting taxes', () => {
    const result = summary({ salaryCents: available(MAX_CENTS), totalTaxCents: available(MAX_CENTS), accounts: [account('equity', available(MAX_CENTS))], expensesCents: available(1) });
    expect(result.postTaxIncomeCents).toEqual(available(MAX_CENTS));
    expect(result.cashFlowCents).toEqual(available(MAX_CENTS - 1));
  });
});
