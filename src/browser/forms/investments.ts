import { renderField, renderHistory, renderRecordSection, type FieldContext } from '../fields';
import type { WorkspaceController } from '../state';

export function renderInvestmentsForm(root: HTMLElement, controller: WorkspaceController): void {
  root.replaceChildren(); const accounts = document.createElement('section'), contributions = document.createElement('section'); root.append(accounts, contributions);
  const plan = controller.getState().savedPlan, owners = plan.household.filers.map(f => ({ value: f.id, label: f.name }));
  renderRecordSection(accounts, controller, 'accounts', 'Account', (body, ctx) => {
    renderField(body, ctx, ['name'], 'Account name'); renderField(body, ctx, ['ownerId'], 'Account owner', { kind: 'select', options: owners });
    renderField(body, ctx, ['type'], 'Account type', { kind: 'select', options: [{ value: 'taxable-brokerage', label: 'Taxable brokerage' }, { value: 'traditional-401k', label: 'Traditional 401(k)' }, { value: 'roth-401k', label: 'Roth 401(k)' }, { value: 'traditional-ira', label: 'Traditional IRA' }, { value: 'roth-ira', label: 'Roth IRA' }], refresh: true });
    renderField(body, ctx, ['openingBalanceCents'], 'Account opening balance ($)', { kind: 'money' });
    renderField(body, ctx, ['annualGrowthBps'], 'Effective annual account return (%)', { kind: 'rate', hint: 'Unrealized growth; deposits enter at month end and grow in later months.' });
    if (ctx.draft.value.type === 'traditional-ira') renderHistory(body, ctx, ['openingIraBasis'], 'Opening traditional IRA basis', { kind: 'money', hint: 'Known zero differs from unknown; basis is not the account balance.' });
  });
  renderRecordSection(contributions, controller, 'contributions', 'Contribution', (body, ctx) => {
    renderField(body, ctx, ['accountId'], 'Contribution account', { kind: 'select', options: [{ value: '', label: 'Choose a saved account' }, ...plan.accounts.map(a => ({ value: a.id, label: a.name }))], refresh: true });
    renderField(body, ctx, ['priority'], 'Contribution priority', { kind: 'integer', hint: 'Lower numbers receive the owner’s shared legal limit first; ties use stable record order.' });
    renderField(body, ctx, ['startDate'], 'Contribution start date', { kind: 'date' }); renderField(body, ctx, ['endDate'], 'Contribution end date', { kind: 'date', optional: true });
    const choice: FieldContext = { ...ctx, get draft() { return ctx.draft; }, onChange(_p, value) { ctx.onChange(['amount'], value === 'fixed' ? { kind: 'fixed', monthlyCents: '' } : { kind: 'salary-percent', salaryId: plan.salaries[0]?.id ?? '', percentBps: '' }); } };
    renderField(body, choice, ['amount', 'kind'], 'Contribution amount mode', { kind: 'select', options: [{ value: 'fixed', label: 'Fixed monthly dollars' }, { value: 'salary-percent', label: 'Percentage of gross salary' }], refresh: true });
    if ((ctx.draft.value.amount as { kind?: string })?.kind === 'fixed') renderField(body, ctx, ['amount', 'monthlyCents'], 'Monthly contribution ($)', { kind: 'money' });
    else {
      renderField(body, ctx, ['amount', 'salaryId'], 'Contribution salary', { kind: 'select', options: [{ value: '', label: 'Choose a salary' }, ...plan.salaries.map(s => ({ value: s.id, label: s.name }))] });
      renderField(body, ctx, ['amount', 'percentBps'], 'Salary contribution (%)', { kind: 'rate' });
    }
    const account = plan.accounts.find(a => a.id === ctx.draft.value.accountId);
    if (account?.type === 'traditional-401k' || account?.type === 'roth-401k') renderField(body, ctx, ['sponsoringSalaryId'], 'Sponsoring salary', { kind: 'select', options: [{ value: '', label: 'Choose the sponsoring employer’s salary' }, ...plan.salaries.filter(s => s.ownerId === account.ownerId).map(s => ({ value: s.id, label: s.name }))], hint: 'The owner’s employer history determines catch-up eligibility.' });
  });
}
