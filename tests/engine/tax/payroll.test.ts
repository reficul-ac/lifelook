import { describe, expect, it } from 'vitest';
import type { ContributionRequest } from '../../../src/engine/cash/contribution-requests';
import type { CashYear } from '../../../src/engine/cash/income';
import type { PlanDocument } from '../../../src/engine/model/plan';
import type { YearRules } from '../../../src/engine/rules/types';
import { resolveWorkplaceContributions, type WorkplaceYear } from '../../../src/engine/tax/workplace';
import { calculatePayroll, type PayrollYear } from '../../../src/engine/tax/payroll';
import { loadReferences } from '../../helpers/references';
import { mustValidate } from '../../helpers/plans';

interface PayrollReferenceInput { readonly plan: PlanDocument; readonly cash: CashYear; readonly requests: readonly ContributionRequest[]; readonly rules: YearRules }
interface PayrollReferenceExpected { readonly workplace: WorkplaceYear; readonly payroll: PayrollYear }
const references = loadReferences<PayrollReferenceInput, PayrollReferenceExpected>('payroll-2026');
const sample = () => structuredClone(references.find(c => c.id === 'catchup-age-50')!.input);

describe('owner retirement deferrals and payroll liabilities', () => {
  it.each(references)('$id', c => {
    const i = c.input;
    const w = resolveWorkplaceContributions(mustValidate(i.plan), i.cash, i.requests, i.rules);
    expect(w).toEqual(c.expected.workplace);
    expect(calculatePayroll(i.cash, w, i.rules)).toEqual(c.expected.payroll);
  });
  it('preserves $15,500 of prevented combined regular contributions in cash', () => {
    const i = references.find(c => c.id === 'combined-traditional-roth-regular-limit')!.input;
    const result = resolveWorkplaceContributions(mustValidate(i.plan), i.cash, i.requests, i.rules);
    expect(result.records.map(r => r.eligibleCents)).toEqual([{ status: 'available', value: 2000000 }, { status: 'available', value: 450000 }]);
    expect(result.records.map(r => r.preventedCents)).toEqual([{ status: 'available', value: 0 }, { status: 'available', value: 1550000 }]);
    expect(result.federalIncomeTaxWageReductionCents).toEqual({ status: 'available', value: 2000000 });
    expect(calculatePayroll(i.cash, result, i.rules).annual.socialSecurityCents).toBe(1143900);
  });
  it('sorts requests by month, priority and stable rule ID without mutating input', () => {
    const i = structuredClone(references.find(c => c.id === 'combined-traditional-roth-regular-limit')!.input);
    const reversed = [...i.requests].reverse();
    const before = JSON.stringify(reversed);
    const result = resolveWorkplaceContributions(mustValidate(i.plan), i.cash, reversed, i.rules);
    expect(result.records.map(r => r.ruleId)).toEqual(['traditional-rule', 'roth-rule']);
    expect(JSON.stringify(reversed)).toBe(before);
  });
  it('breaks tied priorities by stable rule ID and changes the pre-tax reduction visibly', () => {
    const i = structuredClone(references.find(c => c.id === 'combined-traditional-roth-regular-limit')!.input);
    const plan = { ...i.plan, contributions: i.plan.contributions.map(r => ({ ...r, priority: 1 })) };
    const requests = i.requests.map(r => ({ ...r, priority: 1 }));
    const result = resolveWorkplaceContributions(mustValidate(plan), i.cash, requests, i.rules);
    expect(result.records.map(r => r.ruleId)).toEqual(['roth-rule', 'traditional-rule']);
    expect(result.federalIncomeTaxWageReductionCents).toEqual({ status: 'available', value: 450000 });
  });
  it('leaves catch-up eligibility unavailable when sponsoring prior-year wages are missing', () => {
    const i = sample();
    const first = i.plan.household.filers[0];
    const plan: PlanDocument = { ...i.plan, household: { ...i.plan.household, filers: [{ ...first, employerAssumptionsByYear: [{ ...first.employerAssumptionsByYear[0]!, priorYearWagesCents: { known: false } }] }, i.plan.household.filers[1]] } };
    const result = resolveWorkplaceContributions(mustValidate(plan), i.cash, i.requests, i.rules);
    expect(result.records[0]?.eligibleCents).toMatchObject({ status: 'needs-data' });
    expect(result.records[0]?.eligibleCents).not.toHaveProperty('value');
    expect(result.federalIncomeTaxWageReductionCents.status).toBe('needs-data');
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'required-employer-history', recordId: 'catchup-rule', year: 2026 })]));
    expect(calculatePayroll(i.cash, result, i.rules).annual.socialSecurityCents).toBe(1143900);
  });
  it('propagates unknown earlier owner eligibility to overlapping later limits', () => {
    const i = sample();
    const first = i.plan.household.filers[0];
    const plan: PlanDocument = { ...i.plan, household: { ...i.plan.household, filers: [{ ...first, birthDate: { known: false } }, i.plan.household.filers[1]] }, contributions: [...i.plan.contributions, { ...i.plan.contributions[0]!, id: 'later-rule', priority: 2 }] };
    const requests = [...i.requests, { ...i.requests[0]!, ruleId: 'later-rule', priority: 2 }];
    const result = resolveWorkplaceContributions(mustValidate(plan), i.cash, requests, i.rules);
    expect(result.records.map(r => r.eligibleCents.status)).toEqual(['needs-data', 'needs-data']);
  });
  it('prevents catch-up when the plan explicitly does not offer it', () => {
    const i = sample();
    const first = i.plan.household.filers[0];
    const plan: PlanDocument = { ...i.plan, household: { ...i.plan.household, filers: [{ ...first, employerAssumptionsByYear: [{ ...first.employerAssumptionsByYear[0]!, planCatchUpAvailable: { known: true, value: false } }] }, i.plan.household.filers[1]] } };
    const result = resolveWorkplaceContributions(mustValidate(plan), i.cash, i.requests, i.rules);
    expect(result.records[0]?.eligibleCents).toEqual({ status: 'available', value: 2450000 });
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'catchup-not-offered' })]));
  });
  it('caps funding to wages from the sponsoring employer instead of another employer', () => {
    const i = sample();
    const cash: CashYear = { ...i.cash, wages: [{ ...i.cash.wages[0]!, annualCents: 10000, monthlyCents: [10000, ...Array<number>(11).fill(0)] }, { ownerId: 'owner-a', employerId: 'unrelated-employer', annualCents: 10000000, monthlyCents: [10000000, ...Array<number>(11).fill(0)], streamIds: [] }] };
    const result = resolveWorkplaceContributions(mustValidate(i.plan), cash, i.requests, i.rules);
    expect(result.records[0]?.eligibleCents).toEqual({ status: 'available', value: 10000 });
  });
  it('caps an above-100% salary request to sponsoring monthly wages', () => {
    const i = sample();
    const plan = { ...i.plan, contributions: i.plan.contributions.map(r => ({ ...r, amount: { kind: 'salary-percent' as const, salaryId: 'salary-employer-a', percentBps: 20000 } })) };
    const cash: CashYear = { ...i.cash, wages: [{ ...i.cash.wages[0]!, annualCents: 10000, monthlyCents: [10000, ...Array<number>(11).fill(0)] }] };
    const requests = [{ ...i.requests[0]!, requestedCents: 20000 }];
    expect(resolveWorkplaceContributions(mustValidate(plan), cash, requests, i.rules).records[0]?.eligibleCents).toEqual({ status: 'available', value: 10000 });
  });
  it('returns an unsupported contribution result for conflicting sponsor facts', () => {
    const i = sample();
    const requests = [{ ...i.requests[0]!, employerId: 'other-employer' }];
    const result = resolveWorkplaceContributions(mustValidate(i.plan), i.cash, requests, i.rules);
    expect(result.records[0]?.eligibleCents.status).toBe('unsupported-case');
    expect(result.records[0]?.eligibleCents).not.toHaveProperty('value');
  });
  it('retains non-workplace requests for IRA eligibility resolution', () => {
    const i = sample();
    const plan: PlanDocument = { ...i.plan, accounts: [...i.plan.accounts, { ...i.plan.accounts[0]!, id: 'ira', type: 'traditional-ira' }], contributions: [...i.plan.contributions, { id: 'ira-rule', accountId: 'ira', priority: 2, startDate: '2026-01-01', amount: { kind: 'fixed', monthlyCents: 10000 } }] };
    const request = { ruleId: 'ira-rule', accountId: 'ira', ownerId: 'owner-a', year: 2026, month: 1, priority: 2, requestedCents: 10000 };
    expect(resolveWorkplaceContributions(mustValidate(plan), i.cash, [...i.requests, request], i.rules).remainingRequests).toEqual([request]);
  });
  it('reconciles cumulative monthly payroll across the wage cap and joint threshold', () => {
    const i = references.find(c => c.id === 'two-owners-payroll')!.input;
    const spread = i.cash.wages.map(row => ({ ...row, monthlyCents: [1666667, 1666666, 1666667, 1666667, 1666666, 1666667, 1666667, 1666666, 1666667, 1666667, 1666666, 1666667] }));
    const cash = { ...i.cash, wages: spread };
    const w = resolveWorkplaceContributions(mustValidate(i.plan), cash, [], i.rules);
    const payroll = calculatePayroll(cash, w, i.rules);
    expect(payroll.annual).toEqual({ socialSecurityCents: 2287800, medicareCents: 580000, additionalMedicareCents: 135000, sdiCents: 520000, totalCents: 3522800 });
    for (const key of ['socialSecurityCents', 'medicareCents', 'additionalMedicareCents', 'sdiCents', 'totalCents'] as const) expect(payroll.months.reduce((sum, month) => sum + month[key], 0)).toBe(payroll.annual[key]);
    expect(payroll.months[0]?.additionalMedicareCents).toBe(0);
    expect(payroll.months[11]?.socialSecurityCents).toBeLessThan(payroll.months[0]!.socialSecurityCents);
  });
});
