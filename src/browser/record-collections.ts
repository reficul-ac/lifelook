import {button, element} from './fields';
import {formatCents} from './views/issues';
import {editTargetKey} from './record-ui-state';
import type {EditTarget} from './edit-types';
import type {EditableSection, WorkspaceState} from './state';
import type {Destination} from './workspace-route';
import type {AccountType, PlanDocument, RecurringPayment} from '../engine/model/plan';

export const collectionSections: Readonly<Partial<Record<Destination, readonly [EditableSection, string][]>>> = {
  income: [['salaries', 'salary'], ['otherIncome', 'other income']],
  accounts: [['accounts', 'account'], ['contributions', 'contribution']],
  properties: [['properties', 'property']],
  spending: [['expenses', 'expense'], ['debts', 'debt'], ['children', 'child']],
  household: [['household', 'household']],
};

const accountTypes: Record<AccountType, string> = {
  'taxable-brokerage': 'Taxable brokerage', 'traditional-401k': 'Traditional 401(k)',
  'roth-401k': 'Roth 401(k)', 'traditional-ira': 'Traditional IRA', 'roth-ira': 'Roth IRA', rsu: 'Employer RSUs',
};
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const activeDates = (value: Pick<RecurringPayment, 'startDate' | 'endDate'>): string =>
  `From ${value.startDate}${value.endDate ? ` through ${value.endDate}` : ''}`;

/** Collection facts describe applied inputs; unfinished values remain in the editor. */
function appliedFacts(plan: PlanDocument, section: EditableSection, id: string): string[] {
  const owner = (ownerId: string) => plan.household.filers.find(filer => filer.id === ownerId)?.name ?? ownerId;
  const balanceDate = `January 1, ${plan.startYear}`;
  switch (section) {
    case 'salaries': {
      const salary = plan.salaries.find(record => record.id === id)!;
      const growth = [`${salary.annualRaiseBps / 100}% annual raise each ${months[salary.raiseMonth - 1]} ${salary.raiseDay}`];
      if (salary.annualRaiseCapCents !== undefined) growth.push(`cap ${formatCents(salary.annualRaiseCapCents)}`);
      if (salary.changes.length) growth.push(`${salary.changes.length} dated change${salary.changes.length === 1 ? '' : 's'}`);
      return [`${formatCents(salary.annualGrossCents)} / year`, `${owner(salary.ownerId)} · Employer ${salary.employerId}`, activeDates(salary), growth.join(' · ')];
    }
    case 'otherIncome': {
      const income = plan.otherIncome.find(record => record.id === id)!;
      const classification = {wage: 'Wage income', 'ordinary-taxable': 'Ordinary taxable income', 'non-taxable': 'Non-taxable cash'}[income.classification];
      const facts = [`${formatCents(income.amountCents)} / ${income.frequency === 'annual' ? 'year' : 'month'}`, classification, activeDates(income), `${income.annualGrowthBps / 100}% annual growth`];
      if (income.classification === 'wage') facts.push(`${owner(income.ownerId)} · Employer ${income.employerId}`);
      if (income.classification === 'ordinary-taxable') facts.push(income.niitTreatment === 'unknown' ? 'NIIT treatment unknown' : `NIIT ${income.niitTreatment}`);
      return facts;
    }
    case 'accounts': {
      const account = plan.accounts.find(record => record.id === id)!;
      const facts = [accountTypes[account.type], owner(account.ownerId)];
      if (account.type === 'rsu' && account.rsu) {
        const grants = account.rsu.grants;
        const heldShares = new Intl.NumberFormat('en-US', {maximumFractionDigits: 6}).format(grants.reduce((sum, grant) => sum + grant.openingHeldShares, 0));
        facts.push(`${grants.length} grant${grants.length === 1 ? '' : 's'} · ${heldShares} held shares`, `Employer ${account.rsu.employerId}`);
        if (grants.some(grant => grant.taxTreatment === 'deferred')) facts.push('Deferred settlement');
      } else {
        facts.push(`${formatCents(account.openingBalanceCents)} at ${balanceDate}`, `${account.annualGrowthBps / 100}% annual return`);
        const basis = account.type === 'taxable-brokerage' ? account.openingTaxableBasis : account.type === 'traditional-ira' ? account.openingIraBasis : undefined;
        if (account.type === 'taxable-brokerage' || account.type === 'traditional-ira') {
          const label = account.type === 'taxable-brokerage' ? 'Tax basis' : 'IRA basis';
          facts.push(basis?.known ? `${label} ${formatCents(basis.value)}` : `${label} unknown`);
        }
      }
      return facts;
    }
    case 'contributions': {
      const contribution = plan.contributions.find(record => record.id === id)!;
      const amount = contribution.amount;
      const salary = amount.kind === 'salary-percent' ? plan.salaries.find(record => record.id === amount.salaryId) : undefined;
      return [plan.accounts.find(account => account.id === contribution.accountId)?.name ?? contribution.accountId,
        amount.kind === 'fixed' ? `${formatCents(amount.monthlyCents)} / month` : `${amount.percentBps / 100}% of ${salary?.name ?? amount.salaryId}`,
        activeDates(contribution), `Priority ${contribution.priority}`];
    }
    case 'properties': {
      const property = plan.properties.find(record => record.id === id)!;
      const future = property.purchaseDate > `${plan.startYear}-01-01`;
      const facts = [{primary: 'Primary home', rental: 'Rental property', 'primary-with-adu': 'Primary home + ADU'}[property.role],
        future ? `Purchase ${formatCents(property.purchasePriceCents)}` : `${formatCents(property.openingValueCents)} at ${balanceDate}`,
        `${future ? 'Purchase' : 'Purchased'} ${property.purchaseDate}`, `${property.appreciationBps / 100}% annual appreciation`];
      if (property.loans.length) facts.push(`${property.loans.length} loan${property.loans.length === 1 ? '' : 's'}`);
      const rentals = plan.rentals.filter(rental => rental.propertyId === id).length;
      if (rentals) facts.push(`${rentals} rental unit${rentals === 1 ? '' : 's'}`);
      if (property.aduProject) facts.push('ADU project');
      return facts;
    }
    case 'expenses': {
      const expense = plan.expenses.find(record => record.id === id)!;
      const facts = [`${formatCents(expense.amountCents)} / ${expense.frequency === 'annual' ? 'year' : 'month'}`, activeDates(expense),
        `${expense.annualGrowthBps / 100}% annual growth`, {personal: 'Personal spending', rental: 'Rental spending', shared: 'Shared spending'}[expense.use]];
      if (expense.taxCategory !== 'personal') facts.push(expense.taxCategory.replaceAll('-', ' '));
      const property = plan.properties.find(record => record.id === expense.propertyId);
      if (property) facts.push(property.name);
      return facts;
    }
    case 'debts': {
      const debt = plan.debts.find(record => record.id === id)!;
      return [`${formatCents(debt.openingBalanceCents)} at ${balanceDate}`, `${formatCents(debt.monthlyPaymentCents)} / month`, `${debt.aprBps / 100}% APR`, `First payment ${debt.firstPaymentMonth}`];
    }
    case 'children': {
      const child = plan.children!.find(record => record.id === id)!;
      return [`Born ${child.birthMonth}`, child.includeAge18 ? 'Age 18 included' : 'Through age 17'];
    }
    default: return [];
  }
}

export function collectRecords(state: WorkspaceState, destination: Destination): readonly {target: EditTarget; name: string; facts: readonly string[]; hasDraft: boolean; attentionCount: number}[] {
  const records: {target: EditTarget; name: string; facts: string[]; hasDraft: boolean; attentionCount: number}[] = [];
  for (const [section, label] of collectionSections[destination] ?? []) {
    if (section === 'household') {
      records.push({target: {kind: 'record', section, recordId: 'household'}, name: 'Household & forecast', facts: [state.savedPlan.household.filers.map(f => f.name).join(' & '), `${state.savedPlan.startYear}–${state.savedPlan.startYear + state.savedPlan.horizonYears - 1}`, `${formatCents(state.savedPlan.openingCashCents)} opening cash`], hasDraft: !!state.drafts.household, attentionCount: 0}); continue;
    }
    const applied = state.savedPlan[section] ?? [];
    const ids = [...new Set([...applied.map(r => r.id), ...Object.values(state.drafts).filter(d => d.section === section).map(d => d.recordId)])];
    for (const id of ids) {
      const record = applied.find(r => r.id === id) as unknown as Record<string, unknown> | undefined;
      const draft = state.drafts[id]; const value = record ?? (section === 'properties' ? draft?.value.property : draft?.value) as Record<string, unknown> | undefined;
      const facts = record ? appliedFacts(state.savedPlan, section, id) : ['New · not applied'];
      records.push({target: {kind: 'record', section, recordId: id}, name: String(value?.name ?? (section === 'contributions' ? 'Contribution' : `New ${label}`)), facts, hasDraft: !!draft, attentionCount: state.projection.issues.filter(i => i.recordId === id).length});
    }
  }
  if (destination === 'accounts') records.push({target: {kind: 'allocation'}, name: 'Cash flow allocation', facts: ['Direct available cash to your priorities'], hasDraft: !!state.allocationDraft, attentionCount: 0});
  return records;
}
export function renderRecordCollection(root: HTMLElement, state: WorkspaceState, destination: Destination, open: (target: EditTarget, origin: HTMLElement | null) => void, add: (section: EditableSection) => void): void {
  root.replaceChildren();
  const names = {overview: 'Overview', income: 'Income', accounts: 'Accounts', properties: 'Properties', spending: 'Spending & debts', household: 'Household'};
  const heading = element('h2', names[destination]); heading.tabIndex = -1; root.append(heading);
  const actions = element('div'); actions.className = 'collection-actions';
  for (const [section, label] of collectionSections[destination] ?? []) if (section !== 'household') actions.append(button(`Add ${label}`, () => add(section)));
  root.append(actions);
  const records = collectRecords(state, destination);
  if (!records.length) root.append(element('p', 'Add your first record to explore its effect on your forecast.'));
  for (const record of records) {
    const card = element('article'); card.className = 'record-summary'; card.dataset.recordTarget = editTargetKey(record.target);
    const text = element('div'); text.append(element('h3', record.name), element('p', record.facts.join(' · ')));
    if (record.hasDraft) text.append(element('small', 'Draft'));
    if (record.attentionCount) text.append(element('small', `${record.attentionCount} to review`));
    const edit = button('Edit', () => open(record.target, edit)); edit.dataset.openTarget = editTargetKey(record.target); edit.setAttribute('aria-label', `Edit ${record.name}`);
    card.append(text, edit); root.append(card);
  }
}
