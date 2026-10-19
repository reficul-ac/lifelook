import {preloadWorkspace,readActivePlan,replaceScenarioFromJson,openRecord,openCollection,applyEdit,openSettings,openForecastDetails,revealControl,revealLocator,showMonths} from './helpers/workspace';
import {createPlan} from '../../src/engine';
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
const recordForm = (page: Page): Locator => page.locator('[data-active-editor] form[data-record-id]').first();
async function fill(scope: Locator, label: string, value: string | number) { await (await revealControl(scope,label)).fill(String(value)); }
async function select(scope: Locator, label: string, value: string) { await (await revealControl(scope,label)).selectOption(value); }
async function selectLabel(scope: Locator, label: string, option: string) { await (await revealControl(scope,label)).selectOption({label:option}); }
async function clickAction(scope: Locator, label: string) { const action=scope.getByRole('button',{name:label,exact:true,includeHidden:true});await (await revealLocator(action)).click(); }
async function applyWithKeyboard(page: Page) {
  const editor=page.locator('[data-active-editor]'),status=editor.locator('[data-preview-status]');
  await expect(status).not.toHaveAttribute('data-preview-status','pending');
  if(await status.getAttribute('data-preview-status')==='inactive')return;
  await editor.locator('.editor-footer').getByRole('button',{name:/^(Apply |Review inputs$|Retry calculation$)/}).focus();
  await page.keyboard.press('Enter');await expect(status).not.toHaveAttribute('data-preview-status','pending');
}
async function booleanHistory(scope: Locator, label: string, value: History<boolean>) {
  await select(scope,label,value.known?String(value.value):'unknown');
}
async function moneyHistory(scope: Locator, label: string, value: History<Cents>) {
  await select(scope, `${label} history`, value.known ? 'known' : 'unknown');
  if (value.known) await fill(scope,label.includes('$')?label:label+' ($)',dollars(value.value));
}
async function selectFirst(scope: Locator, label: string) {
  const control = await revealControl(scope,label);
  const value = await control.locator('option').first().getAttribute('value');
  if (value === null) throw new Error('Missing native option');
  await control.selectOption(value);
}

/** Enter the synthetic oracle through native labeled controls and each record Apply. */
async function enterAcceptancePlan(page: Page, plan: PlanDocument): Promise<void> {
  await openRecord(page,{kind:'record',section:'household',recordId:'household'});
  let form = recordForm(page);
  await fill(form, 'Projection start year', plan.startYear); await fill(form, 'Projection years', plan.horizonYears);
  await fill(form, 'Opening cash reserve ($)', dollars(plan.openingCashCents));
  for (let index = 0; index < 2; index++) {
    const filer = plan.household.filers[index]!, prefix = `Filer ${index + 1}`;
    await fill(form, `${prefix} name`, filer.name);
    await select(form, `${prefix} birth date history`, 'known'); await fill(form, `${prefix} birth date value`, known(filer.birthDate));
    await booleanHistory(form, `${prefix} covered by workplace retirement plan`, filer.workplaceCoverage);

  }
  const questions = { additionalIncome: 'Additional income outside these records', additionalCredits: 'Additional household tax credits', qualifiedDividendsOrCapitalGains: 'Qualified dividends or capital gains', retirementDistributions: 'Retirement distributions', priorFederalMinimumTaxCredits: 'Prior federal minimum-tax credits', priorCaliforniaMinimumTaxCredits: 'Prior California minimum-tax credits' } as const;
  for (const [key, label] of Object.entries(questions)) await booleanHistory(form, label, plan.household.coverageAnswers[key as keyof typeof questions]);
  await fill(form, 'Future tax threshold growth (%)', dollars(plan.taxPolicy.futureIndexGrowthBps));
  await applyWithKeyboard(page);
  for (const salary of plan.salaries) {
    await openCollection(page,'income');await page.getByRole('button', { name: 'Add salary', exact: true }).click(); form = recordForm(page);
    await fill(form, 'Salary name', salary.name); await select(form, 'Salary owner', salary.ownerId); await fill(form, 'Salary employer', salary.employerId);
    await fill(form, 'Annual gross salary ($)', dollars(salary.annualGrossCents)); await fill(form, 'Salary start date', salary.startDate);
    await fill(form, 'Annual salary raise (%)', dollars(salary.annualRaiseBps)); await select(form, 'Salary raise month', String(salary.raiseMonth)); await fill(form, 'Salary raise day', salary.raiseDay);
    for (const [index, change] of salary.changes.entries()) {
      await clickAction(form,'Add salary change'); await fill(form, `Salary change date ${index + 1}`, change.date);
      await select(form, `Salary change type ${index + 1}`, change.kind);
      await fill(form, change.kind === 'percent' ? `Salary change percentage ${index + 1} (%)` : `Salary change annual amount ${index + 1} ($)`, dollars(change.kind === 'percent' ? change.percentBps : change.annualGrossCents));
    }
    await applyEdit(page);
  }
  await openRecord(page,{kind:'record',section:'household',recordId:'household'});form=recordForm(page);
  for(const [index,filer]of plan.household.filers.entries()){const prefix=`Filer ${index+1}`;
    for (const [i, facts] of filer.employerAssumptionsByYear.entries()) {
      await clickAction(form,`Add ${prefix} employer catch-up facts`);
      await fill(form, `${prefix} employer year ${i + 1}`, facts.year); await select(form, `${prefix} employer ${i + 1}`, facts.employerId);
      const wages = `${prefix} prior-year employer wages ${i + 1} ($)`;
      await select(form, `${wages} history`, 'known'); await fill(form, `${wages} value`, dollars(known(facts.priorYearWagesCents)));
      await booleanHistory(form, `${prefix} employer offers catch-up ${i + 1}`, facts.planCatchUpAvailable);
      await booleanHistory(form, `${prefix} employer offers Roth catch-up ${i + 1}`, facts.rothCatchUpAvailable);
    }
  }
  await applyWithKeyboard(page);
  for (const account of plan.accounts) {
    await openCollection(page,'accounts');await page.getByRole('button', { name: 'Add account', exact: true }).click(); form = recordForm(page);
    await fill(form, 'Account name', account.name); await select(form, 'Account owner', account.ownerId); await select(form, 'Account type', account.type);
    await fill(form, 'Account opening balance ($)', dollars(account.openingBalanceCents)); await fill(form, 'Effective annual account return (%)', dollars(account.annualGrowthBps));
    if (account.type === 'traditional-ira') { await select(form, 'After-tax IRA basis at forecast start ($) history', 'known'); await fill(form, 'After-tax IRA basis at forecast start ($) value', dollars(known(account.openingIraBasis))); }
    await applyEdit(page);
  }
  for (const contribution of plan.contributions) {
    await openCollection(page,'accounts');await page.getByRole('button', { name: 'Add contribution', exact: true }).click(); form = recordForm(page);
    await selectLabel(form,'Contribution account',plan.accounts.find(a => a.id === contribution.accountId)!.name);
    await fill(form, 'Contribution priority', contribution.priority); await fill(form, 'Contribution start date', contribution.startDate);
    await select(form, 'Contribution amount mode', contribution.amount.kind);
    if (contribution.amount.kind === 'fixed') await fill(form, 'Monthly contribution ($)', dollars(contribution.amount.monthlyCents));
    else { await selectLabel(form,'Contribution salary',plan.salaries.find(s => s.id === (contribution.amount as { salaryId: string }).salaryId)!.name); await fill(form, 'Salary contribution (%)', dollars(contribution.amount.percentBps)); }
    if (contribution.sponsoringSalaryId) await selectLabel(form,'Sponsoring salary',plan.salaries.find(s => s.id === contribution.sponsoringSalaryId)!.name);
    await applyEdit(page);
  }
  for (const debt of plan.debts) {
    await openCollection(page,'spending');await page.getByRole('button', { name: 'Add debt', exact: true }).click(); form = recordForm(page);
    await fill(form, 'Debt name', debt.name); await fill(form, 'Debt opening balance ($)', dollars(debt.openingBalanceCents)); await fill(form, 'Debt nominal APR (%)', dollars(debt.aprBps));
    await fill(form, 'Debt monthly payment ($)', dollars(debt.monthlyPaymentCents)); await fill(form, 'Debt first payment month', debt.firstPaymentMonth); await applyEdit(page);
  }
  const property = plan.properties[0]!, rental = plan.rentals[0]!, loan = property.loans[0]!;
  await openCollection(page,'properties');await page.getByRole('button', { name: 'Add property', exact: true }).click(); form = recordForm(page);
  await fill(form, 'Property name', property.name); await select(form, 'Property role', property.role); await fill(form, 'Property purchase date', property.purchaseDate);
  await fill(form, 'Purchase price ($)', dollars(property.purchasePriceCents)); await fill(form, 'Down payment ($)', dollars(property.downPaymentCents));
  await fill(form, 'Combined home and ADU market value at forecast start ($)', dollars(property.openingValueCents)); await fill(form, 'Effective annual appreciation (%)', dollars(property.appreciationBps));
  await fill(form, 'Primary home living area', property.primaryArea!); await fill(form, 'ADU living area', property.aduArea!);
  await openDetails(form,'Yearly appreciation overrides');
  for (const [index, override] of property.appreciationOverrides.entries()) {
    await clickAction(form,'Add appreciation override'); const row = form.getByRole('group', { includeHidden:true, name: `Appreciation override ${index + 1}`, exact: true });
    await fill(row, 'Appreciation year', override.year); await fill(row, 'Appreciation rate (%)', dollars(override.rateBps));
  }
  await clickAction(form,'Add rental unit'); const unit = form.getByRole('group', { includeHidden:true, name:'Rental details',exact:true }).first();
  await fill(unit, 'Monthly rent receipts ($)', dollars(rental.monthlyRentCents)); await fill(unit, 'Effective annual rent growth (%)', dollars(rental.rentGrowthBps));
  await fill(unit, 'Lease income start date', rental.rentStartDate); await fill(unit, 'Available for rent date', rental.availableDate); await select(unit, 'Active participation', 'true');
  const qualifications = { longTermFairMarketLease: 'Long-term fair-market lease', noPersonalUse: 'Rental has no personal use', noSubstantialTenantServices: 'No substantial tenant services', ordinaryResidential: 'Ordinary residential rental', advancedBasisAdjustments: 'Advanced basis adjustments apply', californiaSmallBusinessQualification: 'California AMT small-business qualification' } as const;
  for (const [key, label] of Object.entries(qualifications)) await select(unit, label, String(known(rental.qualifications[key as keyof typeof qualifications]!)));
  for (const [book, title] of [['federal', 'Federal rental tax history'], ['california', 'California rental tax history'], ['federal-amt', 'Federal AMT rental tax history'], ['california-amt', 'California AMT rental tax history']] as const) {
    const group = await openDetails(unit,title.replace(' rental tax history',' history')); await select(group, 'History status', 'known'); const history = known(rental.taxHistory[book]);
    for (const [key, label] of [['recoveryBasisCents', 'Original building recovery basis (excludes land) ($)'], ['adjustedBuildingBasisCents', 'Adjusted building basis ($)'], ['cumulativeDepreciationCents', 'Prior depreciation ($)'], ['atRiskCents', 'Opening amount at risk ($)'], ['atRiskSuspendedCents', 'Suspended at-risk losses ($)'], ['passiveSuspendedCents', 'Suspended passive losses ($)']] as const) await fill(group, label, dollars(history[key]));
  }
  await openDetails(unit,'QBI history');
  await select(unit, 'QBI qualification', 'false'); await moneyHistory(unit, 'QBI wages', rental.qbi.wagesCents); await moneyHistory(unit, 'Unadjusted qualified property basis (UBIA)', rental.qbi.ubiaCents); await select(unit, 'QBI loss history', 'known');
  await clickAction(form,'Add loan'); const mortgage = form.getByRole('group', { includeHidden:true, name:'Loan terms',exact:true }).first();
  await fill(mortgage, 'Loan name', loan.name); await fill(mortgage, 'Original principal ($)', dollars(loan.originalPrincipalCents)); await fill(mortgage, 'Nominal APR (%)', dollars(loan.aprBps));
  await fill(mortgage, 'Origination date', loan.originationDate); await fill(mortgage, 'Acquisition date', loan.acquisitionDate); await fill(mortgage, 'First payment date', loan.firstPaymentDate); await fill(mortgage, 'Term (months)', loan.termMonths);
  await moneyHistory(mortgage, 'Opening mortgage balance', loan.openingBalance); await moneyHistory(mortgage, 'Opening principal-and-interest payment', loan.openingPayment);
  await select(mortgage, 'Qualified acquisition debt', 'true'); await moneyHistory(mortgage, 'Qualified acquisition principal', loan.proceedsQualification.qualifiedPrincipalCents);
  await select(mortgage, 'Complete proceeds history', 'true'); await select(mortgage, 'Financing qualifies for at-risk rules', 'true');
  for (const [index, allocation] of loan.proceedsAllocations.entries()) {
    await clickAction(mortgage,'Add loan proceeds allocation'); const row = mortgage.getByRole('group', { includeHidden:true, name: `Loan proceeds allocation ${index + 1}`, exact: true });
    await select(row, 'Proceeds use', allocation.use); if (allocation.use === 'rental') await selectFirst(row, 'Proceeds rental unit');
    await fill(row, 'Rental portion', allocation.share.numerator); await fill(row, 'Total portions', allocation.share.denominator);
  }
  await clickAction(unit,'Add rental interest allocation'); const allocation = unit.getByRole('group', { includeHidden:true, name: /^Rental interest allocation — / }).first();
  await selectFirst(allocation, 'Allocated loan'); await fill(allocation, 'Rental portion', rental.loanAllocations[0]!.share.numerator); await fill(allocation, 'Total portions', rental.loanAllocations[0]!.share.denominator); await select(allocation, 'Rental proceeds and interest qualified', 'true');
  for (const expense of plan.expenses) {
    await clickAction(form,'Add property expense'); const row = form.getByRole('group', { includeHidden:true, name: /^Property expense — / }).last();
    await fill(row, 'Property expense name', expense.name); await fill(row, 'Property expense amount ($)', dollars(expense.amountCents)); await select(row, 'Property expense frequency', expense.frequency);
    await fill(row, 'Property expense start date', expense.startDate); await fill(row, 'Property expense annual growth (%)', dollars(expense.annualGrowthBps)); await select(row, 'Property expense category', expense.taxCategory); await select(row, 'Property expense use', expense.use);
  }
  await applyEdit(page);
}
async function openDetails(scope:Locator,title:string):Promise<Locator>{const summary=scope.locator('summary').filter({hasText:new RegExp('^'+title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).first();await revealLocator(summary);if(!await summary.evaluate(node=>(node.parentElement as HTMLDetailsElement).open))await summary.click();return summary.locator('..');}
async function openBackups(page: Page) {await openSettings(page);await openDetails(page.locator('[data-settings]'),'Backups and recovery');}
async function importDocument(page: Page, document: string) {
  await replaceScenarioFromJson(page,document);
}

test('saves two salaries, accounts and an ADU; reloads and restores', async ({ page }) => {
  test.setTimeout(180000);
  const annual = fixture.expected.years[0]!.netWorthCents, january = fixture.expected.months[0]!.netWorthCents;
  if (annual.status !== 'available' || january.status !== 'available') throw new Error('Acceptance oracle must be complete');
  await page.goto('/'); await enterAcceptancePlan(page, fixture.input);await openCollection(page,'overview');await openForecastDetails(page);
  await expect(page.getByRole('table', { name: 'Annual balance sheet', exact: true })).toBeVisible();
  await expect(page.getByTestId('annual-2026-net-worth')).toHaveText(formatExpectedCents(annual.value));
  await page.getByRole('button', { name: 'Show months for 2026', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByTestId('monthly-2026-01-net-worth')).toHaveText(formatExpectedCents(january.value));
  await page.getByRole('button', { name: 'Tax explanation for 2026', exact: true }).click();
  await openDetails(page.getByRole('region',{name:'Financial forecast'}),'How calculated');
  await expect(page.getByText(/Annual income tax is reserved across months in proportion to positive gross cash income/).first()).toBeVisible();
  await page.reload();await openForecastDetails(page); await expect(page.getByTestId('annual-2026-net-worth')).toHaveText(formatExpectedCents(annual.value));
  await openBackups(page); const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export scenario JSON', exact: true }).click();
  const download = await downloadPromise, path = await download.path(); if (!path) throw new Error('Missing backup');
  const backup = await readFile(path, 'utf8'), document = JSON.parse(backup) as PlanDocument;
  expect(document.salaries).toHaveLength(2); expect(document.accounts).toHaveLength(5); expect(document.properties).toHaveLength(1); expect(document.rentals).toHaveLength(1);
  expect(document).not.toHaveProperty('projection');
  await openRecord(page,{kind:'record',section:'household',recordId:'household'});await fill(recordForm(page), 'Opening cash reserve ($)', '10001.00');await applyEdit(page);
  await importDocument(page, backup);expect((await readActivePlan(page)).revision).toBe(document.revision);await openForecastDetails(page);
  await expect(page.getByTestId('annual-2026-net-worth')).toHaveText(formatExpectedCents(annual.value));
});

test('rejects malformed and unsupported restoration and retains an invalid draft', async ({ page }) => {
  await page.goto('/'); await openBackups(page); await importDocument(page, JSON.stringify(fixture.input));
  await openForecastDetails(page);const output = page.getByTestId('annual-2026-net-worth');await revealLocator(output); await expect(output).toBeVisible(); const before = await output.textContent();
  for (const json of ['{', JSON.stringify({ ...fixture.input, schemaVersion: 99 })]) {
    await importDocument(page, json);expect((await readActivePlan(page)).revision).toBe(fixture.input.revision); await expect(output).toHaveText(before!);
  }
  await openRecord(page,{kind:'record',section:'salaries',recordId:fixture.input.salaries[0]!.id});const form=recordForm(page);
  const money = form.getByLabel('Annual gross salary ($)', { exact: true }); await money.focus(); await page.keyboard.press('Control+A'); await page.keyboard.type('1.234');
  await applyWithKeyboard(page);
  await expect(money).toHaveValue('1.234');expect((await readActivePlan(page)).revision).toBe(fixture.input.revision);await openForecastDetails(page); await expect(output).toHaveText(before!);
  await expect(page.getByText(/up to 2 decimal places/).first()).toBeVisible();await openBackups(page);await importDocument(page,'{');await expect(page.getByText('Backup not restored. Current inputs and drafts retained. Choose a valid backup.')).toBeVisible();await expect(money).toHaveValue('1.234');await importDocument(page,JSON.stringify(fixture.input));await expect(page.getByTestId('draft-status')).toBeEmpty();await openRecord(page,{kind:'record',section:'salaries',recordId:fixture.input.salaries[0]!.id});await expect(form.getByLabel('Annual gross salary ($)',{exact:true})).toHaveValue(dollars(fixture.input.salaries[0]!.annualGrossCents));
});

test('keeps a quota-failed restored revision not saved locally and downloadable', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await page.goto('/'); await openBackups(page); await importDocument(page, JSON.stringify(fixture.input));
  await expect(page.getByTestId('save-status')).toContainText('Not saved locally');
  await page.getByText('Backups and recovery',{exact:true}).click();await openRecord(page,{kind:'record',section:'household',recordId:'household'});await fill(recordForm(page),'Opening cash reserve ($)','999.99');await expect(page.getByTestId('persistence-warning')).toBeVisible();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export workspace backup', exact: true }).click();
  const downloaded = await downloadPromise, path = await downloaded.path(); if (!path) throw new Error('Missing unsaved backup');
  const recovered=JSON.parse(await readFile(path,'utf8'));expect(recovered.scenarios.find((s:{id:string})=>s.id===recovered.activeScenarioId).plan).toEqual(fixture.input);
});

test('renders imported HTML-like names as literal text', async ({ page }) => {
  const name = '<img src=x onerror="window.lifelookInjected=true">';
  await page.goto('/'); await openBackups(page); await importDocument(page, JSON.stringify({ ...fixture.input, salaries: [{ ...fixture.input.salaries[0], name }, fixture.input.salaries[1]] }));
  await openForecastDetails(page);await revealLocator(page.getByTestId('annual-2026-net-worth'));await expect(page.getByTestId('annual-2026-net-worth')).toBeVisible();await openCollection(page,'income');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible(); await expect(page.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { lifelookInjected?: boolean }).lifelookInjected)).toBeUndefined();
});

const defaultPlan=()=>createPlan('2026-10-12','warning-audit');
async function preload(page:Page,plan:PlanDocument=defaultPlan()){await preloadWorkspace(page,plan);}
async function insideViewport(panel:Locator,page:Page){const rect=await panel.boundingBox(),size=page.viewportSize()!;expect(rect).not.toBeNull();expect(rect!.x).toBeGreaterThanOrEqual(11);expect(rect!.y).toBeGreaterThanOrEqual(11);expect(rect!.x+rect!.width).toBeLessThanOrEqual(size.width-11);expect(rect!.y+rect!.height).toBeLessThanOrEqual(size.height-11);}
test('keeps all default annual rows compact and exposes carried causes',async({page})=>{
  await preload(page);await page.setViewportSize({width:1440,height:1000});const table=page.getByRole('table',{name:'Annual balance sheet',exact:true}),rows=table.locator('tbody tr');await expect(rows).toHaveCount(30);await expect(table.locator('td p')).toHaveCount(0);
  expect(await rows.evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height<=80))).toBe(true);
  await page.getByTestId('balance-2056-net-worth').getByRole('button',{name:/Needs data/,includeHidden:true}).click();const panel=page.getByRole('region',{name:'Net worth · 2056'});await expect(panel).toContainText('2027–2056');await insideViewport(panel,page);
  await expect(panel).toContainText('Additional income outside these records');await expect(panel).toContainText('Additional household tax credits');await expect(panel).toContainText('Qualified dividends or capital gains');
});
test('disclosure previews support pointer movement, fresh focus, Enter, Space and dismissal',async({page})=>{
  await preload(page);await openRecord(page,{kind:'record',section:'household',recordId:'household'});await openForecastDetails(page);const trigger=page.getByTestId('annual-2027-federal-income-tax').getByRole('button',{name:/Needs data/,includeHidden:true});await revealLocator(trigger);await trigger.hover();const preview=page.getByRole('tooltip');await expect(preview).toBeVisible();await preview.hover();await page.waitForTimeout(200);await expect(preview).toBeVisible();await page.keyboard.press('Escape');await expect(preview).toBeHidden();
  await trigger.focus();await expect(preview).toBeVisible();await page.keyboard.press('Enter');const panel=page.getByRole('region',{name:'Federal income tax · 2027'});await expect(panel).toBeVisible();await expect(panel.getByRole('button',{name:'Close'})).toBeFocused();await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(preview).toBeHidden();
  await page.keyboard.press('Space');await expect(panel).toBeVisible();await panel.getByRole('button',{name:'Close'}).click();await expect(trigger).toBeFocused();await trigger.click();await page.getByLabel('Opening cash reserve ($)',{exact:true}).click();await expect(panel).toBeHidden();await expect(page.getByLabel('Opening cash reserve ($)',{exact:true})).toBeFocused();
});
test('disclosure panels remain scrollable within narrow, zoomed and horizontally scrolled viewports',async({page})=>{
  await preload(page);await page.setViewportSize({width:390,height:844});await openForecastDetails(page);const cell=page.getByTestId('annual-2056-net-worth');await revealLocator(cell);await cell.getByRole('button',{name:/Needs data/,includeHidden:true}).click();const panel=page.getByRole('region',{name:'Net worth · 2056'});await insideViewport(panel,page);
  const wrap=cell.locator('xpath=ancestor::div[contains(@class,"projection-table-wrap")]');expect(await wrap.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);await wrap.evaluate(node=>{node.scrollLeft=0;});await insideViewport(panel,page);
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{document.documentElement.style.fontSize='32px';});await insideViewport(panel,page);await panel.getByText('Full cause and diagnostics',{exact:true}).first().click();expect(await panel.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true);await panel.evaluate(node=>{node.scrollTop=node.scrollHeight;});await insideViewport(panel,page);
});
test('disclosure triggers survive hidden sections and saved-result replacement',async({page})=>{
  await preload(page);await openRecord(page,{kind:'record',section:'household',recordId:'household'});await showMonths(page,2027);const monthly=page.getByTestId('monthly-2027-01-federal-income-tax').getByRole('button',{name:/Needs data/,includeHidden:true});await monthly.click();await page.getByRole('button',{name:'Hide months for 2027',exact:true}).click();await expect(page.locator('[data-disclosure-panel]')).toBeHidden();await page.getByRole('button',{name:'Show months for 2027',exact:true}).click();await monthly.click();await expect(page.locator('[data-disclosure-panel]')).toBeVisible();
  await fill(recordForm(page),'Opening cash reserve ($)','10.00');await applyEdit(page);await expect(page.locator('[data-disclosure-panel]')).toBeHidden();const annual=page.getByTestId('annual-2027-federal-income-tax').getByRole('button',{name:/Needs data/,includeHidden:true});await revealLocator(annual);await annual.click();await expect(page.getByRole('region',{name:'Federal income tax · 2027'})).toBeVisible();
  await openCollection(page,'properties');await page.getByRole('button',{name:'Add property',exact:true}).click();await openDetails(recordForm(page),'Yearly appreciation overrides');
  await openCollection(page,'income');await expect(page.locator('[data-disclosure-panel]')).toBeHidden();
});
test('history review actions reveal the correct collapsed book and preserve destination focus',async({page})=>{
  const plan={...fixture.input,rentals:fixture.input.rentals.map(r=>({...r,taxHistory:{...r.taxHistory,'federal-amt':{known:false as const}}}))};await preload(page,plan);await openForecastDetails(page);const amount=page.getByTestId('annual-2026-net-worth').getByRole('button',{name:/Needs data/,includeHidden:true});await revealLocator(amount);await amount.click();const panel=page.locator('[data-disclosure-panel]');await panel.getByRole('button',{name:/Review ADU/}).first().click();
  await expect(page.getByRole('button',{name:'Properties',exact:true})).toHaveAttribute('aria-pressed','true');const summary=page.locator('summary').filter({hasText:/^Federal AMT history/});await expect(summary).toBeVisible();await expect(summary.locator('..')).toHaveAttribute('open','');
  expect(await page.evaluate(()=>(document.activeElement as HTMLElement).dataset.field)).toBe('rentals.0.taxHistory.federal-amt');await expect(panel).toBeHidden();
});
test('disclosure activation and focus return work on touch screens',async({browser})=>{
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:844},baseURL:'http://127.0.0.1:4174'});try{const page=await context.newPage();await preload(page);await openForecastDetails(page);const trigger=page.getByTestId('annual-2056-net-worth').getByRole('button',{name:/Needs data/,includeHidden:true});await revealLocator(trigger);await trigger.tap();const panel=page.getByRole('region',{name:'Net worth · 2056'});await expect(panel).toBeVisible();await insideViewport(panel,page);await panel.getByRole('button',{name:'Close'}).tap();await expect(trigger).toBeFocused();await expect(panel).toBeHidden();}finally{await context.close();}
});
