import {expect, test} from '@playwright/test';
import {makeAllocationPlan} from '../helpers/allocations';
import {applyEdit, openCollection, openRecord, openSettings, preloadWorkspace, readActivePlan, readWorkspace, waitForPreview} from './helpers/workspace';

test('previews a salary against applied inputs and reloads only the explicitly applied revision', async ({page}) => {
  await preloadWorkspace(page, makeAllocationPlan());
  await expect(page.getByRole('table', {name: 'Annual balance sheet', exact: true})).toBeVisible();
  await expect(page.locator('[data-active-editor]')).toHaveCount(0);
  const editor = await openRecord(page, {kind: 'record', section: 'salaries', recordId: 'salary-a'});
  const amount = editor.getByLabel('Annual gross salary ($)', {exact: true});
  await amount.fill('125000.00');
  await waitForPreview(page);
  expect((await readActivePlan(page)).salaries[0]!.annualGrossCents).toBe(10000000);
  await page.getByLabel('Table view', {exact: true}).selectOption('financial-overview');
  await expect(page.getByTestId('summary-2026-total-income')).toContainText('$225,000.00');
  await expect(page.locator('.overview-source')).toContainText('Preview');
  await applyEdit(page);
  expect((await readActivePlan(page)).revision).toBe(1);
  expect((await readActivePlan(page)).salaries[0]!.annualGrossCents).toBe(12500000);
  await expect(amount).toHaveValue('125000.00');
  await page.reload();
  await expect(page.locator('[data-active-editor]')).toHaveCount(0);
  await expect(page.locator('.overview-source')).toContainText('Applied');
  expect((await readActivePlan(page)).revision).toBe(1);
});

for (const [width, height] of [[1440, 1000], [900, 1000], [390, 844], [320, 740]] as const) {
  test(`retains precise invalid text, accessible actions and focus at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height});
    await preloadWorkspace(page, makeAllocationPlan());
    const editor = await openRecord(page, {kind: 'record', section: 'accounts', recordId: 'brokerage'});
    const amount = editor.getByLabel('Account opening balance ($)', {exact: true});
    if(width>=1180){
      const reportBounds=await page.getByRole('region',{name:'Financial forecast',exact:true}).boundingBox();
      const editorBounds=await editor.boundingBox();
      expect(reportBounds!.width).toBeGreaterThanOrEqual(600);expect(editorBounds!.width).toBeGreaterThanOrEqual(380);
    }
    await amount.fill('1.234');
    await expect(editor.locator('[data-preview-status]')).toHaveAttribute('data-preview-status', 'invalid');
    const close = page.getByRole('button', {name: 'Close editor', exact: true});
    await expect(close).toBeVisible();
    if (width < 1180) {
      await page.getByRole('button', {name: 'Forecast', exact: true}).click();
      await expect(page.locator('.overview-source')).toContainText('paused');
      await page.getByRole('button', {name: 'Edit', exact: true}).click();
      await expect(amount).toHaveValue('1.234');
    }
    await expect(amount).toBeFocused();
    const bounds = await amount.boundingBox(), footer = await editor.locator('.editor-footer').boundingBox();
    expect(bounds).not.toBeNull(); expect(footer).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(footer!.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await readActivePlan(page)).revision).toBe(0);
    await close.click();
    await expect(page.locator('[data-active-editor]')).toHaveCount(0);
    await expect(page.locator('[data-open-target="accounts:brokerage"]')).toBeFocused();
    await openRecord(page, {kind: 'record', section: 'accounts', recordId: 'brokerage'});
    await expect(amount).toHaveValue('1.234');
  });
}

test('keeps theme preferences outside financial inputs and follows System changes with reduced motion', async ({page}) => {
  await page.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
  await preloadWorkspace(page, makeAllocationPlan());
  const applied = await readWorkspace(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const settings = await openSettings(page);
  await settings.getByLabel('Appearance', {exact: true}).selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({colorScheme: 'dark', reducedMotion: 'reduce'});
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await readWorkspace(page)).toEqual(applied);
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await openRecord(page, {kind: 'record', section: 'salaries', recordId: 'salary-a'});
  expect(await page.locator('[data-active-editor]').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
});

test('keeps long literal record names and enlarged text inside a phone viewport', async ({page}) => {
  await page.setViewportSize({width: 320, height: 740});
  const plan = makeAllocationPlan();
  await preloadWorkspace(page, {...plan, accounts: plan.accounts.map((account, i) => i ? account : {...account, name: '<img> 家庭の投資 — ' + 'Very long name '.repeat(8)})});
  await page.evaluate(() => {document.documentElement.style.fontSize = '24px';});
  await openCollection(page, 'accounts');
  await expect(page.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
