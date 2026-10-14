import {preloadWorkspace,readActivePlan,replaceScenarioFromJson} from './helpers/workspace';
import { expect, test } from '@playwright/test';
import { makePlan } from '../helpers/plans';

// Catches missing saved cap effects, accidental capping of dated overrides,
// automatic pay cuts above the cap, and losing or restoring a cleared cap.
test('caps automatic salary growth, preserves a dated override and reloads optional cap edits', async ({ page }) => {
  const plan = makePlan({
    horizonYears: 5,
    salaries: [{ id: 'salary', name: 'Synthetic salary', ownerId: 'owner-a', employerId: 'employer',
      annualGrossCents: 12000000, startDate: '2026-01-01', annualRaiseBps: 1000,
      raiseMonth: 1, raiseDay: 1, changes: [] }],
  });
  await preloadWorkspace(page,plan);
  await page.getByRole('button', { name: 'Income', exact: true }).click();
  const form = page.locator('form[data-record-id="salary"]');
  const cap = form.getByLabel('Automatic salary raise cap ($)', { exact: true });
  await expect(cap).toHaveValue('');
  await cap.fill('140000.00');
  await form.getByRole('button', { name: 'Save salary', exact: true }).click();
  await expect(page.getByTestId('save-status')).toContainText('Inputs v1');
  for (const [year, amount] of [[2026, '$120,000.00'], [2027, '$132,000.00'], [2028, '$140,000.00'], [2029, '$140,000.00'], [2030, '$140,000.00']] as const) {
    await expect(page.getByTestId(`annual-${year}-gross-income`)).toHaveText(amount);
  }

  await form.getByRole('button', { name: 'Add salary change', exact: true }).click();
  await form.getByLabel('Salary change date 1', { exact: true }).fill('2029-01-01');
  await form.getByLabel('Salary change type 1', { exact: true }).selectOption('amount');
  await form.getByLabel('Salary change annual amount 1 ($)', { exact: true }).fill('160000.00');
  await form.getByRole('button', { name: 'Save salary', exact: true }).click();
  await expect(page.getByTestId('save-status')).toContainText('Inputs v2');
  await expect(page.getByTestId('annual-2029-gross-income')).toHaveText('$160,000.00');
  await expect(page.getByTestId('annual-2030-gross-income')).toHaveText('$160,000.00');

  await page.reload();
  await page.getByRole('button', { name: 'Income', exact: true }).click();
  await expect(cap).toHaveValue('140000.00');
  await expect(form.getByLabel('Salary change annual amount 1 ($)', { exact: true })).toHaveValue('160000.00');
  await expect(page.getByTestId('annual-2028-gross-income')).toHaveText('$140,000.00');
  await expect(page.getByTestId('annual-2030-gross-income')).toHaveText('$160,000.00');

  await cap.fill('119999.99');
  await form.getByRole('button', { name: 'Save salary', exact: true }).click();
  await expect(cap).toHaveValue('119999.99');
  await expect(cap).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('save-status')).toContainText('Inputs v2');
  await expect(page.getByTestId('annual-2030-gross-income')).toHaveText('$160,000.00');

  await cap.fill('');
  await form.getByRole('button', { name: 'Save salary', exact: true }).click();
  await expect(page.getByTestId('save-status')).toContainText('Inputs v3');
  await expect(page.getByTestId('annual-2028-gross-income')).toHaveText('$145,200.00');
  await expect(page.getByTestId('annual-2030-gross-income')).toHaveText('$176,000.00');
  const saved = await readActivePlan(page);
  expect(saved.salaries[0]).not.toHaveProperty('annualRaiseCapCents');
  await page.reload();
  await page.getByRole('button', { name: 'Income', exact: true }).click();
  await expect(cap).toHaveValue('');
  await expect(page.getByTestId('annual-2030-gross-income')).toHaveText('$176,000.00');
});
