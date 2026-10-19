import type {FormRenderOptions} from '../record-form';
import type {IssueViewContext} from '../issue-presentation';
import {element, renderField, renderHistory, renderRecordSection, renderRows, valueAt, type FieldContext} from '../fields';
import {fieldMemory} from '../record-ui-state';
import {renderEditorGroup} from '../ui/editor-groups';
import {parseRateInput} from '../input-parsers';
import type {RawObject, WorkspaceController} from '../state';

const questions: readonly [string, string][] = [['additionalIncome', 'Additional income outside these records'], ['additionalCredits', 'Additional household tax credits'], ['qualifiedDividendsOrCapitalGains', 'Qualified dividends or capital gains'], ['retirementDistributions', 'Retirement distributions'], ['priorFederalMinimumTaxCredits', 'Prior federal minimum-tax credits'], ['priorCaliforniaMinimumTaxCredits', 'Prior California minimum-tax credits']];
function unknownCount(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  if ('known' in value) return value.known === false ? 1 : 0;
  return Object.values(value).reduce<number>((sum, child) => sum + unknownCount(child), 0);
}

function retirementFields(root: HTMLElement, controller: WorkspaceController, context: FieldContext): void {
  for (let index = 0; index < 2; index++) {
    const group = element('fieldset'), prefix = `Filer ${index + 1}`, path = ['household', 'filers', index] as const;
    group.append(element('legend', prefix)); root.append(group);
    renderHistory(group, context, [...path, 'workplaceCoverage'], `${prefix} covered by workplace retirement plan`, {kind: 'checkbox'});
    renderHistory(group, context, [...path, 'seniorDeductionSsnEligible'], `${prefix} eligible SSN for senior deduction`, {kind: 'checkbox'});
    renderRows(group, context, [...path, 'coverageByYear'], `${prefix} annual workplace coverage`, () => ({year: String(context.draft.value.startYear), workplaceCoverage: {known: false}}), (row, rowPath, i) => {
      renderField(row, context, [...rowPath, 'year'], `${prefix} coverage year ${i + 1}`, {kind: 'integer'});
      renderHistory(row, context, [...rowPath, 'workplaceCoverage'], `${prefix} workplace coverage ${i + 1}`, {kind: 'checkbox'});
    });
    renderRows(group, context, [...path, 'employerAssumptionsByYear'], `${prefix} employer catch-up facts`, () => ({year: String(context.draft.value.startYear), employerId: '', priorYearWagesCents: {known: false}, planCatchUpAvailable: {known: false}, rothCatchUpAvailable: {known: false}}), (row, rowPath, i) => {
      renderField(row, context, [...rowPath, 'year'], `${prefix} employer year ${i + 1}`, {kind: 'integer'});
      const options = [{value: '', label: 'Choose an employer from Income'}, ...controller.getState().savedPlan.salaries.filter(salary => salary.ownerId === controller.getState().savedPlan.household.filers[index]!.id).map(salary => ({value: salary.employerId, label: `${salary.name} · ${salary.employerId}`}))];
      const current = valueAt(context.draft.value, rowPath) as RawObject;
      if (typeof current.employerId === 'string' && !options.some(option => option.value === current.employerId)) options.push({value: current.employerId, label: current.employerId});
      renderField(row, context, [...rowPath, 'employerId'], `${prefix} employer ${i + 1}`, {kind: 'select', options, hint: 'Use the employer linked to the sponsoring salary.'});
      renderHistory(row, context, [...rowPath, 'priorYearWagesCents'], `${prefix} prior-year employer wages ${i + 1} ($)`, {kind: 'money'});
      renderHistory(row, context, [...rowPath, 'planCatchUpAvailable'], `${prefix} employer offers catch-up ${i + 1}`, {kind: 'checkbox'});
      renderHistory(row, context, [...rowPath, 'rothCatchUpAvailable'], `${prefix} employer offers Roth catch-up ${i + 1}`, {kind: 'checkbox'});
    });
  }
}

export function renderHouseholdFields(root: HTMLElement, controller: WorkspaceController, context: FieldContext): void {
  const memory = fieldMemory(context);
  const advanced = (id: string, label: string, summary: () => string, render: (body: HTMLElement) => void) => {
    const group = renderEditorGroup(root, {id, label, advanced: !!context.memory, summary}, memory, render);
    const update = () => {const heading = group.querySelector('summary,h3'); if (heading) heading.textContent = `${label} · ${summary()}`;};
    group.addEventListener('input', update); group.addEventListener('change', update);
  };
  renderEditorGroup(root, {id: 'household-basics', label: 'People and forecast', advanced: false}, memory, body => {
    renderField(body, context, ['startYear'], 'Projection start year', {kind: 'integer'});
    renderField(body, context, ['horizonYears'], 'Projection years', {kind: 'integer', hint: '1–40 years.'});
    renderField(body, context, ['openingCashCents'], 'Opening cash reserve ($)', {kind: 'money', hint: 'Cash outside investment accounts on Jan 1.'});
    for (let index = 0; index < 2; index++) {
      const group = element('fieldset'), prefix = `Filer ${index + 1}`, path = ['household', 'filers', index] as const;
      group.append(element('legend', prefix)); body.append(group);
      renderField(group, context, [...path, 'name'], `${prefix} name`);
      renderHistory(group, context, [...path, 'birthDate'], `${prefix} birth date`, {kind: 'date'});
    }
  });
  advanced('household-retirement', 'Retirement and employer coverage', () => `${unknownCount(valueAt(context.draft.value, ['household', 'filers']))} unknown history facts`, body => retirementFields(body, controller, context));
  advanced('household-tax-coverage', 'Tax coverage', () => `${unknownCount(valueAt(context.draft.value, ['household', 'coverageAnswers']))} unanswered circumstances`, body => {
    body.append(element('p', 'These answers describe tax coverage. Child budgets do not establish tax-dependent eligibility.'));
    for (const [field, label] of questions) renderHistory(body, context, ['household', 'coverageAnswers', field], label, {kind: 'checkbox'});
  });
  advanced('household-tax-policy', 'Tax payments and future rules', () => {
    const rate = parseRateInput(String(valueAt(context.draft.value, ['taxPolicy', 'futureIndexGrowthBps']) ?? ''));
    const rows = valueAt(context.draft.value, ['taxPolicy', 'actualStateTaxPaidByYear']);
    return `${rate.status === 'available' ? `${rate.value / 100}% threshold growth` : 'Threshold growth needs input'} · ${Array.isArray(rows) ? rows.length : 0} actual payment years`;
  }, body => {
    renderField(body, context, ['taxPolicy', 'futureIndexGrowthBps'], 'Future tax threshold growth (%)', {kind: 'rate', hint: 'Annual increase assumed for tax thresholds after 2026.'});
    renderRows(body, context, ['taxPolicy', 'actualStateTaxPaidByYear'], 'actual state tax payment', () => ({year: String(context.draft.value.startYear), californiaIncomeTaxPaidCents: '', sdiPaidCents: ''}), (row, path, i) => {
      renderField(row, context, [...path, 'year'], `State tax payment year ${i + 1}`, {kind: 'integer'});
      renderField(row, context, [...path, 'californiaIncomeTaxPaidCents'], `California income tax actually paid ${i + 1} ($)`, {kind: 'money'});
      renderField(row, context, [...path, 'sdiPaidCents'], `SDI actually paid ${i + 1} ($)`, {kind: 'money'});
    });
  });
}

export function renderHouseholdForm(root: HTMLElement, controller: WorkspaceController, ui?: IssueViewContext, options?: FormRenderOptions): void {
  renderRecordSection(root, controller, 'household', 'Household', (body, context) => renderHouseholdFields(body, controller, context), undefined, ui, undefined, options);
}
