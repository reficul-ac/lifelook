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
 const backups=page.locator('.workspace-backups');if(!await backups.evaluate(node=>(node as HTMLDetailsElement).open))await backups.locator('summary').click();
 await page.getByLabel('Replace this scenario from JSON',{exact:true}).setInputFiles({name:'scenario.json',mimeType:'application/json',buffer:Buffer.from(json)});
 await expect(backups.locator('[role=status]')).toHaveText(/Backup validated|Backup not restored/);const dialog=page.getByRole('dialog');if(await dialog.isVisible())await dialog.getByRole('button',{name:'Replace scenario',exact:true}).click();
}
