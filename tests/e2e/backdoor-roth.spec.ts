import {revealDetails} from './helpers/disclosures';
import {preloadWorkspace,readActivePlan,replaceScenarioFromJson,openRecord,openSettings,applyEdit} from './helpers/workspace';
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {makeAllocationPlan} from '../helpers/allocations';


test('funds a phased-out Roth through a recurring clean backdoor route and restores it',async({page})=>{
  const base=makeAllocationPlan();
  const plan=makeAllocationPlan({horizonYears:2,salaries:[{...base.salaries[0]!,annualGrossCents:40000000}],accounts:[...base.accounts,{...base.accounts[1]!,id:'roth',name:'Roth IRA',type:'roth-ira'}]});
  await preloadWorkspace(page,plan);await openRecord(page,{kind:'allocation'});
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
  await applyEdit(page);
  expect((await readActivePlan(page)).revision).toBe(1);
  for(const [year,balance] of [[2026,'$7,500.00'],[2027,'$15,000.00']] as const){
    const roth=page.getByTestId(`annual-${year}-account-roth-closing`);
    await revealDetails(roth);
    await expect(roth).toHaveText(balance);
    await expect(page.getByTestId(`annual-${year}-account-ira-closing`)).toHaveText('$0.00');
  }
  await editor.getByLabel('Allocation year',{exact:true}).selectOption('2027');
  await expect(row).toContainText('Total target: $7,500.00');
  expect((await readActivePlan(page)).revision).toBe(1);
  await openSettings(page);await page.getByText('Backups and recovery',{exact:true}).click();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export scenario JSON',exact:true}).click();
  const file=await(await pending).path();if(!file)throw new Error('Missing backup');
  const backup=await readFile(file,'utf8'),saved=JSON.parse(backup);
  expect(saved.cashFlowAllocation.entries[0].destination).toEqual({kind:'account',accountId:'roth',backdoorRoth:{traditionalIraAccountId:'ira',cleanIraHistory:{known:true,value:true}}});
  expect(saved.cashFlowAllocation.entries[0].amount).toEqual({kind:'max-annual'});
  expect(backup).not.toContain('conversionInCents');
  await row.getByLabel('Use backdoor Roth',{exact:true}).uncheck();
  await replaceScenarioFromJson(page,backup);await openRecord(page,{kind:'allocation'});
  await expect(row.getByLabel('Use backdoor Roth',{exact:true})).toBeChecked();
  await page.reload();await openRecord(page,{kind:'allocation'});
  await expect(row.getByLabel('Traditional IRA for conversion',{exact:true})).toHaveValue('ira');
  await expect(row.getByLabel('Confirm clean IRA history',{exact:true})).toBeChecked();
  await page.setViewportSize({width:390,height:844});
  const box=await editor.boundingBox();expect(box).not.toBeNull();expect(box!.x+box!.width).toBeLessThanOrEqual(391);
  await editor.screenshot({path:'/tmp/lifelook-backdoor-roth/editor.png'});
});

test('requires a separate account Apply and preserves an unapplied allocation through cancel and return',async({page})=>{
 const base=makeAllocationPlan(),plan=makeAllocationPlan({accounts:[...base.accounts.filter(account=>account.type!=='traditional-ira'),{...base.accounts[1]!,id:'roth',name:'Roth IRA',type:'roth-ira'}]});
 await preloadWorkspace(page,plan);await openRecord(page,{kind:'allocation'});const editor=page.getByRole('form',{name:'Cash flow allocation'});await editor.getByRole('button',{name:'Add allocation',exact:true}).click();const row=editor.getByRole('group',{name:'Allocation 1',exact:true});await row.getByLabel('Allocation destination',{exact:true}).selectOption('account:roth');await row.getByLabel('Max out for the year',{exact:true}).check();await row.getByLabel('Use backdoor Roth',{exact:true}).check();await row.getByRole('button',{name:'Add source IRA',exact:true}).click();expect((await readActivePlan(page)).accounts).toHaveLength(plan.accounts.length);await page.getByRole('button',{name:'Cancel and return',exact:true}).click();expect((await readActivePlan(page)).accounts).toHaveLength(plan.accounts.length);await row.getByRole('button',{name:'Add source IRA',exact:true}).click();await applyEdit(page);
 const withAccount=await readActivePlan(page);expect(withAccount.revision).toBe(1);expect(withAccount.accounts).toHaveLength(plan.accounts.length+1);expect(withAccount.cashFlowAllocation).toEqual(plan.cashFlowAllocation);await expect(row.getByLabel('Confirm clean IRA history',{exact:true})).not.toBeChecked();await row.getByLabel('Confirm clean IRA history',{exact:true}).check();await applyEdit(page);expect((await readActivePlan(page)).revision).toBe(2);await revealDetails(page.getByTestId('annual-2026-account-roth-closing'));await expect(page.getByTestId('annual-2026-account-roth-closing')).toHaveText('$7,500.00');
});
