import {preloadWorkspace,readActivePlan,replaceScenarioFromJson} from './helpers/workspace';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { calculateProjection, loadRuleSet, type AnnualProjection, type Available, type PlanDocument } from '../../src/engine';
import { makeEstimatedMortgagePlan } from '../helpers/estimated-mortgage';
import { mustValidate } from '../helpers/plans';

/** Synthetic salaries, a mortgage, savings and two years of vesting; never personal data. */
function overviewPlan(): PlanDocument {
  return {
    ...makeEstimatedMortgagePlan(),
    horizonYears: 30,
    accounts: [
      { id: 'savings', name: 'Synthetic savings', ownerId: 'owner-a', type: 'taxable-brokerage', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: false } },
      {
        id: 'equity', name: 'Synthetic employer RSUs', ownerId: 'owner-a', type: 'rsu', openingBalanceCents: 0, annualGrowthBps: 0, openingIraBasis: { known: false },
        rsu: {
          employerId: 'employer-a', currentSharePriceCents: 10000,
          grants: [{ id: 'award', name: 'Synthetic award', startDate: '2025-12-01', grantValueCents: 2400000, grantSharePriceCents: 10000, vestingMonths: 24, vestingFrequency: 'monthly', cliffMonths: 0, withholdingBps: 2500, taxTreatment: 'settle-at-vest', openingHeldShares: 0, openingBasis: { known: true, value: 0 } }],
        },
      },
    ],
    contributions: [{ id: 'save-monthly', accountId: 'savings', priority: 1, startDate: '2026-01-01', amount: { kind: 'fixed', monthlyCents: 100000 } }],
  };
}

const money = (cents: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
function amount(field: Available<number>): number {
  if (field.status !== 'available') throw new Error(`Synthetic overview amount is ${field.status}`);
  return field.value;
}
function expectedYear(year: number): AnnualProjection {
  const row = calculateProjection(mustValidate(overviewPlan()), loadRuleSet()).years.find(row => row.year === year);
  if (!row) throw new Error(`Synthetic overview year ${year} is missing`);
  return row;
}
async function preload(page: Page): Promise<void> {
  await preloadWorkspace(page,overviewPlan());await page.getByLabel('Table view',{exact:true}).selectOption('financial-overview');await page.getByText('Forecast charts',{exact:true}).click();
}
async function expectPlotYear(page: Page, year: number, cashMetric: 'cash-flow' | 'cash-income' = 'cash-flow'): Promise<void> {
  await expect(page.getByRole('combobox', { name: 'Plot year', exact: true })).toHaveValue(String(year));
  const netWorth = await page.getByTestId(`summary-${year}-net-worth`).textContent();
  const cashAmount = await page.getByTestId(`summary-${year}-${cashMetric}`).textContent();
  await expect(page.getByTestId('plot-net-worth-readout')).toContainText(String(year));
  await expect(page.getByTestId('plot-net-worth-readout')).toContainText(netWorth!);
  await expect(page.getByTestId('plot-cash-flow-readout')).toContainText(String(year));
  await expect(page.getByTestId('plot-cash-flow-readout')).toContainText(cashAmount!);
}
async function expectFitsViewport(locator: Locator, page: Page): Promise<void> {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

test('shows every annual overview row and separates vested income, spendable cash and investment savings', async ({ page }) => {
  await preload(page);
  const table = page.getByRole('table', { name: 'Annual financial overview', exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(['Year', 'Net Worth', 'Total Income', 'Cash Income', 'Post Tax Income', 'Expenses', 'Cash Flow']);
  await expect(table.locator('tbody tr')).toHaveCount(30);
  await expect(table.locator('tbody th[scope="row"]')).toHaveText(Array.from({ length: 30 }, (_, index) => String(2026 + index)));

  // Salaries pay $240,000 cash. The 24-month $24,000 award vests $12,000
  // each year, of which $3,000 funds tax withholding and $9,000 stays in shares.
  for (const year of [2026, 2027]) {
    const row = expectedYear(year);
    const postTax = 24000000 + 300000 - amount(row.totalTaxCents);
    const expenses = 3600000 + amount(row.debtPaymentCents);
    const cashFlow = postTax - expenses;
    await expect(page.getByTestId(`summary-${year}-total-income`)).toHaveText('$252,000.00');
    await expect(page.getByTestId(`summary-${year}-cash-income`)).toHaveText('$240,000.00');
    await expect(page.getByTestId(`summary-${year}-post-tax-income`)).toHaveText(money(postTax));
    await expect(page.getByTestId(`summary-${year}-expenses`)).toHaveText(money(expenses));
    await expect(page.getByTestId(`summary-${year}-cash-flow`)).toHaveText(money(cashFlow));
    await expect(page.getByTestId(`summary-${year}-net-worth`)).toHaveText(money(amount(row.netWorthCents)));
    // Savings transfer to an account; they do not reduce this overview's cash flow.
    expect(amount(row.eligibleContributionCents)).toBe(1200000);
    expect(cashFlow - amount(row.cashFlowCents)).toBe(1200000);
  }
  await expect(page.getByTestId('summary-2028-total-income')).toHaveText('$240,000.00');
  await expect(page.getByTestId('summary-2028-cash-income')).toHaveText('$240,000.00');
  await expect(page.getByTestId('summary-2055-net-worth')).toHaveText(money(amount(expectedYear(2055).netWorthCents)));
});

test('keeps two accessible plots in sync through the native year picker and keyboard navigation', async ({ page }) => {
  await preload(page);
  const netWorth = page.getByRole('img', { name: 'Net worth over time', exact: true });
  const cash = page.getByRole('img', { name: 'Income, expenses and cash flow', exact: true });
  await expect(netWorth).toBeVisible();
  await expect(cash).toBeVisible();
  expect(await netWorth.evaluate(node => node.tagName.toLowerCase())).toBe('svg');
  expect(await cash.evaluate(node => node.tagName.toLowerCase())).toBe('svg');
  await expect(page.locator('figure').filter({ has: netWorth })).toHaveCount(1);
  await expect(page.locator('figure').filter({ has: cash })).toHaveCount(1);
  await expect(page.locator('figure').filter({ has: page.getByRole('img', { name: /^(Net worth over time|Income, expenses and cash flow)$/ }) })).toHaveCount(2);
  const picker = page.getByRole('combobox', { name: 'Plot year', exact: true });
  expect(await picker.evaluate(node => node.tagName.toLowerCase())).toBe('select');
  await expect(picker.locator('option')).toHaveText(Array.from({ length: 30 }, (_, index) => String(2026 + index)));
  await expectPlotYear(page, 2026);
  await picker.selectOption('2028');
  await expectPlotYear(page, 2028);

  await netWorth.focus();
  await expect(netWorth).toBeFocused();
  for (const [key, year] of [['ArrowRight', 2029], ['ArrowLeft', 2028], ['End', 2055], ['ArrowRight', 2055], ['Home', 2026], ['ArrowLeft', 2026]] as const) {
    await netWorth.press(key);
    await expectPlotYear(page, year);
  }
  await cash.focus();
  await expect(cash).toBeFocused();
  await cash.press('End');
  await expectPlotYear(page, 2055);
  await cash.press('Home');
  await expectPlotYear(page, 2026);
});

test('cash plot legend buttons toggle their plotted series with keyboard access and retain the selected year', async ({ page }) => {
  await preload(page);
  const cash = page.getByRole('img', { name: 'Income, expenses and cash flow', exact: true });
  const figure = cash.locator('xpath=ancestor::figure');
  for (const [label, series] of [['Total Income', 'total-income'], ['Cash Income', 'cash-income'], ['Post Tax Income', 'post-tax-income'], ['Expenses', 'expenses'], ['Cash Flow', 'cash-flow']] as const) {
    const button = figure.getByRole('button', { name: label, exact: true });
    const line = cash.locator(`[data-series="${series}"]`);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(line).toBeVisible();
    await button.focus();
    await button.press('Space');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(line).toBeHidden();
    await page.getByRole('combobox', { name: 'Plot year', exact: true }).selectOption('2028');
    await expectPlotYear(page, 2028, series === 'cash-flow' ? 'cash-income' : 'cash-flow');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(line).toBeHidden();
    await button.focus();
    await button.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(line).toBeVisible();
    await expectPlotYear(page, 2028);
  }
});

test('contains the annual table scroll and fits both plots in a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await preload(page);
  const table = page.getByRole('table', { name: 'Annual financial overview', exact: true });
  await expect(table).toBeVisible();
  const scroll = table.locator('..');
  const initial = await scroll.evaluate(node => ({
    clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: getComputedStyle(node).overflowX,
  }));
  expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
  expect(['auto', 'scroll']).toContain(initial.overflowX);
  await expectFitsViewport(scroll, page);
  await scroll.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  expect(await scroll.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  await page.getByTestId('summary-2026-cash-flow').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('summary-2026-cash-flow')).toBeInViewport();
  for (const title of ['Net worth over time', 'Income, expenses and cash flow']) {
    const chart = page.getByRole('img', { name: title, exact: true });
    await expect(chart).toBeVisible();
    await expectFitsViewport(chart, page);
    const clippedLabels = await chart.evaluate(node => {
      const bounds = (node as SVGSVGElement).viewBox.baseVal;
      return [...node.querySelectorAll<SVGTextElement>('text')].flatMap(label => {
        const box = label.getBBox();
        return box.x < bounds.x || box.y < bounds.y || box.x + box.width > bounds.x + bounds.width || box.y + box.height > bounds.y + bounds.height
          ? [label.textContent]
          : [];
      });
    });
    expect(clippedLabels, `${title} axis labels stay inside the SVG`).toEqual([]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});
