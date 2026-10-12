import {syncFormFeedback} from './form-feedback';
import {createDisclosureController} from './disclosures';
import {reviewTarget} from './navigation';
import type {IssueViewContext} from './issue-presentation';
import { createPlan,loadRuleSet,type Issue,type PlanDocument,type RuleSet } from '../engine';
import { button,element } from './fields';
import { createWorkspace,type WorkspaceController } from './state';
import { loadPlan,restorePlan,type StoragePort } from './storage';
import { renderHouseholdForm } from './forms/household';
import { renderIncomeForm } from './forms/income';
import { renderExpensesDebtsForm } from './forms/expenses-debts';
import { renderInvestmentsForm } from './forms/investments';
import { renderPropertiesForm } from './forms/properties';
import { renderProjection } from './views/projection';
import { renderIssues } from './views/issues';

function downloadText(text:string,name:string):void {
  if(typeof URL.createObjectURL!=='function')return;
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=element('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);
}

const cleanups=new WeakMap<HTMLElement,()=>void>();
export function unmountApp(root:HTMLElement):void {cleanups.get(root)?.();cleanups.delete(root);}

export function mountApp(root:HTMLElement,plan:PlanDocument,storage:StoragePort,rules:RuleSet,initial?:Readonly<{persisted:boolean;issues:readonly Issue[]}>):WorkspaceController {
  unmountApp(root);
  const controller=createWorkspace(plan,storage,rules);
  const disclosures=createDisclosureController(root);
  const context:IssueViewContext={disclosures,readState:controller.getState,review:target=>{disclosures.closeWithin(root,false);reviewTarget(root,target);}};
  if(initial)controller.resetPlan(plan,initial.persisted,initial.issues);
  root.replaceChildren();root.className='workspace';
  const header=element('header');header.append(element('h1','LifeLook'),element('p','A household financial forecast with explicit assumptions and saved inputs.'));
  const status=element('p');status.setAttribute('role','status');status.dataset.testid='save-status';header.append(status);
  const backup=element('details');backup.append(element('summary','Backups and recovery'));const backupStatus=element('p');backupStatus.setAttribute('role','status');
  backup.append(button('Export JSON backup',()=>{downloadText(controller.exportBackup(),'lifelook-foundation.json');backupStatus.textContent='JSON backup exported.';}));
  const importLabel=element('label','Import JSON backup'),importInput=element('input');importInput.type='file';importInput.accept='.json,application/json';importLabel.append(importInput);backup.append(importLabel,backupStatus);
  importInput.addEventListener('change',()=>{const file=importInput.files?.[0];if(!file)return;const reader=new FileReader();reader.addEventListener('load',()=>{
    const restored=restorePlan(String(reader.result),controller.getState().savedPlan,storage);
    if(restored.accepted){controller.resetPlan(restored.plan,restored.persisted,restored.issues);backupStatus.textContent=restored.persisted?'Backup restored.':'Backup restored in memory; Unsaved. Export a backup before closing.';}
    else {backupStatus.textContent=restored.issues.map(i=>`${i.field??'Backup'}: ${i.explanation} ${i.resolution}`).join(' ');}
    importInput.value='';
  });reader.addEventListener('error',()=>{backupStatus.textContent='The backup file could not be read. The current plan has been retained.';});reader.readAsText(file);});header.append(backup);root.append(header);
  const layout=element('div');layout.className='workspace-layout';const editor=element('section'),report=element('section');editor.setAttribute('aria-label','Financial inputs');report.setAttribute('aria-label','Saved projection');layout.append(editor,report);root.append(layout);
  const nav=element('nav');nav.setAttribute('aria-label','Input sections');editor.append(nav);
  const sections:readonly [string,(root:HTMLElement,controller:WorkspaceController,ui?:IssueViewContext)=>void][]=[['Household',renderHouseholdForm],['Income',renderIncomeForm],['Expenses and debts',renderExpensesDebtsForm],['Investments',renderInvestmentsForm],['Properties',renderPropertiesForm]];
  const containers=sections.map(([label,renderer],index)=>{const container=element('section');container.hidden=index!==0;container.dataset.section=label;const tab=button(label,()=>{containers.forEach(c=>{if(c.container!==container)disclosures.closeWithin(c.container,false);c.container.hidden=c.container!==container;});nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===tab)));});tab.setAttribute('aria-pressed',String(index===0));nav.append(tab);editor.append(container);return {container,renderer};});
  const projectionRoot=element('div'),issueRoot=element('div');report.append(projectionRoot,issueRoot);
  let savedIdentity:PlanDocument|undefined,draftKeys='';
  const render=()=>{const state=controller.getState(),keys=Object.keys(state.drafts).sort().join('|'),newKeys=Object.values(state.drafts).filter(d=>d.section!=='household'&&!(state.savedPlan[d.section] as readonly {id:string}[]).some(r=>r.id===d.recordId)).map(d=>d.recordId).sort().join('|'),changed=savedIdentity!==state.savedPlan;status.textContent=`${state.persisted?'Saved':'Unsaved'} · Saved input revision ${state.savedPlan.revision}${keys?' · Draft edits have not changed the saved projection.':''}`;
    renderIssues(issueRoot,state.issues,context);
    if(changed)renderProjection(projectionRoot,state.projection,context);
    const active=document.activeElement instanceof HTMLInputElement||document.activeElement instanceof HTMLSelectElement?document.activeElement:undefined;const activeRecord=active?.closest<HTMLElement>('[data-record-id]')?.dataset.recordId,activeField=active?.dataset.field;const selection=active instanceof HTMLInputElement&&active.type==='text'?[active.selectionStart,active.selectionEnd] as const:undefined;
    if(changed||draftKeys!==newKeys){for(const {container,renderer} of containers){disclosures.closeWithin(container,false);renderer(container,controller,context);}}
    syncFormFeedback(editor,controller,context);
    if(activeField&&activeRecord&&!active?.isConnected){const form=[...editor.querySelectorAll<HTMLElement>('[data-record-id]')].find(node=>node.dataset.recordId===activeRecord);const replacement=[...form?.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-field]')??[]].find(node=>node.dataset.field===activeField);replacement?.focus();if(selection&&replacement instanceof HTMLInputElement&&replacement.type==='text')replacement.setSelectionRange(selection[0],selection[1]);}
    savedIdentity=state.savedPlan;draftKeys=newKeys;
  };
  const unsubscribe=controller.subscribe(render);cleanups.set(root,()=>{unsubscribe();disclosures.dispose();});render();return controller;
}

/** Browser alone reads today's local calendar and storage. The engine receives explicit inputs. */
export function startBrowserApp(root:HTMLElement,storage?:StoragePort):WorkspaceController {
  const port=storage??{getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,value:string)=>window.localStorage.setItem(key,value)};
  const loaded=loadPlan(port),today=new Date(),date=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const plan=loaded.status==='loaded'?loaded.plan:createPlan(date,globalThis.crypto?.randomUUID?.()??`plan-${Date.now()}`);
  const controller=mountApp(root,plan,port,loadRuleSet(),{persisted:loaded.status==='loaded',issues:loaded.status==='missing'?[]:loaded.issues});
  if(loaded.status==='invalid')root.querySelector('header details')?.append(button('Download unreadable saved backup',()=>downloadText(loaded.raw,'lifelook-unreadable-saved-backup.json')));
  return controller;
}
