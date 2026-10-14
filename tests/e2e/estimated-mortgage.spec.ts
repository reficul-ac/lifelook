import {preloadWorkspace,readActivePlan,replaceScenarioFromJson} from './helpers/workspace';
import { test, expect } from '@playwright/test';
import { makeEstimatedMortgagePlan } from '../helpers/estimated-mortgage';

test('a qualified estimated mortgage keeps forecast taxes, ratios and funding available after Save and reload', async ({ page }) => {
  await preloadWorkspace(page,makeEstimatedMortgagePlan());
  const money = /^\$[\d,]+\.\d{2}$/;
  for (const year of [2026, 2027, 2028]) {
    const federal = page.getByTestId(`annual-${year}-federal-income-tax`);
    const annual = federal.locator('xpath=ancestor::section[1]');
    await expect(federal).toHaveText(money);
    await expect(page.getByTestId(`annual-${year}-california-income-tax`)).toHaveText(money);
    await expect(page.getByTestId(`annual-${year}-cash-flow`)).toHaveText(money);
    await expect(page.getByTestId(`annual-${year}-gross-income`)).toHaveText('$240,000.00');
    for (const label of ['Tax / income', 'Cash flow / income']) {
      await expect(annual.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText(/^\d+(?:\.\d{1,2})?%$/);
    }
    await expect(annual.getByText('No modeled cash gap', { exact: true })).toBeVisible();
    await expect(annual.getByText('Funding unknown', { exact: true })).toHaveCount(0);
    await annual.getByRole('button', { name: `Tax explanation for ${year}`, exact: true }).click();
    const sources = page.locator(`#tax-explanation-${year}`).locator('details').filter({ has: page.locator('summary', { hasText: /^Sources and rule assumptions$/ }) }).first();
    await sources.locator('summary').click();
    await expect(sources.getByText(/Mortgage interest.*forecast estimates.*loan schedule/)).toBeVisible();
  }

  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const summary = page.locator('summary').filter({ hasText: /^Loan — Synthetic fixed mortgage/ });
  await expect(summary).toContainText('Opening balance estimated');
  await summary.click();
  await expect(page.getByText(/Saved opening balance: estimated; saved payment: estimated/)).toBeVisible();
  await expect(page.getByLabel('Opening mortgage balance history', { exact: true })).toHaveValue('unknown');
  await expect(page.getByLabel('Opening principal-and-interest payment history', { exact: true })).toHaveValue('unknown');
  await page.getByRole('button', { name: 'Save property', exact: true }).click();
  await expect(page.getByTestId('save-status')).toContainText('Inputs v1');
  await expect(page.getByTestId('annual-2026-federal-income-tax')).toHaveText(money);
  await page.reload();
  await expect(page.getByTestId('save-status')).toContainText('Inputs v1');
  await expect(page.getByTestId('annual-2028-federal-income-tax')).toHaveText(money);
  await expect(page.getByTestId('annual-2028-california-income-tax')).toHaveText(money);
});
