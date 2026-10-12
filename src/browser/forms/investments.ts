import type {IssueViewContext} from '../issue-presentation';
import { renderField, renderHistory, renderRecordSection, type FieldContext } from '../fields';
import type { WorkspaceController } from '../state';

export function renderInvestmentsForm(root: HTMLElement, controller: WorkspaceController, ui?:IssueViewContext): void {
  root.replaceChildren(); const accounts = document.createElement('section'), contributions = document.createElement('section'); root.append(accounts, contributions);
  const plan = controller.getState().savedPlan, owners = plan.household.filers.map(f => ({ value: f.id, label: f.name }));
  renderRecordSection(accounts, controller, 'accounts', 'Account', (body, ctx) => {
    renderField(body, ctx, ['name'], 'Account name'); renderField(body, ctx, ['ownerId'], 'Account owner', { kind: 'select', options: owners });
    renderField(body, ctx, ['type'], 'Account type', { kind: 'select', options: [{ value: 'taxable-brokerage', label: 'Taxable brokerage' }, { value: 'traditional-401k', label: 'Traditional 401(k)' }, { value: 'roth-401k', label: 'Roth 401(k)' }, { value: 'traditional-ira', label: 'Traditional IRA' }, { value: 'roth-ira', label: 'Roth IRA' }], refresh: true });
    renderField(body, ctx, ['openingBalanceCents'], 'Account opening balance ($)', { kind: 'money' });
    renderField(body, ctx, ['annualGrowthBps'], 'Effective annual account return (%)', { kind: 'rate', hint: 'Deposits grow from the following month.',help:'An effective annual return becomes monthly compounded growth. Taxable account value growth is assumed unrealized and excludes separately entered cash dividends or interest.' });
    if (ctx.draft.value.type === 'traditional-ira') renderHistory(body, ctx, ['openingIraBasis'], 'After-tax IRA basis at forecast start ($)', { kind: 'money', hint: 'Different from account balance; enter 0 only if confirmed.' });
  },undefined,ui);
  renderRecordSection(contributions, controller, 'contributions', 'Contribution', (body, ctx) => {
    renderField(body, ctx, ['accountId'], 'Contribution account', { kind: 'select', options: [{ value: '', label: 'Choose a saved account' }, ...plan.accounts.map(a => ({ value: a.id, label: a.name }))], refresh: true });
    renderField(body, ctx, ['priority'], 'Contribution priority', { kind: 'integer', hint: 'Lower numbers receive available contribution limits first.',help:'Rules share the owner’s legal limits; ties follow stable record order. Contribution eligibility does not establish cash affordability.' });
    renderField(body, ctx, ['startDate'], 'Contribution start date', { kind: 'date' }); renderField(body, ctx, ['endDate'], 'Contribution end date', { kind: 'date', optional: true,hint:'Includes this date. Blank means no end.' });
    const choice: FieldContext = { ...ctx, get draft() { return ctx.draft; }, onChange(_p, value) { ctx.onChange(['amount'], value === 'fixed' ? { kind: 'fixed', monthlyCents: '' } : { kind: 'salary-percent', salaryId: plan.salaries[0]?.id ?? '', percentBps: '' }); } };
    renderField(body, choice, ['amount', 'kind'], 'Contribution amount mode', { kind: 'select', options: [{ value: 'fixed', label: 'Monthly amount' }, { value: 'salary-percent', label: '% of gross salary' }], refresh: true });
    if ((ctx.draft.value.amount as { kind?: string })?.kind === 'fixed') renderField(body, ctx, ['amount', 'monthlyCents'], 'Monthly contribution ($)', { kind: 'money' });
    else {
      renderField(body, ctx, ['amount', 'salaryId'], 'Contribution salary', { kind: 'select', options: [{ value: '', label: 'Choose a salary' }, ...plan.salaries.map(s => ({ value: s.id, label: s.name }))] });
      renderField(body, ctx, ['amount', 'percentBps'], 'Salary contribution (%)', { kind: 'rate' });
    }
    const account = plan.accounts.find(a => a.id === ctx.draft.value.accountId);
    if (account?.type === 'traditional-401k' || account?.type === 'roth-401k') renderField(body, ctx, ['sponsoringSalaryId'], 'Sponsoring salary', { kind: 'select', options: [{ value: '', label: 'Choose the sponsoring employer’s salary' }, ...plan.salaries.filter(s => s.ownerId === account.ownerId).map(s => ({ value: s.id, label: s.name }))], hint: 'Use this account owner’s sponsoring employer salary.' });
  },undefined,ui);
}
