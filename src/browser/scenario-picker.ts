import {button,element} from './fields';

interface ScenarioChoice {id:string;name:string;label:string;baseline:boolean}
interface PickerActions {switch(id:string):void;add(invoker:HTMLElement):void;delete(id:string,invoker:HTMLElement):void}
let pickerSequence=0;

/** Menu actions are siblings so deleting a row never activates its scenario. */
export function mountScenarioPicker(root:HTMLElement,actions:PickerActions){
 const picker=element('div');picker.className='scenario-picker';
 const caption=element('span','Scenario'),trigger=button('',()=>menu.hidden?open():close(true)),selected=element('span'),chevron=element('span','⌄');
 selected.id=`scenario-value-${++pickerSequence}`;chevron.setAttribute('aria-hidden','true');trigger.append(selected,chevron);trigger.className='scenario-picker-trigger';
 trigger.setAttribute('aria-label','Scenario');trigger.setAttribute('aria-describedby',selected.id);trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
 const menu=element('div');menu.id=`scenario-menu-${pickerSequence}`;menu.className='scenario-menu';menu.tabIndex=-1;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Scenarios');menu.hidden=true;trigger.setAttribute('aria-controls',menu.id);
 picker.append(caption,trigger,menu);root.append(picker);let signature='',disposed=false;
 const items=()=>[...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
 function close(restoreFocus=false){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(restoreFocus)trigger.focus();}
 function open(edge?:'first'|'last'){
  if(disposed||trigger.disabled)return;menu.hidden=false;trigger.setAttribute('aria-expanded','true');
  const controls=items();(edge==='first'?controls[0]:edge==='last'?controls.at(-1):menu.querySelector<HTMLButtonElement>('[aria-checked=true]')??controls[0])?.focus();
 }
 trigger.addEventListener('keydown',event=>{
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open(event.key==='ArrowUp'||event.key==='End'?'last':'first');}
 });
 menu.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
  if(event.key==='Tab'){setTimeout(()=>{if(!disposed)close();},0);return;}
  const controls=items(),index=controls.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowUp'?-1:1)+controls.length)%controls.length;controls[next]?.focus();
  }
 });
 const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!picker.contains(event.target))close();};
 // Native pointer focus briefly passes through BODY before the next control is focused.
 const focusOut=(event:FocusEvent)=>{if(!disposed&&!(event.relatedTarget instanceof Node&&picker.contains(event.relatedTarget)))close();};
 document.addEventListener('pointerdown',outside);picker.addEventListener('focusout',focusOut);
 return {trigger,close,render(choices:readonly ScenarioChoice[],activeId:string){
  const active=choices.find(choice=>choice.id===activeId);selected.textContent=active?.label??'';trigger.value=activeId;
  const next=JSON.stringify([choices,activeId]);if(next===signature)return;signature=next;
  const focused=document.activeElement instanceof HTMLElement&&menu.contains(document.activeElement)?document.activeElement:undefined;
  const action=focused?.dataset.scenarioAction,id=focused?.dataset.scenarioId;
  menu.replaceChildren();
  for(const choice of choices){
   const row=element('div');row.className='scenario-menu-row';row.setAttribute('role','none');
   const select=button(choice.label,()=>{close();actions.switch(choice.id);});select.setAttribute('role','menuitemradio');select.setAttribute('aria-checked',String(choice.id===activeId));select.dataset.scenarioAction='switch';select.dataset.scenarioId=choice.id;select.tabIndex=-1;row.append(select);
   if(!choice.baseline){
    const remove=button('',()=>{close();actions.delete(choice.id,trigger);});remove.className='scenario-delete';remove.setAttribute('role','menuitem');remove.setAttribute('aria-label',`Delete ${choice.name}`);remove.title=`Delete ${choice.name}`;remove.dataset.scenarioAction='delete';remove.dataset.scenarioId=choice.id;remove.tabIndex=-1;
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');
    const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7');icon.append(path);remove.append(icon);row.append(remove);
   }
   menu.append(row);
  }
  const add=button('＋ Add new scenario',()=>{close();actions.add(trigger);});add.setAttribute('role','menuitem');add.setAttribute('aria-label','Add new scenario');add.className='scenario-add';add.tabIndex=-1;menu.append(add);
  if(focused&&!menu.hidden){const replacement=[...menu.querySelectorAll<HTMLButtonElement>('[data-scenario-action]')].find(node=>node.dataset.scenarioAction===action&&node.dataset.scenarioId===id);(replacement??add).focus();}
 },dispose(){disposed=true;close();document.removeEventListener('pointerdown',outside);picker.removeEventListener('focusout',focusOut);}};
}
