import { expect, test } from '@playwright/test';
import { makePlan } from '../helpers/plans';

test('reloads annual expenses as monthly budgets and posts annual IRA funding at each month end', async ({ page }) => {
  const plan = makePlan({
    openingCashCents: 5000000,
    salaries: [{ id: 'salary', name: 'Salary', ownerId: 'owner-a', employerId: 'employer', annualGrossCents: 6000000,
      startDate: '2026-01-01', annualRaiseBps: 0, raiseMonth: 1, raiseDay: 1, changes: [] }],
    expenses: [{ id: 'annual-budget', name: 'Annual budget', amountCents: 120000, frequency: 'annual',
      startDate: '2026-01-01', annualGrowthBps: 0, use: 'personal', taxCategory: 'personal' }],
    accounts: [{ id: 'roth', name: 'Roth IRA', ownerId: 'owner-a', type: 'roth-ira', openingBalanceCents: 0,
      annualGrowthBps: 770, openingIraBasis: { known: true, value: 0 } }],
    cashFlowAllocation: { id: 'allocation', entries: [{ id: 'roth-maximum', priority: 1,
      destination: { kind: 'account', accountId: 'roth' }, amount: { kind: 'max-annual' } }],
      overflow: { id: 'remaining-cash', destination: { kind: 'cash' } } },
  });
  await page.addInitScript(saved => localStorage.setItem('lifelook.foundation.plan.v1', JSON.stringify(saved)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Show months for 2026', exact: true }).click();
  for (let month = 1; month <= 12; month++) {
    const date = `2026-${String(month).padStart(2, '0')}`;
    await expect(page.getByTestId(`monthly-${date}-expenses`)).toHaveText('$100.00');
    await expect(page.getByTestId(`monthly-${date}-eligible-contribution`)).toHaveText('$625.00');
  }
  // Independent month-end Decimal worksheet: January earns no growth on its deposit.
  await expect(page.getByTestId('monthly-2026-01-account-roth-closing')).toHaveText('$625.00');
  await expect(page.getByTestId('monthly-2026-02-account-roth-closing')).toHaveText('$1,253.88');
  await expect(page.getByTestId('annual-2026-account-roth-closing')).toHaveText('$7,761.14');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lifelook.foundation.plan.v1')!));
  expect(saved.expenses[0]).toMatchObject({ amountCents: 120000, frequency: 'annual' });
  await page.reload();
  await page.getByRole('button', { name: 'Show months for 2026', exact: true }).click();
  await expect(page.getByTestId('monthly-2026-01-expenses')).toHaveText('$100.00');
  await expect(page.getByTestId('monthly-2026-01-account-roth-closing')).toHaveText('$625.00');
});
