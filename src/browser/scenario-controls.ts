import {button,element} from './fields';
import {suggestForkName} from './scenario-workspace';
import type {ScenarioManager,ScenarioOperationResult,ScenarioTarget} from './scenario-manager';

/** Native modal behavior in browsers, with a small DOM fallback for test environments. */
export function openScenarioDialog(root:HTMLElement,title:string,invoker:HTMLElement,onClose?:()=>void):{dialog:HTMLDialogElement;close():void}{
 const dialog=element('dialog');dialog.className='scenario-dialog';dialog.setAttribute('aria-label',title);dialog.append(element('h2',title));root.append(dialog);let closed=false;
 const close=()=>{if(closed)return;closed=true;onClose?.();if(typeof dialog.close==='function')dialog.close();dialog.remove();const replacement=[...root.querySelectorAll<HTMLElement>('[data-scenario-action]')].find(node=>node.dataset.scenarioAction===invoker.dataset.scenarioAction&&node.dataset.scenarioId===invoker.dataset.scenarioId);const destination=invoker.isConnected&&!invoker.closest('[hidden]')?invoker:replacement??root.closest('.workspace')?.querySelector<HTMLElement>('[aria-label=Scenario]');destination?.focus();};
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const controls=[...dialog.querySelectorAll<HTMLElement>('input,select,button')].filter(n=>!n.hasAttribute('disabled'));const edge=event.shiftKey?controls[0]:controls.at(-1);if(document.activeElement===edge){event.preventDefault();(event.shiftKey?controls.at(-1):controls[0])?.focus();}}});
 if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');return {dialog,close};
}
export function mountScenarioControls(root:HTMLElement,manager:ScenarioManager):{dispose():void}{
 const label=element('label','Scenario'),select=element('select');select.setAttribute('aria-label','Scenario');label.append(select);root.append(label);root.classList.add('scenario-controls');
 const actions=element('div');actions.className='scenario-actions';const fork=button('Fork scenario',()=>openName('fork',manager.captureTarget(manager.getState().document.activeScenarioId)!,fork));actions.append(fork);
 const manage=element('details'),summary=element('summary','Manage scenarios'),rows=element('div');manage.append(summary,rows);root.append(actions,manage);
 let flow:ReturnType<typeof openScenarioDialog>|undefined,flowTarget:ScenarioTarget|undefined,disposed=false,busy=false,request=0,frame:number|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 let activeSession=manager.getActiveSession(),rowsSignature='',optionSignature='';
 const announcement=(text:string)=>root.dispatchEvent(new CustomEvent('scenario-announcement',{bubbles:true,detail:text}));
 const close=()=>flow?.close();
 const setBusy=(value:boolean)=>{busy=value;const workspace=root.closest('.workspace');if(value)workspace?.setAttribute('aria-busy','true');else workspace?.removeAttribute('aria-busy');root.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,button').forEach(n=>n.disabled=value&&!n.hasAttribute('data-scenario-cancel'));};
 const cancelWork=()=>{request++;if(frame!==undefined)cancelAnimationFrame(frame);if(timer!==undefined)clearTimeout(timer);frame=undefined;timer=undefined;setBusy(false);};
 const openFlow=(title:string,target:ScenarioTarget,invoker:HTMLElement)=>{
  flowTarget=target;const opened=openScenarioDialog(root,title,invoker,()=>{if(flow!==opened)return;flow=undefined;flowTarget=undefined;cancelWork();render();});flow=opened;return opened;
 };
 const cancelButton=()=>{const control=button('Cancel',close);control.dataset.scenarioCancel='';return control;};
 const run=(action:()=>ScenarioOperationResult,done:(result:ScenarioOperationResult)=>void)=>{
  if(busy||disposed)return;const owner=flow,token=++request;setBusy(true);
  const current=()=>!disposed&&token===request&&(!owner||flow===owner&&owner.dialog.isConnected&&owner.dialog.open);
  frame=requestAnimationFrame(()=>{frame=undefined;if(!current())return;timer=setTimeout(()=>{timer=undefined;if(!current())return;const result=action();setBusy(false);render();done(result);},0);});
 };
 select.addEventListener('change',()=>{const id=select.value,target=manager.captureTarget(id),source=manager.getActiveSession();run(()=>target&&manager.isCurrentTarget(target)&&manager.getActiveSession()===source?manager.switchScenario(id):{accepted:false,persisted:manager.getState().persistence.persisted,issues:[{code:'obsolete-activation',severity:'error',explanation:'The scenario selection changed before this switch was prepared.',resolution:'Select the scenario again.'}]},result=>{if(result.accepted)announcement(`Switched to ${manager.getState().document.scenarios.find(s=>s.id===id)!.name}`);else announcement(result.issues.map(i=>i.explanation).join(' '));select.focus();});});
 function openName(kind:'fork'|'rename',target:ScenarioTarget,invoker:HTMLElement){
  close();const doc=manager.getState().document,source=doc.scenarios.find(s=>s.id===target.scenarioId);if(!source)return;flow=openFlow(`${kind==='fork'?'Fork':'Rename'} ${source.name}`,target,invoker);const currentFlow=flow,{dialog}=flow;
  const nameLabel=element('label','Scenario name'),input=element('input');input.type='text';input.value=kind==='fork'?suggestForkName(source.name,doc.scenarios):source.name;nameLabel.append(input);const errors=element('p');errors.setAttribute('role','alert');dialog.append(nameLabel);
  if(kind==='fork')dialog.append(element('p',`Copies applied inputs. Unapplied edits stay in ${source.name}.`));
  const accept=button(kind==='fork'?'Create scenario':'Rename scenario',()=>run(()=>manager.isCurrentTarget(target)?kind==='fork'?manager.forkScenario(target,input.value):manager.renameScenario(target.scenarioId,input.value):{accepted:false,persisted:false,issues:[]},result=>{if(result.accepted){close();if(kind==='fork')fork.focus();announcement(kind==='fork'?`Created ${input.value.trim()}`:`Renamed to ${input.value.trim()}`);}else{if(flow!==currentFlow)return;errors.textContent=result.issues.map(i=>i.explanation).join(' ');input.setAttribute('aria-invalid','true');input.focus();}}));
  dialog.append(errors,accept,cancelButton());input.addEventListener('input',()=>{errors.textContent='';input.removeAttribute('aria-invalid');});input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();accept.click();}});input.focus();input.select();
 }
 function openDelete(target:ScenarioTarget,invoker:HTMLElement){close();const scenario=manager.getState().document.scenarios.find(s=>s.id===target.scenarioId);if(!scenario)return;flow=openFlow(`Delete ${scenario.name}`,target,invoker);const currentFlow=flow;flow.dialog.append(element('p',`Deletes ${scenario.name}'s applied inputs and unfinished edits. Its forks are retained.`),button('Delete scenario',()=>run(()=>manager.deleteScenario(target),result=>{if(result.accepted){close();select.focus();announcement(`Deleted ${scenario.name}. It may return after reload if browser saving failed.`);}else if(flow===currentFlow)announcement(result.issues.map(i=>i.explanation).join(' '));})),cancelButton());flow.dialog.querySelector<HTMLButtonElement>('button:last-child')?.focus();}
 function render(){
  if(disposed)return;const state=manager.getState();if(state.activeSession!==activeSession){activeSession=state.activeSession;close();}if(flowTarget&&!manager.isCurrentTarget(flowTarget))close();
  const scenarios=[state.document.scenarios.find(s=>s.id===state.document.baselineScenarioId)!,...state.document.scenarios.filter(s=>s.id!==state.document.baselineScenarioId)];
  const metadata=scenarios.map(s=>{const session=manager.getSession(s.id),count=session?Object.keys(session.controller.getState().drafts).length+(session.controller.getState().allocationDraft?1:0):0;return {s,count};});
  const optionsKey=JSON.stringify(metadata.map(({s,count})=>[s.id,s.name,count]));if(optionsKey!==optionSignature){select.replaceChildren(...metadata.map(({s,count})=>{const option=element('option',s.name+(s.id===state.document.baselineScenarioId?' · Baseline':'')+(count?` · ${count} drafts`:''));option.value=s.id;return option;}));optionSignature=optionsKey;}select.value=state.document.activeScenarioId;
  const key=JSON.stringify(metadata);if(key!==rowsSignature){rows.replaceChildren();for(const {s,count} of metadata){const row=element('div');row.className='scenario-management-row';row.append(element('span',`${s.name}${s.id===state.document.baselineScenarioId?' · Baseline':''}${count?` · ${count} drafts`:''}${s.forkedFrom?` · Forked from ${s.forkedFrom.scenarioName}`:''}`));const rename=button(`Rename ${s.name}`,()=>openName('rename',manager.captureTarget(s.id)!,rename));rename.dataset.scenarioAction='rename';rename.dataset.scenarioId=s.id;row.append(rename);if(s.id!==state.document.baselineScenarioId){const remove=button(`Delete ${s.name}`,()=>openDelete(manager.captureTarget(s.id)!,remove));remove.dataset.scenarioAction='delete';remove.dataset.scenarioId=s.id;row.append(remove);}rows.append(row);}rowsSignature=key;}
  if(busy)setBusy(true);
 }
 const unsubscribe=manager.subscribe(render);render();return {dispose(){if(disposed)return;disposed=true;cancelWork();close();unsubscribe();root.closest('.workspace')?.removeAttribute('aria-busy');}};
}
