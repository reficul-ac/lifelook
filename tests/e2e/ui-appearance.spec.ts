import {expect, test} from '@playwright/test';
import {makeEstimatedMortgagePlan} from '../helpers/estimated-mortgage';
import {openRecord, openSettings, preloadWorkspace} from './helpers/workspace';

test.use({viewport: {width: 1440, height: 1000}, locale: 'en-US', timezoneId: 'America/Los_Angeles', contextOptions:{reducedMotion:'reduce'}});
for (const theme of ['dark', 'light'] as const) {
  test(`${theme} overview, property editor and paused preview`, async ({page}) => {
    await preloadWorkspace(page, makeEstimatedMortgagePlan());
    const settings = await openSettings(page);
    await settings.getByLabel('Appearance', {exact: true}).selectOption(theme);
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    await expect(page).toHaveScreenshot(`${theme}-overview.png`, {animations: 'disabled', caret: 'hide'});
    await openRecord(page, {kind: 'record', section: 'properties', recordId: 'home'});
    await expect(page).toHaveScreenshot(`${theme}-property.png`, {animations: 'disabled', caret: 'hide'});
    const salary = await openRecord(page, {kind: 'record', section: 'salaries', recordId: 'salary-a'});
    await salary.getByLabel('Annual gross salary ($)', {exact: true}).fill('-');
    await expect(salary.locator('[data-preview-status]')).toHaveAttribute('data-preview-status', 'invalid');
    await expect(page).toHaveScreenshot(`${theme}-paused.png`, {animations: 'disabled', caret: 'hide'});
  });
}
