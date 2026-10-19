import {mountAppearance} from './ui/appearance';
import {mountSettings} from './settings';
import {mountPersistenceStatus} from './persistence-status';
import {element,button} from './fields';
import {mountEditorView} from './editor-view';
import {mountScenarioControls} from './scenario-controls';
import {registerAppCleanup,unmountApp} from './app-lifecycle';
import {WORKSPACE_STORAGE_KEY} from './workspace-storage';
import type {ScenarioManager} from './scenario-manager';
import type {WorkspaceOperation} from './state';
export function downloadWorkspaceText(text:string,name:string):void {if(typeof URL.createObjectURL!=='function')return;const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=element('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);}
export function mountScenarioApp(root:HTMLElement,manager:ScenarioManager):void {
 unmountApp(root);root.replaceChildren();root.className='workspace';
 const header=element('header'),controlsRoot=element('div'),statusRoot=element('div'),drafts=element('p'),announcement=element('p'),settingsPanel=element('section');
 drafts.dataset.testid='draft-status';announcement.dataset.testid='save-announcement';announcement.setAttribute('role','status');announcement.className='save-announcement';
 settingsPanel.hidden=true;settingsPanel.dataset.settings='';
 const settingsButton=button('Settings',()=>{settingsPanel.hidden=!settingsPanel.hidden;settingsButton.setAttribute('aria-expanded',String(!settingsPanel.hidden));});settingsButton.setAttribute('aria-expanded','false');
 header.append(element('h1','LifeLook'),controlsRoot,statusRoot,drafts,settingsButton,announcement,settingsPanel);
 const bindingRoot=element('div');root.append(header,bindingRoot);
 const media=typeof window.matchMedia==='function'?window.matchMedia('(prefers-color-scheme: dark)'):({matches:false,addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList);
 const appearance=mountAppearance(document.documentElement,{getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)},media);
 const settings=mountSettings(settingsPanel,manager,appearance),persistence=mountPersistenceStatus(statusRoot,manager),controls=mountScenarioControls(controlsRoot,manager);
 let session=manager.getActiveSession(),generation=1,disposed=false,binding=mountEditorView(bindingRoot,session,manager,generation);
 const announce=(event:Event)=>{announcement.textContent=(event as CustomEvent<string>).detail;};root.addEventListener('scenario-announcement',announce);
 const operation=(event:Event)=>{const op=(event as CustomEvent<WorkspaceOperation>).detail;
  announcement.textContent=op.kind==='restore'?'Backup restored.':op.result.accepted?(op.kind==='remove'?'Record removed.':'Changes applied.')+(op.result.persisted?'':' Not saved locally. Export a recovery backup.'):'Inputs not applied. Review the errors and Apply again.';
 };root.addEventListener('editor-operation',operation);
 const render=()=>{if(disposed)return;const state=manager.getState();if(state.activeSession!==session){binding.dispose();session=state.activeSession;generation++;binding=mountEditorView(bindingRoot,session,manager,generation);}
  const editor=session.controller.getState(),name=state.document.scenarios.find(s=>s.id===session.scenarioId)!.name;
  const heading=bindingRoot.querySelector('[data-forecast-name]');if(heading)heading.textContent=`Forecast · ${name}`;
  const count=Object.keys(editor.drafts).length;const label=[count?`${count} ${count===1?'draft':'drafts'} not applied`:'',editor.allocationDraft?'Allocation draft':''].filter(Boolean).join(' · ');if(drafts.textContent!==label)drafts.textContent=label;
 };
 const unsubscribe=manager.subscribe(render);const storageEvent=(event:StorageEvent)=>{if(event.storageArea&&event.storageArea!==window.localStorage)return;if(event.key===WORKSPACE_STORAGE_KEY||event.key===null)manager.observeExternalStorage(event.newValue);};window.addEventListener('storage',storageEvent);
 registerAppCleanup(root,()=>{if(disposed)return;disposed=true;unsubscribe();controls.dispose();settings.dispose();persistence.dispose();appearance.dispose();binding.dispose();root.removeEventListener('scenario-announcement',announce);root.removeEventListener('editor-operation',operation);window.removeEventListener('storage',storageEvent);manager.dispose();});render();
}
