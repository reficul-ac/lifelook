import {describe, expect, it} from 'vitest';
import {within} from '@testing-library/dom';
import {collectRecords, renderRecordCollection} from '../../src/browser/record-collections';
import {createWorkspace} from '../../src/browser/state';
import {makeAllocationPlan} from '../helpers/allocations';
import type {PlanDocument} from '../../src/engine/model/plan';

function collectionPlan(): PlanDocument {
  const base = makeAllocationPlan();
  return {
    ...base,
    openingCashCents: 123456,
    salaries: [{...base.salaries[0]!, annualRaiseBps: 300, annualRaiseCapCents: 15000000,
      endDate: '2027-06-30', changes: [{date: '2026-07-01', kind: 'percent', percentBps: 500}]}],
    otherIncome: [{id: 'interest', name: 'Interest', amountCents: 12500, frequency: 'annual',
      startDate: '2026-01-15', annualGrowthBps: 200, classification: 'ordinary-taxable', niitTreatment: 'unknown'}],
    accounts: [{...base.accounts[0]!, openingBalanceCents: 25000000, annualGrowthBps: 525,
      openingTaxableBasis: {known: true, value: 0}}, ...base.accounts.slice(1)],
    contributions: [
      {id: 'fixed', accountId: 'brokerage', priority: 1, startDate: '2026-02-01', amount: {kind: 'fixed', monthlyCents: 50000}},
      {id: 'percentage', accountId: 'workplace', priority: 2, startDate: '2026-01-01', sponsoringSalaryId: 'salary-a', amount: {kind: 'salary-percent', salaryId: 'salary-a', percentBps: 600}},
    ],
    expenses: [{id: 'living', name: 'Living costs', amountCents: 300000, frequency: 'monthly',
      startDate: '2026-01-01', endDate: '2026-12-31', annualGrowthBps: 250, use: 'personal', taxCategory: 'personal'}],
    debts: [{id: 'car', name: 'Car loan', openingBalanceCents: 2000000, aprBps: 625,
      monthlyPaymentCents: 40000, firstPaymentMonth: '2026-03'}],
    children: [{id: 'child', name: 'Child', birthMonth: '2020-05', includeAge18: true}],
    properties: [{id: 'home', name: 'Home', role: 'primary', purchaseDate: '2020-01-01',
      purchasePriceCents: 100000000, downPaymentCents: 100000000, openingValueCents: 120000000,
      appreciationBps: 200, appreciationOverrides: [], loans: []}],
  };
}

describe('compact record facts', () => {
  it('shows applied salary growth and identity while retaining an independent draft badge', () => {
    const controller = createWorkspace(collectionPlan(), localStorage);
    const draft = controller.getDraft('salaries', 'salary-a');
    controller.editDraft('salary-a', {...draft, value: {...draft.value, annualGrossCents: '900000.00',
      annualRaiseBps: '9.00', employerId: 'unfinished-employer', ownerId: 'owner-b'}});
    const root = document.createElement('div');
    renderRecordCollection(root, controller.getState(), 'income', () => {}, () => {});
    const salary = root.querySelector<HTMLElement>('[data-record-target="salaries:salary-a"]')!;
    expect(salary).toHaveTextContent('$100,000.00 / year');
    expect(salary).toHaveTextContent('Filer A');
    expect(salary).toHaveTextContent('employer-0');
    expect(salary).toHaveTextContent('3% annual raise');
    expect(salary).toHaveTextContent('January 1');
    expect(salary).toHaveTextContent('cap $150,000.00');
    expect(salary).toHaveTextContent('1 dated change');
    expect(salary).toHaveTextContent('2027-06-30');
    expect(salary).toHaveTextContent('Draft');
    expect(salary).not.toHaveTextContent('unfinished-employer');
    expect(salary).not.toHaveTextContent('$900,000.00');
    expect(within(salary).getByRole('button', {name: 'Edit salary-a'})).toBeTruthy();
  });

  it('identifies other-income classification and unanswered NIIT treatment', () => {
    const controller = createWorkspace(collectionPlan(), localStorage);
    const facts = collectRecords(controller.getState(), 'income').find(record => record.name === 'Interest')!.facts.join(' · ');
    expect(facts).toContain('$125.00 / year');
    expect(facts).toContain('Ordinary taxable income');
    expect(facts).toContain('NIIT treatment unknown');
    expect(facts).toContain('2026-01-15');
    expect(facts).toContain('2% annual growth');
  });

  it('distinguishes forecast-start account balance, return, confirmed zero basis and contribution modes', () => {
    const controller = createWorkspace(collectionPlan(), localStorage);
    const records = collectRecords(controller.getState(), 'accounts');
    const account = records.find(record => record.name === 'Stocks')!.facts.join(' · ');
    expect(account).toContain('Taxable brokerage');
    expect(account).toContain('Filer A');
    expect(account).toContain('$250,000.00 at January 1, 2026');
    expect(account).toContain('5.25% annual return');
    expect(account).toContain('Tax basis $0.00');
    const fixed = records.find(record => record.target.kind === 'record' && record.target.recordId === 'fixed')!.facts.join(' · ');
    const percentage = records.find(record => record.target.kind === 'record' && record.target.recordId === 'percentage')!.facts.join(' · ');
    expect(fixed).toContain('Stocks');
    expect(fixed).toContain('$500.00 / month');
    expect(fixed).toContain('2026-02-01');
    expect(percentage).toContain('401k');
    expect(percentage).toContain('6% of salary-a');
  });

  it('summarizes property use and spending schedules without expanding their forms', () => {
    const controller = createWorkspace(collectionPlan(), localStorage);
    const state = controller.getState();
    const property = collectRecords(state, 'properties')[0]!.facts.join(' · ');
    expect(property).toContain('Primary home');
    expect(property).toContain('$1,200,000.00 at January 1, 2026');
    expect(property).toContain('2% annual appreciation');
    const spending = collectRecords(state, 'spending');
    expect(spending.find(record => record.name === 'Living costs')!.facts.join(' · ')).toContain('2026-12-31');
    const debt = spending.find(record => record.name === 'Car loan')!.facts.join(' · ');
    expect(debt).toContain('$400.00 / month');
    expect(debt).toContain('6.25% APR');
    expect(debt).toContain('2026-03');
    expect(spending.find(record => record.name === 'Child')!.facts.join(' · ')).toContain('Age 18 included');
    expect(collectRecords(state, 'household')[0]!.facts.join(' · ')).toContain('$1,234.56 opening cash');
  });

  it('distinguishes RSU grants and held shares from an ordinary account balance', () => {
    const plan = collectionPlan();
    const controller = createWorkspace({...plan, accounts: [...plan.accounts, {
      id: 'equity', name: 'Employer equity', ownerId: 'owner-a', type: 'rsu', openingBalanceCents: 0,
      annualGrowthBps: 400, openingIraBasis: {known: false}, rsu: {employerId: 'employer-0',
        currentSharePriceCents: 1200, grants: [{id: 'grant', name: 'Grant', startDate: '2020-01-01',
          grantValueCents: 100000, grantSharePriceCents: 1000, vestingMonths: 48, vestingFrequency: 'annual',
          cliffMonths: 12, withholdingBps: 2200, taxTreatment: 'settle-at-vest', openingHeldShares: 12.5,
          openingBasis: {known: true, value: 10000}},
          {id: 'deferred-grant', name: 'Deferred grant', startDate: '2026-01-01',
            grantValueCents: 100000, grantSharePriceCents: 1000, vestingMonths: 48, vestingFrequency: 'annual',
            cliffMonths: 12, withholdingBps: 2200, taxTreatment: 'deferred', openingHeldShares: 0,
            openingBasis: {known: true, value: 0}}]},
    }]}, localStorage);
    const facts = collectRecords(controller.getState(), 'accounts').find(record => record.name === 'Employer equity')!.facts.join(' · ');
    expect(facts).toContain('Employer RSUs');
    expect(facts).toContain('2 grants');
    expect(facts).toContain('12.5 held shares');
    expect(facts).toContain('Deferred settlement');
    expect(facts).not.toContain('$0.00 at January 1');
  });

  it('keeps new unfinished values separate from applied summary facts', () => {
    const controller = createWorkspace(collectionPlan(), localStorage);
    const id = controller.beginAdd('accounts');
    const draft = controller.getDraft('accounts', id);
    controller.editDraft(id, {...draft, value: {...draft.value, name: 'Unfinished account', openingBalanceCents: '1.234'}});
    const record = collectRecords(controller.getState(), 'accounts').find(item => item.name === 'Unfinished account')!;
    expect(record.hasDraft).toBe(true);
    expect(record.facts).toContain('New · not applied');
    expect(record.facts.join(' · ')).not.toContain('1.234');
    expect(record.facts.join(' · ')).not.toContain('$0.00');
  });
});
