import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { loadReferences } from '../helpers/references';
import type { Available, Cents, History, PlanDocument } from '../../src/engine';

interface ExpectedProjection { readonly years: readonly { netWorthCents: Available<Cents> }[]; readonly months: readonly { netWorthCents: Available<Cents> }[] }
const fixture = loadReferences<PlanDocument, ExpectedProjection>('projection').find(c => c.id === 'two-salaries-home-adu')!;
test.beforeEach(({ page }) => { page.setDefaultTimeout(15000); });
const dollars = (cents: number) => new Intl.NumberFormat('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
function formatExpectedCents(cents: Cents): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }
function known<T>(history: History<T>): T { if (!history.known) throw new Error('Acceptance fixture requires known history'); return history.value; }
const recordForm = (page: Page, save: string): Locator => page.getByRole('button', { name: save, exact: true }).last().locator('xpath=ancestor::form');
async function fill(scope: Locator, label: string, value: string | number) { await scope.getByLabel(label, { exact: true }).fill(String(value)); }
async function select(scope: Locator, label: string, value: string) { await scope.getByLabel(label, { exact: true }).selectOption(value); }
async function booleanHistory(scope: Locator, label: string, value: History<boolean>) {
  await select(scope, `${label} history`, value.known ? 'known' : 'unknown');
  if (value.known) await select(scope, `${label} answer`, String(value.value));
}
async function moneyHistory(scope: Locator, label: string, value: History<Cents>) {
  await select(scope, `${label} history`, value.known ? 'known' : 'unknown');
  if (value.known) await fill(scope, label, dollars(value.value));
}
async function selectFirst(scope: Locator, label: string) {
  const control = scope.getByLabel(label, { exact: true });
  const value = await control.locator('option').first().getAttribute('value');
  if (value === null) throw new Error('Missing native option');
  await control.selectOption(value);
}

/** Enter the synthetic oracle through native labeled controls and each record Save. */
async function enterAcceptancePlan(page: Page, plan: PlanDocument): Promise<void> {
  let form = recordForm(page, 'Save household');
  await fill(form, 'Projection start year', plan.startYear); await fill(form, 'Projection years', plan.horizonYears);
  await fill(form, 'Opening cash reserve ($)', dollars(plan.openingCashCents));
  for (let index = 0; index < 2; index++) {
    const filer = plan.household.filers[index]!, prefix = `Filer ${index + 1}`;
    await fill(form, `${prefix} name`, filer.name);
    await select(form, `${prefix} birth date history`, 'known'); await fill(form, `${prefix} birth date value`, known(filer.birthDate));
    await booleanHistory(form, `${prefix} covered by workplace retirement plan`, filer.workplaceCoverage);
    for (const [i, facts] of filer.employerAssumptionsByYear.entries()) {
      await form.getByRole('button', { name: `Add ${prefix} employer catch-up facts`, exact: true }).click();
      await fill(form, `${prefix} employer year ${i + 1}`, facts.year); await fill(form, `${prefix} employer ID ${i + 1}`, facts.employerId);
      const wages = `${prefix} prior-year employer wages ${i + 1} ($)`;
      await select(form, `${wages} history`, 'known'); await fill(form, `${wages} value`, dollars(known(facts.priorYearWagesCents)));
      await booleanHistory(form, `${prefix} employer offers catch-up ${i + 1}`, facts.planCatchUpAvailable);
      await booleanHistory(form, `${prefix} employer offers Roth catch-up ${i + 1}`, facts.rothCatchUpAvailable);
    }
  }
  const questions = { additionalIncome: 'Additional income outside these records', additionalCredits: 'Additional household tax credits', qualifiedDividendsOrCapitalGains: 'Qualified dividends or capital gains', retirementDistributions: 'Retirement distributions', priorFederalMinimumTaxCredits: 'Prior federal minimum-tax credits', priorCaliforniaMinimumTaxCredits: 'Prior California minimum-tax credits' } as const;
  for (const [key, label] of Object.entries(questions)) await booleanHistory(form, label, plan.household.coverageAnswers[key as keyof typeof questions]);
  await fill(form, 'Future tax threshold growth (%)', dollars(plan.taxPolicy.futureIndexGrowthBps));
  await form.getByRole('button', { name: 'Save household', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Income', exact: true }).click();
  for (const salary of plan.salaries) {
    await page.getByRole('button', { name: 'Add salary', exact: true }).click(); form = recordForm(page, 'Save salary record');
    await fill(form, 'Salary name', salary.name); await select(form, 'Salary owner', salary.ownerId); await fill(form, 'Salary employer', salary.employerId);
    await fill(form, 'Annual gross salary ($)', dollars(salary.annualGrossCents)); await fill(form, 'Salary start date', salary.startDate);
    await fill(form, 'Annual salary raise (%)', dollars(salary.annualRaiseBps)); await fill(form, 'Salary raise month', salary.raiseMonth); await fill(form, 'Salary raise day', salary.raiseDay);
    for (const [index, change] of salary.changes.entries()) {
      await form.getByRole('button', { name: 'Add salary change', exact: true }).click(); await fill(form, `Salary change date ${index + 1}`, change.date);
      await select(form, `Salary change type ${index + 1}`, change.kind);
      await fill(form, change.kind === 'percent' ? `Salary change percentage ${index + 1} (%)` : `Salary change annual amount ${index + 1} ($)`, dollars(change.kind === 'percent' ? change.percentBps : change.annualGrossCents));
    }
    await form.getByRole('button', { name: 'Save salary record', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Investments', exact: true }).click();
  for (const account of plan.accounts) {
    await page.getByRole('button', { name: 'Add account', exact: true }).click(); form = recordForm(page, 'Save account record');
    await fill(form, 'Account name', account.name); await select(form, 'Account owner', account.ownerId); await select(form, 'Account type', account.type);
    await fill(form, 'Account opening balance ($)', dollars(account.openingBalanceCents)); await fill(form, 'Effective annual account return (%)', dollars(account.annualGrowthBps));
    if (account.type === 'traditional-ira') { await select(form, 'Opening traditional IRA basis history', 'known'); await fill(form, 'Opening traditional IRA basis value', dollars(known(account.openingIraBasis))); }
    await form.getByRole('button', { name: 'Save account record', exact: true }).click();
  }
  for (const contribution of plan.contributions) {
    await page.getByRole('button', { name: 'Add contribution', exact: true }).click(); form = recordForm(page, 'Save contribution record');
    await form.getByLabel('Contribution account', { exact: true }).selectOption({ label: plan.accounts.find(a => a.id === contribution.accountId)!.name });
    await fill(form, 'Contribution priority', contribution.priority); await fill(form, 'Contribution start date', contribution.startDate);
    await select(form, 'Contribution amount mode', contribution.amount.kind);
    if (contribution.amount.kind === 'fixed') await fill(form, 'Monthly contribution ($)', dollars(contribution.amount.monthlyCents));
    else { await form.getByLabel('Contribution salary', { exact: true }).selectOption({ label: plan.salaries.find(s => s.id === (contribution.amount as { salaryId: string }).salaryId)!.name }); await fill(form, 'Salary contribution (%)', dollars(contribution.amount.percentBps)); }
    if (contribution.sponsoringSalaryId) await form.getByLabel('Sponsoring salary', { exact: true }).selectOption({ label: plan.salaries.find(s => s.id === contribution.sponsoringSalaryId)!.name });
    await form.getByRole('button', { name: 'Save contribution record', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Expenses and debts', exact: true }).click();
  for (const debt of plan.debts) {
    await page.getByRole('button', { name: 'Add debt', exact: true }).click(); form = recordForm(page, 'Save debt record');
    await fill(form, 'Debt name', debt.name); await fill(form, 'Debt opening balance ($)', dollars(debt.openingBalanceCents)); await fill(form, 'Debt nominal APR (%)', dollars(debt.aprBps));
    await fill(form, 'Debt monthly payment ($)', dollars(debt.monthlyPaymentCents)); await fill(form, 'Debt first payment month', debt.firstPaymentMonth); await form.getByRole('button', { name: 'Save debt record', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
  const property = plan.properties[0]!, rental = plan.rentals[0]!, loan = property.loans[0]!;
  await page.getByRole('button', { name: 'Add property', exact: true }).click(); form = recordForm(page, 'Save property');
  await fill(form, 'Property name', property.name); await select(form, 'Property role', property.role); await fill(form, 'Purchase date', property.purchaseDate);
  await fill(form, 'Purchase price', dollars(property.purchasePriceCents)); await fill(form, 'Down payment', dollars(property.downPaymentCents));
  await fill(form, 'Combined home and ADU market value at forecast start', dollars(property.openingValueCents)); await fill(form, 'Effective annual appreciation (%)', dollars(property.appreciationBps));
  await fill(form, 'Primary home living area', property.primaryArea!); await fill(form, 'ADU living area', property.aduArea!);
  for (const [index, override] of property.appreciationOverrides.entries()) {
    await form.getByRole('button', { name: 'Add appreciation override', exact: true }).click(); const row = form.getByRole('group', { name: `Appreciation override ${index + 1}`, exact: true });
    await fill(row, 'Appreciation year', override.year); await fill(row, 'Appreciation rate (%)', dollars(override.rateBps));
  }
  await form.getByRole('button', { name: 'Add rental unit', exact: true }).click(); const unit = form.getByRole('group', { name: /^Rental unit — / }).first();
  await fill(unit, 'Monthly rent receipts', dollars(rental.monthlyRentCents)); await fill(unit, 'Effective annual rent growth (%)', dollars(rental.rentGrowthBps));
  await fill(unit, 'Lease income start date', rental.rentStartDate); await fill(unit, 'Available for rent date', rental.availableDate); await select(unit, 'Active participation', 'true');
  const qualifications = { longTermFairMarketLease: 'Long-term fair-market lease', noPersonalUse: 'Rental has no personal use', noSubstantialTenantServices: 'No substantial tenant services', ordinaryResidential: 'Ordinary residential rental', advancedBasisAdjustments: 'Advanced basis adjustments apply', californiaSmallBusinessQualification: 'California AMT small-business qualification' } as const;
  for (const [key, label] of Object.entries(qualifications)) await select(unit, label, String(known(rental.qualifications[key as keyof typeof qualifications]!)));
  for (const [book, title] of [['federal', 'Federal rental tax history'], ['california', 'California rental tax history'], ['federal-amt', 'Federal AMT rental tax history'], ['california-amt', 'California AMT rental tax history']] as const) {
    const group = unit.getByRole('group', { name: title, exact: true }); await select(group, 'History status', 'known'); const history = known(rental.taxHistory[book]);
    for (const [key, label] of [['recoveryBasisCents', 'Original building recovery basis (excludes land)'], ['adjustedBuildingBasisCents', 'Adjusted building basis'], ['cumulativeDepreciationCents', 'Prior depreciation'], ['atRiskCents', 'Opening amount at risk'], ['atRiskSuspendedCents', 'Suspended at-risk losses'], ['passiveSuspendedCents', 'Suspended passive losses']] as const) await fill(group, label, dollars(history[key]));
  }
  await select(unit, 'QBI qualification', 'false'); await moneyHistory(unit, 'QBI wages', rental.qbi.wagesCents); await moneyHistory(unit, 'QBI UBIA', rental.qbi.ubiaCents); await select(unit, 'QBI loss history', 'known');
  await form.getByRole('button', { name: 'Add loan', exact: true }).click(); const mortgage = form.getByRole('group', { name: /^Loan — / }).first();
  await fill(mortgage, 'Loan name', loan.name); await fill(mortgage, 'Original principal', dollars(loan.originalPrincipalCents)); await fill(mortgage, 'Nominal APR (%)', dollars(loan.aprBps));
  await fill(mortgage, 'Origination date', loan.originationDate); await fill(mortgage, 'Acquisition date', loan.acquisitionDate); await fill(mortgage, 'First payment date', loan.firstPaymentDate); await fill(mortgage, 'Term (months)', loan.termMonths);
  await moneyHistory(mortgage, 'Opening mortgage balance', loan.openingBalance); await moneyHistory(mortgage, 'Opening principal-and-interest payment', loan.openingPayment);
  await select(mortgage, 'Qualified acquisition debt', 'true'); await moneyHistory(mortgage, 'Qualified acquisition principal', loan.proceedsQualification.qualifiedPrincipalCents);
  await select(mortgage, 'Complete proceeds history', 'true'); await select(mortgage, 'Financing qualifies for at-risk rules', 'true');
  for (const [index, allocation] of loan.proceedsAllocations.entries()) {
    await mortgage.getByRole('button', { name: 'Add loan proceeds allocation', exact: true }).click(); const row = mortgage.getByRole('group', { name: `Loan proceeds allocation ${index + 1}`, exact: true });
    await select(row, 'Proceeds use', allocation.use); if (allocation.use === 'rental') await selectFirst(row, 'Proceeds rental unit');
    await fill(row, 'Allocation numerator', allocation.share.numerator); await fill(row, 'Allocation denominator', allocation.share.denominator);
  }
  await unit.getByRole('button', { name: 'Add rental interest allocation', exact: true }).click(); const allocation = unit.getByRole('group', { name: /^Rental interest allocation — / }).first();
  await selectFirst(allocation, 'Allocated loan'); await fill(allocation, 'Allocation numerator', rental.loanAllocations[0]!.share.numerator); await fill(allocation, 'Allocation denominator', rental.loanAllocations[0]!.share.denominator); await select(allocation, 'Rental proceeds and interest qualified', 'true');
  for (const expense of plan.expenses) {
    await form.getByRole('button', { name: 'Add property expense', exact: true }).click(); const row = form.getByRole('group', { name: /^Property expense — / }).last();
    await fill(row, 'Property expense name', expense.name); await fill(row, 'Property expense amount', dollars(expense.amountCents)); await select(row, 'Property expense frequency', expense.frequency);
    await fill(row, 'Property expense start date', expense.startDate); await fill(row, 'Property expense annual growth (%)', dollars(expense.annualGrowthBps)); await select(row, 'Property expense category', expense.taxCategory); await select(row, 'Property expense use', expense.use);
  }
  await form.getByRole('button', { name: 'Save property', exact: true }).click();
}
async function openBackups(page: Page) { await page.getByText('Backups and recovery', { exact: true }).click(); }
async function importDocument(page: Page, document: string) {
  await page.getByLabel('Import JSON backup', { exact: true }).setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(document) });
}

test('saves two salaries, accounts and an ADU; reloads and restores', async ({ page }) => {
  test.setTimeout(180000);
  const annual = fixture.expected.years[0]!.netWorthCents, january = fixture.expected.months[0]!.netWorthCents;
  if (annual.status !== 'available' || january.status !== 'available') throw new Error('Acceptance oracle must be complete');
  await page.goto('/'); await enterAcceptancePlan(page, fixture.input);
  await expect(page.getByRole('heading', { name: 'Projection', exact: true })).toBeVisible();
  await expect(page.getByTestId('annual-2026-net-worth')).toHaveText(formatExpectedCents(annual.value));
  await page.getByRole('button', { name: 'Show months for 2026', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('monthly-2026-01-net-worth')).toHaveText(formatExpectedCents(january.value));
  await page.getByRole('button', { name: 'Tax explanation for 2026', exact: true }).click();
  await expect(page.getByText(/Annual income tax is reserved across months in proportion to positive gross cash income/).first()).toBeVisible();
  await page.reload(); await expect(page.getByTestId('annual-2026-net-worth')).toHaveText(formatExpectedCents(annual.value));
  await openBackups(page); const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click();
  const download = await downloadPromise, path = await download.path(); if (!path) throw new Error('Missing backup');
  const backup = await readFile(path, 'utf8'), document = JSON.parse(backup) as PlanDocument;
  expect(document.salaries).toHaveLength(2); expect(document.accounts).toHaveLength(5); expect(document.properties).toHaveLength(1); expect(document.rentals).toHaveLength(1);
  expect(document).not.toHaveProperty('projection');
  await fill(recordForm(page, 'Save household'), 'Opening cash reserve ($)', '10001.00'); await page.getByRole('button', { name: 'Save household', exact: true }).click();
  await importDocument(page, backup); await expect(page.getByTestId('save-status')).toContainText(`Saved input revision ${document.revision}`);
  await expect(page.getByTestId('annual-2026-net-worth')).toHaveText(formatExpectedCents(annual.value));
});

test('rejects malformed and unsupported restoration and retains an invalid draft', async ({ page }) => {
  await page.goto('/'); await openBackups(page); await importDocument(page, JSON.stringify(fixture.input));
  const output = page.getByTestId('annual-2026-net-worth'); await expect(output).toBeVisible(); const before = await output.textContent();
  for (const json of ['{', JSON.stringify({ ...fixture.input, schemaVersion: 99 })]) {
    await importDocument(page, json); await expect(page.getByTestId('save-status')).toContainText('Saved input revision 0'); await expect(output).toHaveText(before!);
  }
  await page.getByRole('button', { name: 'Income', exact: true }).click(); const form = page.getByRole('button', { name: 'Save salary record', exact: true }).first().locator('xpath=ancestor::form');
  const money = form.getByLabel('Annual gross salary ($)', { exact: true }); await money.focus(); await page.keyboard.press('Control+A'); await page.keyboard.type('1.234');
  await form.getByRole('button', { name: 'Save salary record', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(money).toHaveValue('1.234'); await expect(page.getByTestId('save-status')).toContainText('Saved input revision 0'); await expect(output).toHaveText(before!);
  await expect(page.getByText(/at most two decimal places/).first()).toBeVisible();
});

test('keeps a quota-failed restored revision Unsaved and downloadable', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await page.goto('/'); await openBackups(page); await importDocument(page, JSON.stringify(fixture.input));
  await expect(page.getByTestId('save-status')).toContainText('Unsaved'); await expect(page.getByTestId('save-status')).toContainText('Saved input revision 0');
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click();
  const downloaded = await downloadPromise, path = await downloaded.path(); if (!path) throw new Error('Missing unsaved backup');
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(fixture.input);
});

test('renders imported HTML-like names as literal text', async ({ page }) => {
  const name = '<img src=x onerror="window.lifelookInjected=true">';
  await page.goto('/'); await openBackups(page); await importDocument(page, JSON.stringify({ ...fixture.input, salaries: [{ ...fixture.input.salaries[0], name }, fixture.input.salaries[1]] }));
  await expect(page.getByTestId('annual-2026-net-worth')).toBeVisible(); await page.getByRole('button', { name: 'Income', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible(); await expect(page.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { lifelookInjected?: boolean }).lifelookInjected)).toBeUndefined();
});
