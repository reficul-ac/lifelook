import type {IssueViewContext} from '../issue-presentation';
import { renderField, renderRecordSection, renderRows, valueAt, type FieldContext } from '../fields';
import type { RawObject, WorkspaceController } from '../state';

export function renderIncomeForm(root: HTMLElement, controller: WorkspaceController, ui?:IssueViewContext): void {
  root.replaceChildren();
  const salaries = document.createElement('section'), other = document.createElement('section'); root.append(salaries, other);
  const owners = controller.getState().savedPlan.household.filers.map(f => ({ value: f.id, label: f.name }));
  renderRecordSection(salaries, controller, 'salaries', 'Salary', (body, ctx) => {
    renderField(body, ctx, ['name'], 'Salary name');
    renderField(body, ctx, ['ownerId'], 'Salary owner', { kind: 'select', options: owners });
    renderField(body, ctx, ['employerId'], 'Salary employer',{hint:'Use the same employer for salary-linked contributions and catch-up facts.'});
    renderField(body, ctx, ['annualGrossCents'], 'Annual gross salary ($)', { kind: 'money' });
    renderField(body, ctx, ['startDate'], 'Salary start date', { kind: 'date' });
    renderField(body, ctx, ['endDate'], 'Salary end date', { kind: 'date', optional: true, hint: 'Includes this date. Blank means no end.' });
    renderField(body, ctx, ['annualRaiseBps'], 'Annual salary raise (%)', { kind: 'rate' });
    renderField(body, ctx, ['raiseMonth'], 'Salary raise month', { kind: 'integer' });
    renderField(body, ctx, ['raiseDay'], 'Salary raise day', { kind: 'integer', hint: 'Shorter months use their last day.' });
    renderRows(body, ctx, ['changes'], 'salary change', () => ({ date: '', kind: 'percent', percentBps: '' }), (row, path, index) => {
      renderField(row, ctx, [...path, 'date'], `Salary change date ${index + 1}`, { kind: 'date' });
      const choice: FieldContext = { ...ctx, get draft() { return ctx.draft; }, onChange(p, value) {
        const current = valueAt(ctx.draft.value, path) as RawObject;
        ctx.onChange(path, { date: current.date, kind: value, ...(value === 'percent' ? { percentBps: '' } : { annualGrossCents: '' }) });
      } };
      renderField(row, choice, [...path, 'kind'], `Salary change type ${index + 1}`, { kind: 'select', options: [{ value: 'percent', label: 'Percentage raise' }, { value: 'amount', label: 'Set annual salary' }], refresh: true });
      const current = valueAt(ctx.draft.value, path) as RawObject;
      if (current.kind === 'percent') renderField(row, ctx, [...path, 'percentBps'], `Salary change percentage ${index + 1} (%)`, { kind: 'rate' });
      else renderField(row, ctx, [...path, 'annualGrossCents'], `Salary change annual amount ${index + 1} ($)`, { kind: 'money' });
    });
  },undefined,ui);
  renderRecordSection(other, controller, 'otherIncome', 'Other income', (body, ctx) => {
    renderField(body, ctx, ['name'], 'Income name');
    renderField(body, ctx, ['amountCents'], 'Income amount ($)', { kind: 'money' });
    renderField(body, ctx, ['frequency'], 'Income frequency', { kind: 'select', options: ['monthly', 'annual'] });
    renderField(body, ctx, ['startDate'], 'Income start date', { kind: 'date', hint: 'Payments repeat on this date each month or year.' });
    renderField(body, ctx, ['endDate'], 'Income end date', { kind: 'date', optional: true, hint:'Includes this date. Blank means no end.' });
    renderField(body, ctx, ['annualGrowthBps'], 'Income annual growth (%)', { kind: 'rate' });
    const choice: FieldContext = { ...ctx, get draft() { return ctx.draft; }, onChange(_p, value) {
      const next: RawObject = { ...ctx.draft.value, classification: value }; delete next.ownerId; delete next.employerId; delete next.niitTreatment;
      if (value === 'wage') { next.ownerId = owners[0]?.value ?? ''; next.employerId = ''; }
      if (value === 'ordinary-taxable') next.niitTreatment = 'unknown';
      ctx.onChange([], next);
    } };
    renderField(body, choice, ['classification'], 'Income classification', { kind: 'select', options: [{ value: 'wage', label: 'Wage income' }, { value: 'ordinary-taxable', label: 'Ordinary taxable income' }, { value: 'non-taxable', label: 'Non-taxable cash' }], refresh: true });
    if (ctx.draft.value.classification === 'wage') {
      renderField(body, ctx, ['ownerId'], 'Income owner', { kind: 'select', options: owners }); renderField(body, ctx, ['employerId'], 'Income employer');
    } else if (ctx.draft.value.classification === 'ordinary-taxable') {
      renderField(body, ctx, ['niitTreatment'], 'Income NIIT treatment', { kind: 'select', options: [{ value: 'unknown', label: 'Unknown' }, { value: 'included', label: 'Included: interest or ordinary dividends' }, { value: 'excluded', label: 'Excluded' }], hint: 'Qualified dividends and realized capital gains are unsupported.',help:'Net Investment Income Tax (NIIT) applies to eligible investment income; wages are excluded.' });
    }
  },undefined,ui);
}
