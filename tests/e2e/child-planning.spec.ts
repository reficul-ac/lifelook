import {preloadWorkspace,readActivePlan,replaceScenarioFromJson} from './helpers/workspace';
import { expect, test } from '@playwright/test';
import { makePlan } from '../helpers/plans';

test('saves independently dated children, reloads budgets, and restores a child backup', async ({ page }) => {
  await preloadWorkspace(page,makePlan());
  await page.getByRole('button', { name: 'Expenses and debts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Child planning', exact: true })).toBeVisible();
  const forms = page.locator('form[data-editable-section="children"]');
  for (const child of [{ name: 'First child', birthMonth: '2026-05' }, { name: 'Second child', birthMonth: '2026-09' }]) {
    await page.getByRole('button', { name: 'Add child', exact: true }).click();
    const form = forms.last();
    await form.getByLabel('Child name', { exact: true }).fill(child.name);
    await form.getByLabel('Child birth month', { exact: true }).fill(child.birthMonth);
    await expect(form.getByRole('checkbox', { name: 'Include full year at age 18' })).not.toBeChecked();
    await form.getByRole('button', { name: 'Save child', exact: true }).click();
  }
  await expect(page.getByTestId('summary-2026-expenses')).toHaveText('$9,000.00');
  await page.getByRole('button', { name: 'Show months for 2026', exact: true }).click();
  await expect(page.getByTestId('monthly-2026-04-expenses')).toHaveText('$0.00');
  await expect(page.getByTestId('monthly-2026-05-expenses')).toHaveText('$750.00');
  await expect(page.getByTestId('monthly-2026-09-expenses')).toHaveText('$1,500.00');
  const backup = JSON.stringify(await readActivePlan(page));
  expect(JSON.parse(backup).children).toEqual([
    expect.objectContaining({ name: 'First child', birthMonth: '2026-05', includeAge18: false }),
    expect.objectContaining({ name: 'Second child', birthMonth: '2026-09', includeAge18: false }),
  ]);
  await page.reload();
  await page.getByRole('button', { name: 'Expenses and debts', exact: true }).click();
  await expect(forms.nth(0).getByLabel('Child birth month', { exact: true })).toHaveValue('2026-05');
  await expect(forms.nth(1).getByLabel('Child birth month', { exact: true })).toHaveValue('2026-09');
  await forms.nth(0).getByRole('button', { name: 'Remove First child', exact: true }).click();
  await expect(page.getByTestId('summary-2026-expenses')).toHaveText('$3,000.00');
  await page.getByText('Backups and recovery', { exact: true }).click();
  await replaceScenarioFromJson(page,backup);
  await expect(forms).toHaveCount(2);
  await expect(page.getByTestId('summary-2026-expenses')).toHaveText('$9,000.00');
});

test('includes the complete age-18 year only when selected and stops at age 19', async ({ page }) => {
  const plan = makePlan({ horizonYears: 2, children: [{ id: 'child', name: 'Older child', birthMonth: '2008-06', includeAge18: false }] });
  await preloadWorkspace(page,plan);
  await page.getByRole('button', { name: 'Show months for 2026', exact: true }).click();
  await expect(page.getByTestId('monthly-2026-06-expenses')).toHaveText('$0.00');
  await page.getByRole('button', { name: 'Expenses and debts', exact: true }).click();
  const form = page.locator('form[data-editable-section="children"]');
  await form.getByRole('checkbox', { name: 'Include full year at age 18' }).check();
  await form.getByRole('button', { name: 'Save child', exact: true }).click();
  await expect(page.getByTestId('summary-2026-expenses')).toHaveText('$16,000.00');
  await page.getByRole('button', { name: 'Show months for 2026', exact: true }).click();
  await expect(page.getByTestId('monthly-2026-06-expenses')).toHaveText(/^\$1,333\.3[34]$/);
  await page.getByRole('button', { name: 'Show months for 2027', exact: true }).click();
  await expect(page.getByTestId('monthly-2027-05-expenses')).toHaveText(/^\$1,333\.3[34]$/);
  await expect(page.getByTestId('monthly-2027-06-expenses')).toHaveText('$0.00');
});
