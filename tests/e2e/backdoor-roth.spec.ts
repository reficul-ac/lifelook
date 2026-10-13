import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {makeAllocationPlan} from '../helpers/allocations';

test('funds a phased-out Roth through a recurring clean backdoor route and restores it',async({page})=>{
  const base=makeAllocationPlan();
  const plan=makeAllocationPlan({horizonYears:2,salaries:[{...base.salaries[0]!,annualGrossCents:40000000}],accounts:[...base.accounts,{...base.accounts[1]!,id:'roth',name:'Roth IRA',type:'roth-ira'}]});
  await page.addInitScript(doc=>{if(localStorage.getItem('lifelook.foundation.plan.v1')===null)localStorage.setItem('lifelook.foundation.plan.v1',JSON.stringify(doc));},plan);
  await page.goto('/');await page.getByRole('button',{name:'Investments',exact:true}).click();
  const editor=page.getByRole('form',{name:'Cash flow allocation'});
  await editor.getByRole('button',{name:'Add allocation',exact:true}).click();
  const row=editor.getByRole('group',{name:'Allocation 1',exact:true});
  await row.getByLabel('Allocation destination',{exact:true}).selectOption({label:'Roth IRA'});
  await row.getByLabel('Max out for the year',{exact:true}).check();
  await expect(row).toContainText('Total target: $0.00');
  await row.getByLabel('Use backdoor Roth',{exact:true}).check();
  await row.getByLabel('Traditional IRA for conversion',{exact:true}).selectOption({label:'IRA'});
  await row.getByLabel('Confirm clean IRA history',{exact:true}).check();
  await editor.getByLabel('Excess allocation account',{exact:true}).selectOption({label:'Stocks'});
  await expect(row).toContainText('Total target: $7,500.00');
  await editor.getByRole('button',{name:'Apply allocation',exact:true}).click();
  await expect(page.getByTestId('save-status')).toContainText('Inputs v1');
  for(const [year,balance] of [[2026,'$7,500.00'],[2027,'$15,000.00']] as const){
    const roth=page.getByTestId(`annual-${year}-account-roth-closing`);
    await roth.locator('xpath=ancestor::details').locator('summary').click();
    await expect(roth).toHaveText(balance);
    await expect(page.getByTestId(`annual-${year}-account-ira-closing`)).toHaveText('$0.00');
  }
  await editor.getByLabel('Allocation year',{exact:true}).selectOption('2027');
  await expect(row).toContainText('Total target: $7,500.00');
  await expect(page.getByTestId('save-status')).toContainText('Inputs v1');
  await page.getByText('Backups and recovery',{exact:true}).click();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON backup',exact:true}).click();
  const file=await(await pending).path();if(!file)throw new Error('Missing backup');
  const backup=await readFile(file,'utf8'),saved=JSON.parse(backup);
  expect(saved.cashFlowAllocation.entries[0].destination).toEqual({kind:'account',accountId:'roth',backdoorRoth:{traditionalIraAccountId:'ira',cleanIraHistory:{known:true,value:true}}});
  expect(saved.cashFlowAllocation.entries[0].amount).toEqual({kind:'max-annual'});
  expect(backup).not.toContain('conversionInCents');
  await row.getByLabel('Use backdoor Roth',{exact:true}).uncheck();
  await page.getByLabel('Import JSON backup',{exact:true}).setInputFiles({name:'backdoor.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await expect(row.getByLabel('Use backdoor Roth',{exact:true})).toBeChecked();
  await page.reload();await page.getByRole('button',{name:'Investments',exact:true}).click();
  await expect(row.getByLabel('Traditional IRA for conversion',{exact:true})).toHaveValue('ira');
  await expect(row.getByLabel('Confirm clean IRA history',{exact:true})).toBeChecked();
  await page.setViewportSize({width:390,height:844});
  const box=await editor.boundingBox();expect(box).not.toBeNull();expect(box!.x+box!.width).toBeLessThanOrEqual(391);
  await editor.screenshot({path:'/tmp/lifelook-backdoor-roth/editor.png'});
});
