import {preloadWorkspace,readActivePlan,replaceScenarioFromJson,openRecord,openSettings,applyEdit} from './helpers/workspace';
import { readFile, mkdir } from 'node:fs/promises';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { calculateProjection, loadRuleSet, type Account, type Available, type CashFlowAllocationYear, type PlanDocument } from '../../src/engine';
import { makePlan, mustValidate } from '../helpers/plans';

const screenshots = '/tmp/lifelook-allocation-acceptance';
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

/** Fictional students, zero growth, and explicitly non-taxable scenario receipts.
 * Literal oracles come from the independently reviewed acceptance tax worksheet:
 * $60k wages, $8,632 tax; capped workplace variants have $5,703 final tax.
 * 2027 uses the declared projected pack with zero index growth, not published law. */
function allocationPlan(): PlanDocument {
  const empty = makePlan();
  const account = (id: string, name: string, type: Account['type']): Account => ({
    id, name, ownerId: 'owner-a', type, openingBalanceCents: 0, annualGrowthBps: 0,
    openingIraBasis: { known: true, value: 0 },
  });
  return makePlan({
    horizonYears: 2,
    household: { ...empty.household, filers: [
      { ...empty.household.filers[0], workplaceCoverage: { known: true, value: true } }, empty.household.filers[1],
    ] },
    salaries: [{ id: 'salary-a', name: 'Synthetic salary', ownerId: 'owner-a', employerId: 'employer-a', annualGrossCents: 6000000,
      startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] }],
    otherIncome: [
      { id: 'cash-2026', name: 'Synthetic non-taxable cash 2026', amountCents: 10000000, frequency: 'annual',
        startDate: '2026-01-01', endDate: '2026-12-31', annualGrowthBps: 0, classification: 'non-taxable' },
      { id: 'cash-2027', name: 'Synthetic non-taxable cash 2027', amountCents: 20000000, frequency: 'annual',
        startDate: '2027-01-01', endDate: '2027-12-31', annualGrowthBps: 0, classification: 'non-taxable' },
    ],
    accounts: [account('stocks', 'Stocks', 'taxable-brokerage'), account('roth', 'Roth IRA', 'roth-ira'),
      account('excess-brokerage', 'Excess brokerage', 'taxable-brokerage'), account('workplace', 'Traditional 401(k)', 'traditional-401k')],
    cashFlowAllocation: { id: 'allocation', entries: [
      { id: 'stocks-target', priority: 0, destination: { kind: 'account', accountId: 'stocks' }, amount: { kind: 'percent', percentBps: 9300 } },
      { id: 'roth-maximum', priority: 1, destination: { kind: 'account', accountId: 'roth' }, amount: { kind: 'max-annual' } },
    ], overflow: { id: 'allocation-excess', destination: { kind: 'account', accountId: 'excess-brokerage' } } },
  });
}
function workplacePlan(monthlyCents: number): PlanDocument {
  const base = allocationPlan();
  return { ...base, contributions: [{ id: 'legacy-workplace', accountId: 'workplace', priority: 0, startDate: '2026-01-01',
    amount: { kind: 'fixed', monthlyCents }, sponsoringSalaryId: 'salary-a' }],
  cashFlowAllocation: { ...base.cashFlowAllocation!, entries: [
    { ...base.cashFlowAllocation!.entries[0]!, amount: { kind: 'percent', percentBps: 5000 } }, base.cashFlowAllocation!.entries[1]!,
  ], overflow: { id: 'allocation-excess', destination: { kind: 'account', accountId: 'workplace', sponsoringSalaryId: 'salary-a' } } } };
}
function available<T>(field: Available<T> | undefined): T {
  expect(field?.status).toBe('available');
  if (field?.status !== 'available') throw new Error('Synthetic amount must be available');
  return field.value;
}
/** Exercises only the public engine and asserts monthly cash/account conservation. */
function project(plan: PlanDocument) {
  const saved = structuredClone(plan), result = calculateProjection(mustValidate(plan), loadRuleSet());
  let reserve = plan.openingCashCents;
  for (const month of result.months) {
    const deposits = month.accounts.reduce((sum, account) => {
      const deposit = available(account.contributionCents);
      expect(available(account.closingCents)).toBe(available(account.openingCents) + deposit + available(account.growthCents));
      return sum + deposit;
    }, 0);
    expect(available(month.eligibleContributionCents)).toBe(deposits);
    reserve += available(month.salaryCents) + available(month.otherIncomeCents) - available(month.totalTaxCents) - available(month.expensesCents) - deposits;
    expect(available(month.reserveCents)).toBe(reserve);
    expect(reserve).toBeGreaterThanOrEqual(0);
  }
  for (const year of result.years) {
    const report = available(year.cashFlowAllocation);
    expect(report.originalCashFlowCents).toBe(available(year.salaryCents) + available(year.otherIncomeCents) - available(year.totalTaxCents) - available(year.expensesCents));
    expect(report.accounts.reduce((sum, a) => sum + a.actualCents, 0) + report.retainedCashCents).toBe(report.originalCashFlowCents);
    expect(available(year.eligibleContributionCents)).toBe(report.accounts.reduce((sum, a) => sum + a.actualCents, 0));
  }
  expect(plan).toEqual(saved);
  return result;
}
function baseOracles(plan = allocationPlan(), shared = false, existingStocks = 0) {
  const result = project(plan);
  const expected = [
    { year: 2026, total: 15136800, stocks: 14077224, excess: 309576, stockClosing: shared ? 14386800 : 14077224, excessClosing: shared ? 0 : 309576, netWorth: 15136800, share: '4.95%' },
    { year: 2027, total: 25136800, stocks: 23377224, excess: 1009576, stockClosing: shared ? 38773600 : 37454448, excessClosing: shared ? 0 : 1319152, netWorth: 40273600, share: '2.98%' },
  ];
  for (const [index, row] of result.years.entries()) {
    const want = expected[index]!, report = available(row.cashFlowAllocation);
    expect(available(row.federalIncomeTaxCents)).toBe(284300);
    expect(available(row.californiaIncomeTaxCents)).toBe(41900);
    expect(available(row.totalTaxCents)).toBe(863200);
    expect(report).toMatchObject({ originalCashFlowCents: want.total, excessOfferedCents: want.excess, excessAcceptedCents: want.excess, excessRetainedCents: 0, retainedCashCents: 0 });
    expect(report.accounts.find(a => a.accountId === 'stocks')).toMatchObject({ existingCents: existingStocks, percentageCents: want.stocks - existingStocks, excessCents: shared ? want.excess : 0, actualCents: want.stocks + (shared ? want.excess : 0) });
    expect(report.accounts.find(a => a.accountId === 'roth')).toMatchObject({ maximumCents: 750000, actualCents: 750000 });
    expect(available(row.accounts.find(a => a.accountId === 'stocks')!.closingCents)).toBe(want.stockClosing);
    expect(available(row.accounts.find(a => a.accountId === 'excess-brokerage')!.closingCents)).toBe(want.excessClosing);
    expect(available(row.accounts.find(a => a.accountId === 'roth')!.closingCents)).toBe(index === 0 ? 750000 : 1500000);
    expect(available(row.reserveCents)).toBe(0);
    expect(available(row.netWorthCents)).toBe(want.netWorth);
  }
  return expected;
}
async function preload(page: Page, plan: PlanDocument) {
  mustValidate(plan);
  await preloadWorkspace(page,plan);
  await openRecord(page,{kind:'allocation'});
  await expect(editor(page).locator('[data-allocation-status]')).toHaveText('Applied allocation');
}
const editor = (page: Page) => page.getByRole('form', { name: 'Cash flow allocation', exact: true });
const entry = (page: Page, index: number) => editor(page).locator('fieldset').nth(index);
const preview = (page: Page) => editor(page).locator('[data-allocation-preview]');
async function apply(page: Page, keyboard = false) {
  await expect(page.locator('[data-active-editor] [data-preview-status]')).not.toHaveAttribute('data-preview-status','pending');
  if(await page.locator('[data-active-editor] [data-preview-status]').getAttribute('data-preview-status')==='inactive')return;
  const button = page.locator('[data-active-editor] .editor-footer').getByRole('button', { name: 'Apply allocation', exact: true });
  if (keyboard) { await button.focus(); await button.press('Enter'); } else await button.click();
  await expect(editor(page).locator('[data-allocation-status]')).toHaveText('Applied allocation');
}
async function selectYear(page: Page, year: number) {
  await editor(page).getByLabel('Allocation year', { exact: true }).selectOption(String(year));
  await expect(preview(page)).toContainText(`Original cash flow · ${year}:`);
}
async function savedPlan(page: Page): Promise<PlanDocument> {
  return readActivePlan(page);
}
async function expectBaseUI(page: Page, plan = allocationPlan(), shared = false, existingStocks = 0) {
  for (const want of baseOracles(plan, shared, existingStocks)) {
    await selectYear(page, want.year);
    await expect(preview(page)).toContainText(`Original cash flow · ${want.year}: ${money(want.total)}`);
    await expect(entry(page, 1).locator('[data-allocation-readout]')).toContainText(`Actual funded: $7,500.00 · Actual share: ${want.share}`);
    await expect(preview(page)).toContainText(`Excess accepted: ${money(want.excess)}`);
    await expect(page.getByTestId(`summary-${want.year}-cash-flow`)).toHaveText(money(want.total));
    await expect(page.getByTestId(`summary-${want.year}-net-worth`)).toHaveText(money(want.netWorth));
    await expect(page.getByTestId(`annual-${want.year}-account-stocks-closing`)).toHaveText(money(want.stockClosing));
    await expect(page.getByTestId(`annual-${want.year}-account-roth-closing`)).toHaveText(want.year === 2026 ? '$7,500.00' : '$15,000.00');
    await expect(page.getByTestId(`annual-${want.year}-account-excess-brokerage-closing`)).toHaveText(money(want.excessClosing));
    await expect(preview(page).locator('[data-allocation-slice="stocks"]')).toHaveCount(1);
  }
}
async function capture(page: Page, filename: string) {
  await mkdir(screenshots, { recursive: true });
  if (filename === 'desktop-editor.png') await editor(page).screenshot({ path: `${screenshots}/${filename}` });
  else await page.screenshot({ path: `${screenshots}/${filename}` });
}
async function backup(page: Page) {
  await openSettings(page);const details = page.locator('[data-settings] details').filter({ has: page.getByText('Backups and recovery', { exact: true }) });
  if (!await details.evaluate(node => (node as HTMLDetailsElement).open)) await details.locator('summary').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export scenario JSON', exact: true }).click();
  const path = await (await download).path();
  expect(path).not.toBeNull();
  return readFile(path!, 'utf8');
}
async function fitsViewport(locator: Locator, page: Page) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

// Catches fixed computed maximum shares, duplicated excess posting, and year-picker saves.

test('applies 93% stocks with an automatic IRA maximum and posts shared excess once in each year', async ({ page }) => {
  await preload(page, allocationPlan());
  await entry(page, 0).getByLabel('Allocation percentage (%)', { exact: true }).fill('93.00');
  await entry(page, 1).getByLabel('Max out for the year', { exact: true }).uncheck();
  await entry(page, 1).getByLabel('Max out for the year', { exact: true }).check();
  await editor(page).getByLabel('Excess allocation account', { exact: true }).selectOption('account:excess-brokerage');
  await apply(page, true);
  const applied = await savedPlan(page);
  await expectBaseUI(page);
  expect(await savedPlan(page)).toEqual(applied);
  await capture(page, 'desktop-editor.png');
  await editor(page).getByLabel('Excess allocation account', { exact: true }).selectOption('account:stocks');
  await apply(page);
  const shared = { ...allocationPlan(), cashFlowAllocation: { ...allocationPlan().cashFlowAllocation!, overflow: { id: 'allocation-excess', destination: { kind: 'account' as const, accountId: 'stocks' } } } };
  await expectBaseUI(page, shared, true);
});

test('selects the cash account in native controls and restores reversed same-ID entries', async ({ page }) => {
  const base = allocationPlan(), plan = { ...base, accounts: [...base.accounts, { ...base.accounts[0]!, id: 'cash', name: 'Named cash brokerage' }] };
  await preload(page, plan);
  await entry(page, 0).getByLabel('Allocation destination', { exact: true }).selectOption({ label: 'Named cash brokerage' });
  await editor(page).getByLabel('Excess allocation account', { exact: true }).selectOption({ label: 'Named cash brokerage' });
  await apply(page);
  const saved = await savedPlan(page);
  expect(saved.cashFlowAllocation!.entries[0]!.destination).toEqual({ kind: 'account', accountId: 'cash' });
  expect(saved.cashFlowAllocation!.overflow.destination).toEqual({ kind: 'account', accountId: 'cash' });
  await expect(page.getByTestId('annual-2026-account-cash-closing')).toHaveText('$143,868.00');
  const exported = JSON.parse(await backup(page)) as PlanDocument;
  const restored = { ...exported, cashFlowAllocation: { ...exported.cashFlowAllocation!, entries: [...exported.cashFlowAllocation!.entries].reverse() } };
  await replaceScenarioFromJson(page,JSON.stringify(restored));await openRecord(page,{kind:'allocation'});
  await expect(editor(page).locator('[data-allocation-status]')).toHaveText('Applied allocation');
  await expect(entry(page, 0).locator('legend')).toHaveText('Allocation 1');
  await expect(entry(page, 0).getByLabel('Allocation destination', { exact: true }).locator('option:checked')).toHaveText('Roth IRA');
  await expect(entry(page, 1).getByLabel('Allocation destination', { exact: true }).locator('option:checked')).toHaveText('Named cash brokerage');
  await expect(editor(page).getByLabel('Excess allocation account', { exact: true }).locator('option:checked')).toHaveText('Named cash brokerage');
  await expect(entry(page, 1).getByLabel('Allocation percentage (%)', { exact: true })).toHaveAttribute('data-field', 'entries.1.amount.percentBps');
  expect(await savedPlan(page)).toEqual(restored);
});

// Catches adding a full percentage target on top of saved deposits to that account.
test('includes existing stocks deposits in the percentage target without changing their schedule', async ({ page }) => {
  const plan: PlanDocument = { ...allocationPlan(), contributions: [{ id: 'legacy-stocks', accountId: 'stocks', priority: 0,
    startDate: '2026-01-01', amount: { kind: 'fixed', monthlyCents: 10000 } }] };
  const result = project(plan);
  for (const [index, row] of result.years.entries()) {
    const stock = available(row.cashFlowAllocation).accounts.find(a => a.accountId === 'stocks')!;
    expect(stock).toMatchObject({ existingCents: 120000, percentageCents: index === 0 ? 13957224 : 23257224,
      targetCents: index === 0 ? 14077224 : 23377224, actualCents: index === 0 ? 14077224 : 23377224 });
    expect(result.contributions.filter(c => c.ruleId === 'legacy-stocks' && c.year === row.year)
      .map(c => [c.requestedCents, available(c.eligibleCents)])).toEqual(Array.from({ length: 12 }, () => [10000, 10000]));
  }
  await preload(page, plan);
  await expectBaseUI(page, plan, false, 120000);
  await expect(entry(page, 0).locator('[data-allocation-readout]')).toContainText('Existing deposits included: $1,200.00');
  expect((await savedPlan(page)).contributions).toEqual(plan.contributions);
});

// Catches consuming future legacy capacity, first-estimate taxes, and stale-year fallback details.
for (const monthly of [200000, 205000]) test(`retains refused workplace excess with ${monthly === 200000 ? 'partial' : 'zero'} capacity and protected legacy deposits`, async ({ page }) => {
  const plan = workplacePlan(monthly), result = project(plan);
  const wants = [
    { year: 2026, total: 15429700, stocks: 7714850, stockClosing: 7714850, offered: monthly === 200000 ? 4564850 : 4514850, retained: 4514850, cashClosing: 4514850, netWorth: 15429700 },
    { year: 2027, total: 25429700, stocks: 12714850, stockClosing: 20429700, offered: monthly === 200000 ? 9564850 : 9514850, retained: 9514850, cashClosing: 14029700, netWorth: 40859400 },
  ];
  for (const [index, row] of result.years.entries()) {
    const want = wants[index]!, r = available(row.cashFlowAllocation);
    expect(available(row.federalIncomeTaxCents)).toBe(33300);
    expect(available(row.californiaIncomeTaxCents)).toBe(0);
    expect(available(row.totalTaxCents)).toBe(570300);
    expect(r).toMatchObject({ originalCashFlowCents: want.total, excessOfferedCents: want.offered, excessAcceptedCents: monthly === 200000 ? 50000 : 0, excessRetainedCents: want.retained, retainedCashCents: want.retained });
    expect(r.accounts.find(a => a.accountId === 'workplace')).toMatchObject({ existingCents: monthly === 200000 ? 2400000 : 2450000, excessCents: monthly === 200000 ? 50000 : 0, actualCents: 2450000 });
    expect(r.accounts.find(a => a.accountId === 'stocks')!.actualCents).toBe(want.stocks);
    expect(r.accounts.find(a => a.accountId === 'roth')!.actualCents).toBe(750000);
    expect(available(row.accounts.find(a => a.accountId === 'stocks')!.closingCents)).toBe(want.stockClosing);
    expect(available(row.accounts.find(a => a.accountId === 'workplace')!.closingCents)).toBe(index === 0 ? 2450000 : 4900000);
    expect(available(row.reserveCents)).toBe(want.cashClosing);
    expect(available(row.netWorthCents)).toBe(want.netWorth);
    const legacy = result.contributions.filter(c => c.ruleId === 'legacy-workplace' && c.year === want.year);
    expect(legacy.map(c => available(c.eligibleCents))).toEqual(monthly === 200000 ? Array(12).fill(200000) : [...Array(11).fill(205000), 195000]);
  }
  // Start with a different destination, then use the native employer/sponsor controls.
  await preload(page, { ...plan, cashFlowAllocation: { ...plan.cashFlowAllocation!, overflow: allocationPlan().cashFlowAllocation!.overflow } });
  await editor(page).getByLabel('Excess allocation account', { exact: true }).selectOption('account:workplace');
  await editor(page).getByLabel('Excess sponsoring salary', { exact: true }).selectOption('salary-a');
  await apply(page);
  for (const want of wants) {
    await selectYear(page, want.year);
    await expect(preview(page)).toContainText(`Original cash flow · ${want.year}: ${money(want.total)}`);
    await expect(preview(page)).toContainText(`Excess accepted: ${monthly === 200000 ? '$500.00' : '$0.00'}`);
    await expect(preview(page)).toContainText(`Excess retained: ${money(want.retained)}`);
    await expect(page.getByTestId(`summary-${want.year}-cash-flow`)).toHaveText(money(want.total));
    await expect(page.getByTestId(`summary-${want.year}-net-worth`)).toHaveText(money(want.netWorth));
    await expect(page.getByTestId(`annual-${want.year}-account-workplace-closing`)).toHaveText(want.year === 2026 ? '$24,500.00' : '$49,000.00');
    const trigger = preview(page).getByRole('button', { name: `Cash retained details · ${want.year}`, exact: true });
    if (monthly === 200000 && want.year === 2026) {
      await trigger.click();
      await capture(page, 'desktop-initial-cash-fallback.png');
      await page.keyboard.press('Escape');
    }
    await trigger.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText(/confirmed contribution limit/);
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await trigger.focus();
    await trigger.press('Enter');
    const panel = page.getByRole('region', { name: `Cash retained · ${want.year}`, exact: true });
    await expect(panel).toContainText(`${want.year} · Traditional 401(k): excess offered ${money(want.offered)}, accepted ${monthly === 200000 ? '$500.00' : '$0.00'}, retained in cash ${money(want.retained)}`);
    await expect(panel).toContainText(/limit/);
    await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    if (monthly === 200000 && want.year === 2027) await capture(page, 'desktop-cash-fallback.png');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press('Space');
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    const outside = editor(page).getByLabel('Allocation year', { exact: true });
    await outside.click();
    await expect(panel).toBeHidden();
    await expect(outside).toBeFocused();
  }
});

// Task 4 literal: T=5,136,800; legacy=4,104,000; cash-first 50% reserves
// the remaining 1,032,800 and prevents lower percentages/maximum/excess from spending it.
test('protects explicit cash from lower stages and excludes opening reserves from the target', async ({ page }) => {
  const base = allocationPlan(), plan: PlanDocument = { ...base, horizonYears: 1, otherIncome: [], openingCashCents: 1000000,
    accounts: [...base.accounts, { ...base.accounts[0]!, id: 'legacy-brokerage', name: 'Legacy brokerage' }],
    contributions: [{ id: 'saved-legacy', accountId: 'legacy-brokerage', priority: 0, startDate: '2026-01-01', amount: { kind: 'fixed', monthlyCents: 342000 } }],
    cashFlowAllocation: { ...base.cashFlowAllocation!, entries: [
      { id: 'cash-target', priority: 0, destination: { kind: 'cash' }, amount: { kind: 'percent', percentBps: 5000 } },
      { ...base.cashFlowAllocation!.entries[0]!, priority: 1, amount: { kind: 'percent', percentBps: 5000 } },
      { ...base.cashFlowAllocation!.entries[1]!, priority: 2 },
    ] } };
  const row = project(plan).years[0]!, report = available(row.cashFlowAllocation);
  expect(report).toMatchObject({ originalCashFlowCents: 5136800, explicitCashTargetCents: 2568400, explicitCashCents: 1032800, explicitCashShortfallCents: 1535600, excessAcceptedCents: 0, retainedCashCents: 1032800 });
  expect(report.accounts.find(a => a.accountId === 'stocks')!.actualCents).toBe(0);
  expect(report.accounts.find(a => a.accountId === 'roth')!.actualCents).toBe(0);
  expect(available(row.accounts.find(a => a.accountId === 'legacy-brokerage')!.closingCents)).toBe(4104000);
  expect(available(row.reserveCents)).toBe(2032800);
  expect(available(row.netWorthCents)).toBe(6136800);
  await preload(page, plan);
  await expect(preview(page)).toContainText('Original cash flow · 2026: $51,368.00');
  await expect(entry(page, 0).locator('[data-allocation-readout]')).toContainText('Saving target: $25,684.00 · Actual earmark: $10,328.00');
  await expect(entry(page, 0).locator('[data-allocation-readout]')).toContainText('Shortfall: $15,356.00');
  await expect(entry(page, 2).locator('[data-allocation-readout]')).toContainText('Actual funded: $0.00');
  await expect(page.getByTestId('annual-2026-account-legacy-brokerage-closing')).toHaveText('$41,040.00');
  await expect(page.getByTestId('summary-2026-net-worth')).toHaveText('$61,368.00');
});

// Catches preview-induced focus/cursor loss, invalid text publication, draft export,
// leaked reports/computed percentages, restore draft retention, and reload reseeding.
test('keeps native edits stable and exports/restores only the applied maximum policy', async ({ page }) => {
  const plan = allocationPlan();
  await preload(page, plan);
  const percent = entry(page, 0).getByLabel('Allocation percentage (%)', { exact: true });
  const slider = entry(page, 0).getByLabel('Allocation percentage slider', { exact: true });
  await percent.fill('92.50');
  await percent.evaluate(node => (node as HTMLInputElement).setSelectionRange(2, 2));
  await expect(editor(page).locator('[data-allocation-status]')).toHaveText('Allocation preview · edits not applied');
  await expect(percent).toBeFocused();
  expect(await percent.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(2);
  await expect(slider).toHaveValue('92.5');
  await slider.focus(); await slider.press('ArrowRight');
  await expect(percent).toHaveValue('92.51');
  await percent.fill('invalid');
  await expect(editor(page).locator('[data-allocation-status]')).toContainText('Invalid allocation edits · Stale preview');
  await expect(percent).toHaveValue('invalid');
  expect(await savedPlan(page)).toEqual(plan);
  const exported = await backup(page);
  expect(JSON.parse(exported)).toEqual(plan);
  expect(JSON.parse(exported).cashFlowAllocation.entries[1].amount).toEqual({ kind: 'max-annual' });
  const discard = page.locator('[data-active-editor] .editor-footer').getByRole('button', { name: 'Discard edits', exact: true });
  await discard.focus(); await discard.press('Space');
  await expect(percent).toHaveValue('93.00');
  await percent.fill('50.00'); await apply(page);
  await percent.fill('40.00');
  await replaceScenarioFromJson(page,exported);await openRecord(page,{kind:'allocation'});
  await expect(editor(page).locator('[data-allocation-status]')).toHaveText('Applied allocation');
  await expect(percent).toHaveValue('93.00');
  expect(await savedPlan(page)).toEqual(plan);
  await expectBaseUI(page);
  await page.reload();
  await openRecord(page,{kind:'allocation'});
  expect(await savedPlan(page)).toEqual(plan);
  await expectBaseUI(page);
});

// A real touch context catches overlay clipping and mobile activation/focus errors.
test('fits the editor and cash fallback disclosure in a mobile touch viewport', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, baseURL: 'http://127.0.0.1:4174' });
  try {
    const page = await context.newPage();
    await preload(page, workplacePlan(200000));
    await selectYear(page, 2027);
    await fitsViewport(editor(page), page);
    await fitsViewport(preview(page).getByRole('img', { name: '2027 actual cash flow allocation', exact: true }), page);
    await fitsViewport(preview(page).locator('.allocation-table-wrap'), page);
    for (const label of ['Allocation year', 'Excess allocation account']) await fitsViewport(editor(page).getByLabel(label, { exact: true }), page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await editor(page).scrollIntoViewIfNeeded();
    await capture(page, 'mobile-editor.png');
    await preview(page).getByRole('img', { name: '2027 actual cash flow allocation', exact: true }).scrollIntoViewIfNeeded();
    await capture(page, 'mobile-pie.png');
    const trigger = preview(page).getByRole('button', { name: 'Cash retained details · 2027', exact: true });
    await trigger.tap();
    const panel = page.getByRole('region', { name: 'Cash retained · 2027', exact: true });
    await expect(panel).toContainText('accepted $500.00, retained in cash $95,148.50');
    await fitsViewport(panel, page);
    const box = await panel.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    expect(await panel.evaluate(node => getComputedStyle(node).overflowY)).toMatch(/auto|scroll/);
    await capture(page, 'mobile-cash-fallback.png');
    await panel.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally { await context.close(); }
});
