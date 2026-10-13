import {syncFormFeedback} from './form-feedback';
import {createDisclosureController} from './disclosures';
import {reviewTarget} from './navigation';
import type {IssueViewContext} from './issue-presentation';
import { createPlan,loadRuleSet,type Issue,type PlanDocument,type RuleSet } from '../engine';
import { button,element } from './fields';
import { createWorkspace,type WorkspaceController,type WorkspaceInitialization,type WorkspaceOperation } from './state';
import { loadPlan,restorePlan,type StoragePort } from './storage';
import { renderHouseholdForm } from './forms/household';
import { renderIncomeForm } from './forms/income';
import { renderExpensesDebtsForm } from './forms/expenses-debts';
import { renderInvestmentsForm,mountInvestmentAllocation } from './forms/investments';
import { renderPropertiesForm } from './forms/properties';
import { renderProjection } from './views/projection';
import { renderIssues,renderIssueDetails } from './views/issues';

function downloadText(text:string,name:string):void {
  if(typeof URL.createObjectURL!=='function')return;
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=element('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);
}

const cleanups=new WeakMap<HTMLElement,()=>void>();
export function unmountApp(root:HTMLElement):void {cleanups.get(root)?.();cleanups.delete(root);}

export function mountApp(root:HTMLElement,plan:PlanDocument,storage:StoragePort,rules:RuleSet,initial?:WorkspaceInitialization):WorkspaceController {
  unmountApp(root);
  const controller=createWorkspace(plan,storage,rules);
  const disclosures=createDisclosureController(root);
  const context:IssueViewContext={disclosures,readState:controller.getState,review:target=>{disclosures.closeWithin(root,false);reviewTarget(root,target);}};
  if(initial)controller.resetPlan(plan,initial);
  root.replaceChildren();root.className='workspace';
  const header=element('header');header.append(element('h1','LifeLook'));
  const status=element('p');status.dataset.testid='save-status';const draftStatus=element('p');draftStatus.dataset.testid='draft-status';const announcement=element('p');announcement.setAttribute('role','status');announcement.dataset.testid='save-announcement';announcement.className='save-announcement';const recovery=element('div');recovery.dataset.testid='persistence-warning';header.append(status,draftStatus,announcement,recovery);
  const backup=element('details');backup.append(element('summary','Backups and recovery'));const backupStatus=element('p');backupStatus.setAttribute('role','status');
  backup.append(element('p','Exports applied inputs. Record drafts are excluded.'),button('Export JSON backup',()=>{downloadText(controller.exportBackup(),'lifelook-foundation.json');backupStatus.textContent='JSON backup exported.';}));
  const importLabel=element('label','Import JSON backup'),importInput=element('input');importInput.type='file';importInput.accept='.json,application/json';const consequence=element('p','Replaces all inputs and discards record drafts.');consequence.id='backup-import-consequence';importInput.setAttribute('aria-describedby',consequence.id);backup.append(consequence);importLabel.append(importInput);const backupFeedback=element('div');backup.append(importLabel,backupStatus,backupFeedback);
  importInput.addEventListener('change',()=>{const file=importInput.files?.[0];if(!file)return;const reader=new FileReader();reader.addEventListener('load',()=>{
    const restored=restorePlan(String(reader.result),controller.getState().savedPlan,storage);
    disclosures.closeWithin(backupFeedback,false);backupFeedback.replaceChildren();
    if(restored.accepted){controller.resetPlan(restored.plan,{persisted:restored.persisted,persistenceIssues:restored.issues.filter(issue=>issue.code==='storage-write-failed')});backupStatus.textContent=restored.persisted?'Backup restored.':'Backup restored in memory; Unsaved. Export a backup before closing.';}
    else {backupStatus.textContent='Backup not restored. Current inputs and drafts retained. Choose a valid backup.';renderIssues(backupFeedback,restored.issues,context,'Backup problems');}
    importInput.value='';
  });reader.addEventListener('error',()=>{backupStatus.textContent='The backup file could not be read. The current plan has been retained.';});reader.readAsText(file);});header.append(backup);root.append(header);
  const layout=element('div');layout.className='workspace-layout';const editor=element('section'),report=element('section');editor.setAttribute('aria-label','Financial inputs');report.setAttribute('aria-label','Saved projection');layout.append(editor,report);root.append(layout);
  const nav=element('nav');nav.setAttribute('aria-label','Input sections');editor.append(nav);
  const sections:readonly [string,(root:HTMLElement,controller:WorkspaceController,ui?:IssueViewContext)=>void][]=[['Household',renderHouseholdForm],['Income',renderIncomeForm],['Expenses and debts',renderExpensesDebtsForm],['Investments',renderInvestmentsForm],['Properties',renderPropertiesForm]];
  const containers=sections.map(([label,renderer],index)=>{const container=element('section');container.hidden=index!==0;container.dataset.section=label;const tab=button(label,()=>{containers.forEach(c=>{if(c.container!==container)disclosures.closeWithin(c.container,false);c.container.hidden=c.container!==container;});nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===tab)));});tab.setAttribute('aria-pressed',String(index===0));nav.append(tab);editor.append(container);return {container,renderer};});
  const investments=containers.find(item=>item.container.dataset.section==='Investments')!;
  const allocationHost=element('div'),investmentRecords=element('div');investments.container.append(allocationHost,investmentRecords);
  const allocationEditor=mountInvestmentAllocation(allocationHost,controller,context);
  const projectionRoot=element('div');report.append(projectionRoot);
  let savedIdentity:PlanDocument|undefined,draftKeys='',shownPersistence:readonly Issue[]|undefined;
  const render=(operation?:WorkspaceOperation)=>{const state=controller.getState(),keys=Object.keys(state.drafts).sort().join('|'),newKeys=Object.values(state.drafts).filter(d=>d.section!=='household'&&!((state.savedPlan[d.section]??[]) as readonly {id:string}[]).some(r=>r.id===d.recordId)).map(d=>d.recordId).sort().join('|'),changed=savedIdentity!==state.savedPlan;status.textContent=`${state.persisted?'Saved':'Unsaved'} · Inputs v${state.savedPlan.revision}`;draftStatus.textContent=[keys?`${Object.keys(state.drafts).length} drafts · Draft edits not applied`:'',state.allocationDraft?'Allocation edits not applied':''].filter(Boolean).join(' · ');
    const allocationOperation=operation?.kind==='save'&&operation.recordId===controller.getAllocationDraft().recordId;
    if(operation)announcement.textContent=allocationOperation?(operation.kind==='save'&&operation.result.accepted?(operation.result.persisted?`Allocation applied · v${state.savedPlan.revision}`:`Allocation applied in memory · v${state.savedPlan.revision}. Export a recovery backup.`):'Allocation not applied. Review the errors and Apply again.'):operation.kind==='restore'?(operation.persisted?'Backup restored.':'Backup restored in memory. Export a recovery backup.') : operation.result.accepted?(operation.result.persisted?`Inputs ${operation.kind==='remove'?'removed':'applied'} · v${state.savedPlan.revision}`:`Inputs applied in memory · v${state.savedPlan.revision}. Export a recovery backup.`):'Inputs not applied. Review the errors and save again.';
    recovery.hidden=state.persistenceIssues.length===0;
    if(state.persistenceIssues!==shownPersistence){disclosures.closeWithin(recovery,false);recovery.replaceChildren();shownPersistence=state.persistenceIssues;if(state.persistenceIssues.length){
      const write=state.persistenceIssues.some(i=>i.code==='storage-write-failed');recovery.append(element('strong',write?'Inputs are only in memory; browser saving failed.':'Saved inputs could not be loaded; this workspace is in memory.'),button('Export recovery backup',()=>downloadText(controller.exportBackup(),'lifelook-foundation-recovery.json')),button('Open backups and recovery',()=>{backup.open=true;}));const failures=element('div');renderIssues(failures,state.persistenceIssues,context,'Recovery details');recovery.append(failures);
    }}

    if(changed)renderProjection(projectionRoot,state.projection,context);
    const active=document.activeElement instanceof HTMLInputElement||document.activeElement instanceof HTMLSelectElement?document.activeElement:undefined;const activeRecord=active?.closest<HTMLElement>('[data-record-id]')?.dataset.recordId,activeField=active?.dataset.field;const selection=active instanceof HTMLInputElement&&active.type==='text'?[active.selectionStart,active.selectionEnd] as const:undefined;
    if(changed||draftKeys!==newKeys){for(const {container,renderer} of containers){const recordRoot=container===investments.container?investmentRecords:container;disclosures.closeWithin(recordRoot,false);renderer(recordRoot,controller,context);}}
    syncFormFeedback(editor,controller,context);
    for(const feedback of editor.querySelectorAll<HTMLElement>('[data-operation-feedback]')){disclosures.closeWithin(feedback,false);feedback.remove();}
    if(operation?.kind==='remove'&&!operation.result.accepted){
      const form=[...editor.querySelectorAll<HTMLElement>('form[data-record-id]')].find(node=>node.dataset.recordId===operation.recordId);
      if(form){const feedback=element('div');feedback.dataset.operationFeedback='';feedback.append(element('strong','Record not removed. Correct the linked inputs, then remove again.'));renderIssueDetails(feedback,operation.result.issues.map(issue=>({issue})),context);form.append(feedback);}
    }
    if(activeField&&activeRecord&&!active?.isConnected){const form=[...editor.querySelectorAll<HTMLElement>('[data-record-id]')].find(node=>node.dataset.recordId===activeRecord);const replacement=[...form?.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-field]')??[]].find(node=>node.dataset.field===activeField);replacement?.focus();if(selection&&replacement instanceof HTMLInputElement&&replacement.type==='text')replacement.setSelectionRange(selection[0],selection[1]);}
    savedIdentity=state.savedPlan;draftKeys=newKeys;
  };
  const unsubscribe=controller.subscribe(render);cleanups.set(root,()=>{unsubscribe();allocationEditor.dispose();disclosures.dispose();});render();return controller;
}

/** Browser alone reads today's local calendar and storage. The engine receives explicit inputs. */
export function startBrowserApp(root:HTMLElement,storage?:StoragePort):WorkspaceController {
  const port=storage??{getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,value:string)=>window.localStorage.setItem(key,value)};
  const loaded=loadPlan(port),today=new Date(),date=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const plan=loaded.status==='loaded'?loaded.plan:createPlan(date,globalThis.crypto?.randomUUID?.()??`plan-${Date.now()}`);
  const controller=mountApp(root,plan,port,loadRuleSet(),{persisted:loaded.status==='loaded',persistenceIssues:loaded.status==='invalid'||loaded.status==='read-failed'?loaded.issues:[]});
  if(loaded.status==='invalid')root.querySelector('header')?.append(button('Download unreadable saved backup',()=>downloadText(loaded.raw,'lifelook-unreadable-saved-backup.json')));
  return controller;
}
