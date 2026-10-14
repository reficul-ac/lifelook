import type {ScenarioEditorSession} from './scenario-session';
import type {ScenarioManager} from './scenario-manager';
import type {InputSection} from './issue-presentation';
import {syncFormFeedback} from './form-feedback';
import {createDisclosureController} from './disclosures';
import {reviewTarget} from './navigation';
import type {IssueViewContext} from './issue-presentation';
import type {PlanDocument} from '../engine';
import { button,element } from './fields';
import type {WorkspaceController,WorkspaceOperation} from './state';

import { renderHouseholdForm } from './forms/household';
import { renderIncomeForm } from './forms/income';
import { renderExpensesDebtsForm } from './forms/expenses-debts';
import { renderInvestmentsForm,mountInvestmentAllocation } from './forms/investments';
import { renderPropertiesForm } from './forms/properties';
import { renderProjection } from './views/projection';
import { renderIssues,renderIssueDetails } from './views/issues';


export function mountEditorView(root:HTMLElement,session:ScenarioEditorSession,manager:ScenarioManager,activationGeneration:number):{dispose():void}{
  root.replaceChildren();const controller=session.controller;let disposed=false;const target=manager.captureTarget(session.scenarioId)!;
  const isCurrent=()=>!disposed&&manager.isCurrentTarget(target)&&manager.getActiveSession()===session;
  const disclosures=createDisclosureController(root);
  const context:IssueViewContext={editorView:session.view,disclosures,readState:controller.getState,review:target=>{if(!isCurrent())return;disclosures.closeWithin(root,false);reviewTarget(root,target);}};
  const layout=element('div');layout.className='workspace-layout';const editor=element('section'),report=element('section');editor.setAttribute('aria-label','Financial inputs');report.setAttribute('aria-label','Saved projection');layout.append(editor,report);root.append(layout);
  const nav=element('nav');nav.setAttribute('aria-label','Input sections');editor.append(nav);
  const sections:readonly [string,(root:HTMLElement,controller:WorkspaceController,ui?:IssueViewContext)=>void][]=[['Household',renderHouseholdForm],['Income',renderIncomeForm],['Expenses and debts',renderExpensesDebtsForm],['Investments',renderInvestmentsForm],['Properties',renderPropertiesForm]];
  const containers=sections.map(([label,renderer],index)=>{const container=element('section');container.hidden=label!==session.view.selections.inputSection;container.dataset.section=label;const tab=button(label,()=>{session.view.selections.inputSection=label as InputSection;containers.forEach(c=>{if(c.container!==container)disclosures.closeWithin(c.container,false);c.container.hidden=c.container!==container;});nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===tab)));});tab.setAttribute('aria-pressed',String(label===session.view.selections.inputSection));nav.append(tab);editor.append(container);return {container,renderer};});
  const investments=containers.find(item=>item.container.dataset.section==='Investments')!;
  const allocationHost=element('div'),investmentRecords=element('div');investments.container.append(allocationHost,investmentRecords);
  const allocationEditor=mountInvestmentAllocation(allocationHost,controller,context,{view:session.view,ownership:{owner:{scenarioId:session.scenarioId,sessionGeneration:session.generation,activationGeneration},isCurrent:()=>isCurrent()}});
  const heading=element('h2');heading.dataset.forecastName='';heading.textContent=`Forecast · ${manager.getState().document.scenarios.find(s=>s.id===session.scenarioId)!.name}`;
  const projectionRoot=element('div');report.append(heading,projectionRoot);
  let savedIdentity:PlanDocument|undefined,draftKeys='',previousDrafts=controller.getState().drafts;
  const render=(operation?:WorkspaceOperation)=>{if(!isCurrent())return;
    const state=controller.getState(),newKeys=Object.values(state.drafts).filter(d=>d.section!=='household'&&!((state.savedPlan[d.section]??[]) as readonly {id:string}[]).some(r=>r.id===d.recordId)).map(d=>d.recordId).sort().join('|'),changed=savedIdentity!==state.savedPlan;
    for(const map of [session.view.taskIssues,session.view.removeIssues])for(const id of map.keys())if(state.drafts[id]!==previousDrafts[id])map.delete(id);
    if(operation&&operation.kind!=='restore'&&operation.result.accepted){session.view.taskIssues.delete(operation.recordId);session.view.removeIssues.delete(operation.recordId);}
    if(operation?.kind==='save'&&!operation.result.accepted)session.view.taskIssues.set(operation.recordId,operation.result.issues);
    if(operation?.kind==='remove'&&!operation.result.accepted)session.view.removeIssues.set(operation.recordId,operation.result.issues);
    previousDrafts=state.drafts;
    if(operation)root.dispatchEvent(new CustomEvent('editor-operation',{bubbles:true,detail:operation}));
    if(changed)renderProjection(projectionRoot,state.projection,context,session.view);
    const active=document.activeElement instanceof HTMLInputElement||document.activeElement instanceof HTMLSelectElement?document.activeElement:undefined;const activeRecord=active?.closest<HTMLElement>('[data-record-id]')?.dataset.recordId,activeField=active?.dataset.field;const selection=active instanceof HTMLInputElement&&active.type==='text'?[active.selectionStart,active.selectionEnd] as const:undefined;
    if(changed||draftKeys!==newKeys){for(const {container,renderer} of containers){const recordRoot=container===investments.container?investmentRecords:container;disclosures.closeWithin(recordRoot,false);renderer(recordRoot,controller,context);}}
    syncFormFeedback(editor,controller,context);
    for(const feedback of editor.querySelectorAll<HTMLElement>('[data-operation-feedback]')){disclosures.closeWithin(feedback,false);feedback.remove();}
    for(const [recordId,issues] of session.view.removeIssues){
      const form=[...editor.querySelectorAll<HTMLElement>('form[data-record-id]')].find(node=>node.dataset.recordId===recordId);
      if(form){const feedback=element('div');feedback.dataset.operationFeedback='';feedback.append(element('strong','Record not removed. Correct the linked inputs, then remove again.'));renderIssueDetails(feedback,issues.map(issue=>({issue})),context);form.append(feedback);}
    }
    if(activeField&&activeRecord&&!active?.isConnected){const form=[...editor.querySelectorAll<HTMLElement>('[data-record-id]')].find(node=>node.dataset.recordId===activeRecord);const replacement=[...form?.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-field]')??[]].find(node=>node.dataset.field===activeField);replacement?.focus();if(selection&&replacement instanceof HTMLInputElement&&replacement.type==='text')replacement.setSelectionRange(selection[0],selection[1]);}
    savedIdentity=state.savedPlan;draftKeys=newKeys;
  };
  const unsubscribe=controller.subscribe(render);render();return {dispose(){if(disposed)return;disposed=true;
    for(const node of root.querySelectorAll<HTMLDetailsElement>('details[data-property-disclosure]'))session.view.propertyDisclosures.set(node.dataset.propertyDisclosure!,node.open);
    unsubscribe();allocationEditor.dispose();disclosures.dispose();}};
}
