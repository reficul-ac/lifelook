import {preloadWorkspace,readActivePlan,replaceScenarioFromJson,openRecord,openCollection,applyEdit,openForecastDetails,showMonths} from './helpers/workspace';
import { expect, test } from '@playwright/test';
import { makePlan } from '../helpers/plans';

test('saves independently dated children, reloads budgets, and restores a child backup', async ({ page }) => {
  await preloadWorkspace(page,makePlan());
  await openCollection(page,'spending');
  const forms = page.locator('form[data-editable-section="children"]');
  for (const child of [{ name: 'First child', birthMonth: '2026-05' }, { name: 'Second child', birthMonth: '2026-09' }]) {
    await openCollection(page,'spending');await page.getByRole('button', { name: 'Add child', exact: true }).click();
    const form = forms.last();
    await form.getByLabel('Child name', { exact: true }).fill(child.name);
    await form.getByLabel('Child birth month', { exact: true }).fill(child.birthMonth);
    await expect(form.getByRole('checkbox', { name: 'Include full year at age 18' })).not.toBeChecked();
    await applyEdit(page);
  }
  await expect(page.getByTestId('summary-2026-expenses')).toHaveText('$9,000.00');
  await showMonths(page,2026);
  await expect(page.getByTestId('monthly-2026-04-expenses')).toHaveText('$0.00');
  await expect(page.getByTestId('monthly-2026-05-expenses')).toHaveText('$750.00');
  await expect(page.getByTestId('monthly-2026-09-expenses')).toHaveText('$1,500.00');
  const backup = JSON.stringify(await readActivePlan(page));
  expect(JSON.parse(backup).children).toEqual([
    expect.objectContaining({ name: 'First child', birthMonth: '2026-05', includeAge18: false }),
    expect.objectContaining({ name: 'Second child', birthMonth: '2026-09', includeAge18: false }),
  ]);
  await page.reload();
  await openCollection(page,'spending');
  const restoredChildren=(await readActivePlan(page)).children!;
  await openRecord(page,{kind:'record',section:'children',recordId:restoredChildren[1]!.id});
  await expect(forms.getByLabel('Child birth month',{exact:true})).toHaveValue('2026-09');
  await openRecord(page,{kind:'record',section:'children',recordId:restoredChildren[0]!.id});
  await expect(forms.getByLabel('Child birth month',{exact:true})).toHaveValue('2026-05');
  await page.getByRole('button',{name:'Remove record',exact:true}).click();
  await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByLabel('Table view',{exact:true}).selectOption('financial-overview');
  await expect(page.getByTestId('summary-2026-expenses')).toHaveText('$3,000.00');
  await replaceScenarioFromJson(page,backup);
  expect((await readActivePlan(page)).children).toHaveLength(2);await page.getByLabel('Table view',{exact:true}).selectOption('financial-overview');
  await expect(page.getByTestId('summary-2026-expenses')).toHaveText('$9,000.00');
});

test('includes the complete age-18 year only when selected and stops at age 19', async ({ page }) => {
  const plan = makePlan({ horizonYears: 2, children: [{ id: 'child', name: 'Older child', birthMonth: '2008-06', includeAge18: false }] });
  await preloadWorkspace(page,plan);
  await showMonths(page,2026);
  await expect(page.getByTestId('monthly-2026-06-expenses')).toHaveText('$0.00');
  await openCollection(page,'spending');
  await openRecord(page,{kind:'record',section:'children',recordId:'child'});const form = page.locator('form[data-editable-section="children"]');
  await form.getByRole('checkbox', { name: 'Include full year at age 18' }).check();
  await applyEdit(page);
  await expect(page.getByTestId('summary-2026-expenses')).toHaveText('$16,000.00');
  await showMonths(page,2026);
  await expect(page.getByTestId('monthly-2026-06-expenses')).toHaveText(/^\$1,333\.3[34]$/);
  await showMonths(page,2027);
  await expect(page.getByTestId('monthly-2027-05-expenses')).toHaveText(/^\$1,333\.3[34]$/);
  await expect(page.getByTestId('monthly-2027-06-expenses')).toHaveText('$0.00');
});
