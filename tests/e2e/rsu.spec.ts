import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import type {PlanDocument} from '../../src/engine';
import {makePlan} from '../helpers/plans';

test('saves independent RSU grants, retains exact invalid input and restores the exported account',async({page})=>{
  await page.addInitScript(plan=>{if(localStorage.getItem('lifelook.foundation.plan.v1')===null)localStorage.setItem('lifelook.foundation.plan.v1',JSON.stringify(plan));},makePlan());
  await page.goto('/');await page.getByRole('button',{name:'Investments',exact:true}).click();await page.getByRole('button',{name:'Add account',exact:true}).click();
  const form=page.getByRole('button',{name:'Save account',exact:true}).locator('xpath=ancestor::form');
  await form.getByLabel('Account name',{exact:true}).fill('Synthetic employer RSUs');await form.getByLabel('Account type',{exact:true}).selectOption('rsu');
  await form.getByLabel('RSU employer ID',{exact:true}).fill('synthetic-employer');await form.getByLabel('Current share price ($)',{exact:true}).fill('120.00');
  const initial=form.getByRole('group',{name:'RSU grant 1',exact:true});
  for(const [label,value] of Object.entries({'Grant name':'Initial award','Grant value ($)':'48000.00','Grant share price ($)':'100.00','Vesting start date':'2025-12-01','Vesting term (months)':'48','Shares sold for withholding (%)':'25.00'}))await initial.getByLabel(label,{exact:true}).fill(value);
  await expect(initial).toContainText('Awarded shares: 480');await expect(initial).toContainText('Final vest date: 2029-12-01');
  await form.getByRole('button',{name:'Add RSU grant',exact:true}).click();const refresher=form.getByRole('group',{name:'RSU grant 2',exact:true});
  for(const [label,value] of Object.entries({'Grant name':'Refresher award','Grant value ($)':'24000.00','Grant share price ($)':'120.00','Actual awarded shares (optional)':'199.123456','Vesting start date':'2027-06-30','Vesting term (months)':'24','Cliff (months)':'6','Shares sold for withholding (%)':'35.00'}))await refresher.getByLabel(label,{exact:true}).fill(value);
  await refresher.getByLabel('Vesting frequency',{exact:true}).selectOption('quarterly');await form.getByRole('button',{name:'Save account',exact:true}).click();
  await expect(page.getByTestId('save-status')).toContainText('Inputs v1');const held=page.getByTestId('annual-2026-account-accounts-1-closing');await held.locator('xpath=ancestor::details').locator('summary').click();await expect(held).toHaveText('$10,800.00');
  await page.getByRole('button',{name:'Show months for 2026',exact:true}).click();const january=page.getByTestId('monthly-2026-01-account-accounts-1-closing');await january.locator('xpath=ancestor::details').locator('summary').click();await expect(january).toHaveText('$900.00');
  const badPrice=refresher.getByLabel('Grant share price ($)',{exact:true});await badPrice.fill('1.234');await form.getByRole('button',{name:'Save account',exact:true}).click();
  await expect(badPrice).toHaveValue('1.234');await expect(badPrice).toHaveAttribute('aria-invalid','true');await expect(page.getByTestId('save-status')).toContainText('Inputs v1');await form.getByRole('button',{name:'Review Grant share price ($)',exact:true}).click();await expect(badPrice).toBeFocused();
  await page.getByText('Backups and recovery',{exact:true}).click();const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON backup',exact:true}).click();const file=await (await pending).path();if(!file)throw new Error('Missing RSU backup');
  const backup=await readFile(file,'utf8'),saved=JSON.parse(backup) as PlanDocument;expect(saved.accounts[0]?.rsu?.grants).toHaveLength(2);expect(saved.accounts[0]?.rsu?.grants[1]?.grantSharePriceCents).toBe(12000);expect(saved.accounts[0]?.rsu?.grants[1]?.awardedShares).toBe(199.123456);
  await page.getByLabel('Import JSON backup',{exact:true}).setInputFiles({name:'rsu-plan.json',mimeType:'application/json',buffer:Buffer.from(backup)});await expect(refresher.getByLabel('Grant share price ($)',{exact:true})).toHaveValue('120.00');await expect(page.getByTestId('draft-status')).toBeEmpty();
  await page.reload();await page.getByRole('button',{name:'Investments',exact:true}).click();await expect(refresher.getByLabel('Actual awarded shares (optional)',{exact:true})).toHaveValue('199.123456');
});
