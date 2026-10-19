import {expect,test} from '@playwright/test';
import {makePlan} from '../helpers/plans';
import {applyEdit,openRecord,openSettings,preloadWorkspace,readActivePlan,waitForPreview} from './helpers/workspace';

test('native date-only leap day survives preview, appearance change, Apply and reload',async({page})=>{
 await preloadWorkspace(page,makePlan());const editor=await openRecord(page,{kind:'record',section:'household',recordId:'household'});
 const settings=await openSettings(page),date=editor.getByLabel('Filer 1 birth date value',{exact:true});
 await expect(date).toHaveAttribute('type','date');await date.fill('1980-02-29');await date.focus();
 await waitForPreview(page);await expect(date).toBeFocused();await expect(date).toHaveValue('1980-02-29');
 await settings.getByLabel('Appearance',{exact:true}).selectOption('light');await expect(date).toBeFocused();await expect(date).toHaveValue('1980-02-29');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await applyEdit(page);
 expect((await readActivePlan(page)).household.filers[0]!.birthDate).toEqual({known:true,value:'1980-02-29'});
 await page.reload();await openRecord(page,{kind:'record',section:'household',recordId:'household'});await expect(date).toHaveValue('1980-02-29');
});

test('native month entry and keyboard switch retain ISO values through a completed preview',async({page})=>{
 await preloadWorkspace(page,makePlan({horizonYears:3,children:[{id:'child',name:'Synthetic child',birthMonth:'2026-01',includeAge18:false}]}));
 const editor=await openRecord(page,{kind:'record',section:'children',recordId:'child'}),month=editor.getByLabel('Child birth month',{exact:true});
 await expect(month).toHaveAttribute('type','month');await month.fill('2028-02');await month.focus();await waitForPreview(page);await expect(month).toBeFocused();await expect(month).toHaveValue('2028-02');
 const toggle=editor.getByRole('switch',{name:'Include full year at age 18',exact:true});await toggle.focus();await toggle.press('Space');await expect(toggle).toBeChecked();await waitForPreview(page);await expect(toggle).toBeFocused();
 await applyEdit(page);expect((await readActivePlan(page)).children).toEqual([{id:'child',name:'Synthetic child',birthMonth:'2028-02',includeAge18:true}]);
 await page.reload();await openRecord(page,{kind:'record',section:'children',recordId:'child'});await expect(month).toHaveValue('2028-02');await expect(toggle).toBeChecked();
});

test('empty required native date pauses preview and leaves the applied ISO date unchanged',async({page})=>{
 const plan=makePlan({otherIncome:[{id:'income',name:'Dated cash',classification:'non-taxable',amountCents:10000,frequency:'monthly',startDate:'2026-01-31',annualGrowthBps:0}]});
 await preloadWorkspace(page,plan);const editor=await openRecord(page,{kind:'record',section:'otherIncome',recordId:'income'}),date=editor.getByLabel('Income start date',{exact:true});
 await date.fill('');await expect(editor.locator('[data-preview-status]')).toHaveAttribute('data-preview-status','invalid');await expect(date).toHaveValue('');expect((await readActivePlan(page)).otherIncome[0]!.startDate).toBe('2026-01-31');
 await date.fill('2028-02-29');await date.blur();await waitForPreview(page);await expect(date).toHaveValue('2028-02-29');await applyEdit(page);expect((await readActivePlan(page)).otherIncome[0]!.startDate).toBe('2028-02-29');
});
