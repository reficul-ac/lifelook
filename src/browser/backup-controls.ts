import {button,element} from './fields';
import {openScenarioDialog} from './scenario-controls';
import {downloadWorkspaceText} from './scenario-app';
import {parseBackup,type BackupPayload} from './workspace-backups';
import type {ScenarioManager,ScenarioOperationResult} from './scenario-manager';
import type {WorkspaceIssue} from './scenario-workspace';
let consequenceSequence=0;
export function mountBackupControls(root:HTMLElement,manager:ScenarioManager):{dispose():void}{
 const disclosure=element('details');disclosure.className='workspace-backups';disclosure.append(element('summary','Backups and recovery'),element('p','Exports applied inputs. Record and allocation drafts are excluded.'));root.append(disclosure);
 const status=element('p');status.setAttribute('role','status');const errors=element('ul'),rawHost=element('div');let disposed=false,requestGeneration=0,reader:FileReader|undefined,flow:ReturnType<typeof openScenarioDialog>|undefined,activeSession=manager.getActiveSession(),workspaceGeneration=manager.getState().workspaceGeneration;
 const fileInputs:HTMLInputElement[]=[];
 const present=(issues:readonly WorkspaceIssue[])=>{errors.replaceChildren(...issues.map(issue=>element('li',`${issue.scenarioName?issue.scenarioName+' · ':''}${issue.field?issue.field+': ':''}${issue.explanation}`)));};
 const cancel=()=>{requestGeneration++;if(reader){reader.onload=reader.onerror=null;if(reader.readyState===1)reader.abort();reader=undefined;}flow?.close();flow=undefined;fileInputs.forEach(input=>{input.disabled=false;input.value='';});};
 disclosure.append(button('Export scenario JSON',()=>{const state=manager.getState(),scenario=state.document.scenarios.find(s=>s.id===state.document.activeScenarioId)!;const slug=scenario.name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'scenario';downloadWorkspaceText(manager.exportScenario(scenario.id),`lifelook-scenario-${slug}.json`);status.textContent='Scenario JSON exported.';}),button('Export workspace backup',()=>{downloadWorkspaceText(manager.exportWorkspace(),'lifelook-workspace.json');status.textContent='Workspace backup exported.';}));
 function input(labelText:string,mode:'import'|'replace'|'restore'|'recovery'){
  const label=element('label',labelText),file=element('input');file.type='file';file.accept='.json,application/json';label.append(file);const consequence=element('p',mode==='import'?'Imports applied inputs as a new named experiment. Existing scenarios and unfinished edits are retained.':mode==='replace'?'Replaces the named scenario’s applied inputs and unfinished edits after confirmation.':'Replaces all current scenarios and unfinished edits after confirmation.');consequence.id=`backup-consequence-${++consequenceSequence}`;file.setAttribute('aria-describedby',consequence.id);const group=element('div');group.append(label,consequence);disclosure.append(group);fileInputs.push(file);
  file.addEventListener('change',()=>{
   const selected=file.files?.[0];if(!selected||disposed)return;cancel();errors.replaceChildren();status.textContent='Reading backup…';const state=manager.getState(),target=manager.captureTarget(state.document.activeScenarioId)!,capturedWorkspaceGeneration=state.workspaceGeneration,token=requestGeneration,capturedSession=manager.getActiveSession();
   const current=()=>!disposed&&token===requestGeneration&&manager.getState().workspaceGeneration===capturedWorkspaceGeneration&&manager.isCurrentTarget(target)&&manager.getActiveSession()===capturedSession;
   fileInputs.forEach(input=>input.disabled=true);const pending=new FileReader();reader=pending;
   pending.onerror=()=>{if(!current())return;reader=undefined;fileInputs.forEach(input=>{input.disabled=false;input.value='';});status.textContent='The backup file could not be read. Current inputs and drafts are retained.';};
   pending.onload=()=>{
    if(!current())return;reader=undefined;fileInputs.forEach(input=>{input.disabled=false;input.value='';});const parsed=parseBackup(String(pending.result),mode==='restore'?'workspace':mode==='recovery'?'either':'plan');
    if(!parsed.ok){status.textContent='Backup not restored. Current inputs and drafts retained. Choose a valid backup.';present(parsed.issues);return;}
    confirm(parsed.payload,mode,file,current);
   };
   pending.readAsText(selected);
  });return group;
 }
 function confirm(payload:BackupPayload,mode:'import'|'replace'|'restore'|'recovery',invoker:HTMLElement,current:()=>boolean){
  const state=manager.getState(),target=manager.captureTarget(state.document.activeScenarioId)!,name=state.document.scenarios.find(s=>s.id===target.scenarioId)!.name;
  flow=openScenarioDialog(root,mode==='import'?'Import scenario':mode==='replace'?`Replace ${name}`:mode==='restore'?'Restore workspace':'Replace unreadable saved data',invoker);const dialog=flow.dialog;
  let nameInput:HTMLInputElement|undefined;
  if(mode==='import'){const label=element('label','Scenario name');nameInput=element('input');nameInput.type='text';nameInput.value='Imported scenario';label.append(nameInput);dialog.append(label,element('p','Creates a new independent experiment. Existing scenarios and unfinished edits stay here.'));}
  else if(mode==='replace')dialog.append(element('p',`Replaces ${name}'s applied inputs and unfinished edits. Other scenarios are retained.`));
  else if(payload.kind==='workspace'){const doc=payload.document;dialog.append(element('p',`${doc.scenarios.length} scenarios. Baseline: ${doc.scenarios.find(s=>s.id===doc.baselineScenarioId)!.name}. Active: ${doc.scenarios.find(s=>s.id===doc.activeScenarioId)!.name}.`),element('p','Replaces all current scenarios and unfinished edits.'));}
  else dialog.append(element('p','Creates a Master-only workspace from the applied scenario inputs. Replaces all current scenarios and unfinished edits.'));
  if(mode==='recovery')dialog.append(element('p','Overwrites unreadable saved workspace data. The original bytes remain available for download.'));
  const problems=element('p');problems.setAttribute('role','alert');const label=mode==='import'?'Import scenario':mode==='replace'?'Replace scenario':mode==='restore'?'Restore workspace':'Replace unreadable saved data';
  const accept=button(label,()=>{
   if(!current()){cancel();status.textContent='This backup action is obsolete. Choose the file again.';return;}
   let result:ScenarioOperationResult;
   if(mode==='import'&&payload.kind==='plan')result=manager.importScenario(payload.plan,nameInput!.value);
   else if(mode==='replace'&&payload.kind==='plan')result=manager.replaceScenario(target,payload.plan);
   else if(mode==='restore'&&payload.kind==='workspace')result=manager.restoreWorkspace(payload.document);
   else result=manager.replaceUnreadableData(payload);
   if(result.accepted){flow?.close();flow=undefined;status.textContent=result.persisted?'Backup restored. Saved locally.':'Backup restored in memory; Unsaved locally. Export a workspace backup before closing.';}
   else {problems.textContent=result.issues.map(i=>i.explanation).join(' ');if(nameInput){nameInput.setAttribute('aria-invalid','true');nameInput.focus();}}
  });dialog.append(problems,accept,button('Cancel',()=>{cancel();status.textContent='Backup action cancelled. Current inputs and drafts retained.';}));nameInput?.addEventListener('input',()=>{problems.textContent='';nameInput!.removeAttribute('aria-invalid');});(nameInput??dialog.querySelector<HTMLButtonElement>('button:last-child'))?.focus();nameInput?.select();status.textContent='Backup validated. Confirm the action to apply it.';
 }
 input('Import scenario JSON','import');const replacementInput=input('Replace this scenario from JSON','replace');input('Restore workspace backup','restore');const recoveryInput=input('Replace unreadable saved data','recovery');disclosure.append(rawHost,status,errors);
 const render=()=>{if(disposed)return;const state=manager.getState();if(state.activeSession!==activeSession||state.workspaceGeneration!==workspaceGeneration){activeSession=state.activeSession;workspaceGeneration=state.workspaceGeneration;cancel();}
  replacementInput.querySelector('p')!.textContent=`Replaces ${state.document.scenarios.find(s=>s.id===state.document.activeScenarioId)!.name}'s applied inputs and unfinished edits after confirmation.`;recoveryInput.hidden=state.persistence.suspension!=='unreadable';rawHost.replaceChildren();if(state.persistence.recovery)rawHost.append(button('Download unreadable saved backup',()=>downloadWorkspaceText(state.persistence.recovery!.raw,'lifelook-unreadable-saved-backup.json')));if(state.persistence.suspension==='unreadable'&&state.persistence.persistenceIssues.some(i=>i.code==='storage-write-failed'))rawHost.append(button('Retry unreadable data replacement',()=>{const result=manager.retryRecoveryReplacement();status.textContent=result.persisted?'Replacement saved locally.':'Replacement is still only in memory. Export a workspace backup.';}));
 };
 const unsubscribe=manager.subscribe(render);render();return {dispose(){if(disposed)return;disposed=true;cancel();unsubscribe();}};
}
