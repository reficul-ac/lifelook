import {button,element} from './fields';
import {downloadWorkspaceText} from './scenario-app';
import type {ScenarioManager} from './scenario-manager';

/** Applied storage health is independent of drafts, report and appearance state. */
export function mountPersistenceStatus(root:HTMLElement,manager:ScenarioManager):{dispose():void} {
 let disposed=false,previous:unknown;
 const status=element('p');status.dataset.testid='save-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');const recovery=element('div');recovery.dataset.testid='persistence-warning';root.replaceChildren(status,recovery);
 const action=(label:string,run:()=>void)=>{const node=button(label,()=>{if(!disposed&&node.isConnected)run();});return node;};
 const render=()=>{
  if(disposed)return;const state=manager.getState(),persistence=state.persistence,label=persistence.persisted?'Applied · Saved locally':'Applied · Not saved locally';if(status.textContent!==label)status.textContent=label;
  recovery.hidden=persistence.persistenceIssues.length===0&&persistence.suspension==='none';if(previous===persistence)return;previous=persistence;recovery.replaceChildren();if(recovery.hidden)return;
  recovery.append(element('strong',persistence.suspension==='external-change'?'The saved workspace changed in another tab. Export your local workspace, then reload.':persistence.suspension==='unreadable'?'Unreadable saved data is protected. Applied inputs remain in memory.':'Applied inputs remain in memory. Browser saving failed.'));
  for(const issue of persistence.persistenceIssues)recovery.append(element('p',issue.explanation));
  const retry=action('Retry local save',()=>manager.retryLocalSave());retry.disabled=persistence.suspension!=='none';recovery.append(action('Export workspace backup',()=>downloadWorkspaceText(manager.exportWorkspace(),'lifelook-workspace.json')),retry);
  if(persistence.recovery)recovery.append(action('Download unreadable saved backup',()=>{const protectedData=manager.getState().persistence.recovery;if(protectedData)downloadWorkspaceText(protectedData.raw,'lifelook-unreadable-saved-backup.json');}));
 };
 const unsubscribe=manager.subscribe(render);render();return {dispose(){if(disposed)return;disposed=true;unsubscribe();}};
}
