import {expect,type Page} from '@playwright/test';
import type {PlanDocument} from '../../../src/engine';
import {createScenarioWorkspace,type ScenarioWorkspaceDocument} from '../../../src/browser/scenario-workspace';
import {WORKSPACE_STORAGE_KEY} from '../../../src/browser/workspace-storage';
import {PLAN_STORAGE_KEY} from '../../../src/browser/storage';
export async function preloadWorkspace(page:Page,plan:PlanDocument):Promise<void>{
 const document=createScenarioWorkspace(plan,'master');await page.addInitScript(({key,document})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify(document));},{key:WORKSPACE_STORAGE_KEY,document});await page.goto('/');
}
export async function preloadLegacyPlan(page:Page,plan:PlanDocument):Promise<void>{
 await page.addInitScript(({workspaceKey,legacyKey,plan})=>{if(localStorage.getItem(workspaceKey)===null&&localStorage.getItem(legacyKey)===null)localStorage.setItem(legacyKey,JSON.stringify(plan));},{workspaceKey:WORKSPACE_STORAGE_KEY,legacyKey:PLAN_STORAGE_KEY,plan});await page.goto('/');
}
export async function readWorkspace(page:Page):Promise<ScenarioWorkspaceDocument>{return page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),WORKSPACE_STORAGE_KEY);}
export async function readActivePlan(page:Page):Promise<PlanDocument>{const document=await readWorkspace(page);return document.scenarios.find(s=>s.id===document.activeScenarioId)!.plan;}
export async function replaceScenarioFromJson(page:Page,json:string):Promise<void>{
 await openSettings(page);const backups=page.locator('.workspace-backups');if(!await backups.evaluate(node=>(node as HTMLDetailsElement).open))await backups.locator('summary').click();
 await page.getByLabel('Replace this scenario from JSON',{exact:true}).setInputFiles({name:'scenario.json',mimeType:'application/json',buffer:Buffer.from(json)});
 await expect(backups.locator('[role=status]')).toHaveText(/Backup validated|Backup not restored/);const dialog=page.getByRole('dialog');if(await dialog.isVisible())await dialog.getByRole('button',{name:'Replace scenario',exact:true}).click();
}

import type {EditTarget} from '../../../src/browser/edit-types';
import type {Destination} from '../../../src/browser/workspace-route';
import type {Locator} from '@playwright/test';
export async function openCollection(page:Page,destination:Destination):Promise<Locator>{await page.locator(`button[data-destination="${destination}"]`).click();const collection=page.locator('[data-collection]');await expect(collection).toBeVisible();return collection;}
export async function openRecord(page:Page,target:EditTarget):Promise<Locator>{const destination:Destination=target.kind==='allocation'||target.section==='accounts'||target.section==='contributions'?'accounts':target.section==='salaries'||target.section==='otherIncome'?'income':target.section==='properties'||target.section==='rentals'?'properties':target.section==='household'?'household':'spending';await openCollection(page,destination);const key=target.kind==='allocation'?'allocation':`${target.section}:${target.recordId}`;await page.locator(`[data-open-target=${JSON.stringify(key)}]`).click();const editor=page.locator('[data-active-editor]');await expect(editor).toBeVisible();return editor;}
export async function waitForPreview(page:Page):Promise<void>{await expect(page.locator('[data-active-editor] [data-preview-status]')).toHaveAttribute('data-preview-status','valid');}
export async function switchScenario(page:Page,id:string):Promise<void>{await page.getByLabel('Scenario',{exact:true}).selectOption(id);await expect(page.locator('[data-active-editor]')).toHaveCount(0);}
export async function openSettings(page:Page):Promise<Locator>{const panel=page.locator('[data-settings]');if(!await panel.isVisible())await page.getByRole('button',{name:'Settings',exact:true}).click();return panel;}
export async function applyEdit(page:Page):Promise<void>{const editor=page.locator('[data-active-editor]');const status=editor.locator('[data-preview-status]');await expect(status).not.toHaveAttribute('data-preview-status','pending');if(await status.getAttribute('data-preview-status')==='inactive')return;await editor.locator('.editor-footer').getByRole('button',{name:/^(Apply |Review inputs|Retry calculation)/}).click();await expect(status).not.toHaveAttribute('data-preview-status','pending');}
export async function openForecastDetails(page:Page):Promise<Locator>{const summary=page.getByText('Forecast details',{exact:true});if(!await summary.isVisible()&&await page.getByRole('button',{name:'Forecast',exact:true}).isVisible())await page.getByRole('button',{name:'Forecast',exact:true}).click();if(!await summary.locator('..').evaluate(node=>(node as HTMLDetailsElement).open))await summary.click();return summary.locator('..');}
export async function revealLocator(control:Locator):Promise<Locator>{if(await control.count()===0){const summary=control.page().getByText('Forecast details',{exact:true});if(await summary.count())await openForecastDetails(control.page());}const step=await control.evaluate(node=>node.closest<HTMLElement>('[data-editor-step]')?.dataset.editorStep);if(step)await control.locator('xpath=ancestor::form').locator(`[data-select-editor-step=${JSON.stringify(step)}]`).click();for(const details of await control.locator('xpath=ancestor::details').all())if(!await details.evaluate(node=>(node as HTMLDetailsElement).open))await details.locator(':scope > summary').click();return control;}
export async function revealControl(scope:Locator,label:string):Promise<Locator>{return revealLocator(scope.getByLabel(label,{exact:true}));}
export async function showMonths(page:Page,year:number):Promise<void>{await openForecastDetails(page);const show=page.getByRole('button',{name:`Show months for ${year}`,exact:true});if(await show.isVisible())await show.click();}
