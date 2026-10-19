import {createAduComparisonScheduler} from './adu-comparison';
import {renderAduComparison} from './views/adu-comparison';
import {createEditPreviewCoordinator} from './edit-preview';
import {selectReportSnapshot} from './report-snapshot';
import {mountOverview} from './views/overview';
import {mountWorkspaceShell} from './workspace-shell';
import {mountFocusedEditor} from './focused-editor';
import {renderRecordCollection} from './record-collections';
import {destinationForSection,targetForReview,type Destination,type WorkspaceRoute} from './workspace-route';
import {createDisclosureController} from './disclosures';
import {withProducingPlan,type IssueViewContext} from './issue-presentation';
import {button,element} from './fields';
import {renderIssueDetails} from './views/issues';
import {mountAttention} from './views/attention';
import {createPrerequisiteFlow} from './prerequisite-flow';
import {editTargetKey} from './record-ui-state';
import {buildOverviewRows} from './overview-model';
import {formatCents} from './views/issues';
import type {PrerequisiteRequest} from './prerequisite-flow';
import type {ScenarioEditorSession} from './scenario-session';
import type {ScenarioManager} from './scenario-manager';
import type {EditTarget} from './edit-types';

export function mountEditorView(root:HTMLElement,session:ScenarioEditorSession,manager:ScenarioManager,activationGeneration:number):{dispose():void}{
  root.replaceChildren();const controller=session.controller;let disposed=false;
  const owner=manager.captureTarget(session.scenarioId)!;
  const isCurrent=()=>!disposed&&manager.isCurrentTarget(owner)&&manager.getActiveSession()===session;
  const coordinator=createEditPreviewCoordinator(controller,{owner:{workspaceGeneration:owner.workspaceGeneration,scenarioId:session.scenarioId,sessionGeneration:session.generation,activationGeneration},isCurrent},{allocationSession:session.view.allocationPreview});
  const disclosures=createDisclosureController(root);
  let focused:ReturnType<typeof mountFocusedEditor>|undefined;
  const origins:EditTarget[]=[];
  const previewOwner={workspaceGeneration:owner.workspaceGeneration,scenarioId:session.scenarioId,sessionGeneration:session.generation,activationGeneration};
  const createFlow=()=>createPrerequisiteFlow(controller,{owner:previewOwner,isCurrent},target=>{if(origins.at(-1)&&editTargetKey(origins.at(-1)!)===editTargetKey(target))origins.pop();open(target,null);});
  let prerequisite=createFlow();
  let route:WorkspaceRoute={destination:session.view.selections.destination??'overview',editor:null,surface:'edit'};
  const context:IssueViewContext={editorView:session.view,disclosures,readState:controller.getState,review:target=>{
    if(!isCurrent())return;
    const snapshot=selectReportSnapshot(controller.getState(),coordinator.getState());
    const edit=targetForReview(target,controller.getState(),snapshot.plan);
    if(!edit)return;
    const returnTo=route.editor?.returnTo??route.destination;
    open(edit,null);if(route.editor)route.editor.returnTo=returnTo;
    if(target.field)focused?.reveal(target.field);
  }};
  const collection=()=>renderRecordCollection(shell.collection,controller.getState(),route.destination,open,section=>{const recordId=controller.beginAdd(section);open({kind:'record',section,recordId},null);});
  const close=(returnFocus=true)=>{
    const previous=route.editor;if(!previous)return;
    focused?.dispose();focused=undefined;coordinator.select(null);shell.editor.replaceChildren();
    prerequisite.dispose();origins.length=0;prerequisite=createFlow();
    route={destination:previous.returnTo,editor:null,surface:'edit'};session.view.selections.destination=route.destination;
    shell.update(route);collection();updateReport();
    if(returnFocus){const origin=previous.origin;if(origin?.isConnected)origin.focus();else {const replacement=[...shell.collection.querySelectorAll<HTMLElement>('[data-open-target]')].find(node=>node.dataset.openTarget===origin?.dataset.openTarget);(replacement??shell.collection.querySelector<HTMLElement>('h2'))?.focus();}}
  };
  const navigate=(destination:Destination)=>{close(false);route={destination,editor:null,surface:'edit'};session.view.selections.destination=destination;shell.update(route);collection();};
  const open=(target:EditTarget,origin:HTMLElement|null)=>{
    if(!isCurrent())return;
    focused?.dispose();focused=undefined;disclosures.closeWithin(root,false);coordinator.select(null);
    const returnTo=route.editor?.returnTo??route.destination;
    route={destination:route.destination,editor:{target,returnTo,origin},surface:'edit'};
    shell.update(route);coordinator.select(target);focused=mountFocusedEditor(shell.editor,session,target,context,coordinator,{
      requestPrerequisite:(request:PrerequisiteRequest)=>{if(!isCurrent()||route.editor?.target!==target)return;origins.push(target);prerequisite.begin(target,request);},
      applied:(applied,result)=>prerequisite.applied(applied,result),
      ...(origins.length?{cancelPrerequisite:()=>prerequisite.cancel()}:{}),
    });
    updateReport();
    const heading=shell.editor.querySelector<HTMLElement>('h3,h2');if(heading){heading.tabIndex=-1;heading.focus();}
  };
  const shell=mountWorkspaceShell(root,session.view,{navigate,open,close:()=>close(),surface:value=>{route.surface=value;shell.update(route);if(value==='edit')focused?.restoreFocus();}});
  const heading=element('h2');heading.dataset.forecastName='';heading.textContent=`Forecast · ${manager.getState().document.scenarios.find(s=>s.id===session.scenarioId)!.name}`;
  const attentionRoot=element('div'),reportRoot=element('div'),comparisonRoot=element('details');comparisonRoot.className='applied-project-comparison';comparisonRoot.append(element('summary','Applied project comparison'));
  const projectChoice=element('select');projectChoice.setAttribute('aria-label','Applied ADU project');
  const comparisonBody=element('div');comparisonRoot.append(projectChoice,comparisonBody);shell.overview.append(heading,attentionRoot,reportRoot,comparisonRoot);
  const attention=mountAttention(attentionRoot,context,context.review);
  let shownReport=selectReportSnapshot(controller.getState(),coordinator.getState());
  let shownIssues=coordinator.getState().issues;
  const overview=mountOverview(reportRoot,shownReport,context,session.view);
  const paintImpact=()=>{const ribbon=root.querySelector<HTMLElement>('[data-impact-ribbon]');if(!ribbon)return;const row=buildOverviewRows(shownReport).find(row=>row.balance.year===session.view.selections.forecastYear);if(!row)return;
    ribbon.replaceChildren(element('strong',`${row.balance.year} · ${shownReport.status==='preview'?'Preview':shownReport.status==='applied'?'Applied':'Previous results'}`));
    for(const [label,value] of [['Net worth',row.balance.netWorthCents],['Annual cash flow',row.financial.cashFlowCents],['Cash',row.balance.reserveCents]] as const)ribbon.append(element('span',`${label} ${value.status==='available'?formatCents(value.value):value.status==='unsupported-case'?'Unsupported':'Needs data'}`));
  };
  const updateReport=()=>{if(!isCurrent())return;const next=selectReportSnapshot(controller.getState(),coordinator.getState());
    const issues=coordinator.getState().issues;
    if(next.plan===shownReport.plan&&next.projection===shownReport.projection&&next.status===shownReport.status&&next.label===shownReport.label&&next.allowDeltas===shownReport.allowDeltas&&next.comparison?.plan===shownReport.comparison?.plan&&next.comparison?.projection===shownReport.comparison?.projection){if(issues!==shownIssues){shownIssues=issues;attention.update(shownReport,issues);}return;}
    shownReport=next;shownIssues=issues;overview.update(next);attention.update(next,issues);paintImpact();
  };
  const paintComparison=()=>{
    if(!isCurrent())return;disclosures.closeWithin(comparisonBody,false);comparisonBody.replaceChildren();
    comparisonRoot.hidden=!controller.getState().savedPlan.properties.some(p=>p.aduProject);
    const state=session.view.aduComparison;
    if(state.status==='calculated'&&state.comparison)renderAduComparison(comparisonBody,state.comparison,withProducingPlan(context,controller.getState().savedPlan),session.view.selections.forecastYear);
    else if(state.status==='pending')comparisonBody.append(element('p','Calculating applied ADU comparison…'));
    else if(state.status==='failed'){
      comparisonBody.append(element('p','Applied ADU comparison is unavailable.'),button('Retry comparison',()=>adu.request()));
      renderIssueDetails(comparisonBody,state.issues.map(issue=>({issue})),withProducingPlan(context,controller.getState().savedPlan));
    }
  };
  const adu=createAduComparisonScheduler(controller,state=>{if(isCurrent()){session.view.aduComparison=state;paintComparison();}},{owner:{workspaceGeneration:owner.workspaceGeneration,scenarioId:session.scenarioId,sessionGeneration:session.generation,activationGeneration},isCurrent});
  let selectedComparisonProject:string|undefined,comparisonPlan=controller.getState().savedPlan;
  const syncComparisonSelection=()=>{
    comparisonPlan=controller.getState().savedPlan;
    const projects=controller.getState().savedPlan.properties.flatMap(property=>property.aduProject?[property.aduProject]:[]);
    const selected=projects.find(project=>project.id===session.view.selectedAduProjectId)?.id??projects[0]?.id;
    session.view.selectedAduProjectId=selected;
    projectChoice.replaceChildren(...projects.map(project=>{const option=element('option',project.name);option.value=project.id;return option;}));
    projectChoice.hidden=projects.length<2;projectChoice.value=selected??'';
    comparisonRoot.hidden=!projects.length;
    if(selected!==selectedComparisonProject){selectedComparisonProject=selected;adu.select(selected);}
  };
  projectChoice.onchange=()=>{if(!isCurrent())return;session.view.selectedAduProjectId=projectChoice.value;syncComparisonSelection();};
  const unsubscribePreview=coordinator.subscribe(updateReport);
  const unsubscribe=controller.subscribe(operation=>{
    if(!isCurrent())return;
    if(operation)root.dispatchEvent(new CustomEvent('editor-operation',{bubbles:true,detail:operation}));
    if(!route.editor)collection();updateReport();if(comparisonPlan!==controller.getState().savedPlan)syncComparisonSelection();
  });
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!root.querySelector('[data-disclosure-panel]')){event.preventDefault();close();}};
  const discarded=()=>{const target=route.editor?.target;if(target?.kind==='record'&&target.section!=='household'&&!(controller.getState().savedPlan[target.section]??[]).some(record=>record.id===target.recordId)){close();return;}if(target){const origin=route.editor?.origin??null;open(target,origin);}};
  const removed=()=>close();
  const review=(event:Event)=>{const request=(event as CustomEvent<{target:import('./issue-presentation').ReviewTarget;handled:boolean}>).detail;if(!isCurrent()||!targetForReview(request.target,controller.getState(),shownReport.plan))return;request.handled=true;context.review(request.target);};
  const addContribution=(event:Event)=>{const recordId=controller.beginAdd('contributions'),draft=controller.getDraft('contributions',recordId);controller.editDraft(recordId,{...draft,value:{...draft.value,accountId:(event as CustomEvent<string>).detail}});open({kind:'record',section:'contributions',recordId},null);};
  root.addEventListener('keydown',escape);root.addEventListener('editor-discarded',discarded);root.addEventListener('editor-removed',removed);
  root.addEventListener('editor-add-contribution',addContribution);
  const workspaceRoot=root.closest<HTMLElement>('.workspace')??root;workspaceRoot.addEventListener('financial-review',review);
  shell.update(route);collection();syncComparisonSelection();paintComparison();
  attention.update(shownReport,[]);
  const reportYearChanged=()=>{paintImpact();paintComparison();};
  paintImpact();reportRoot.addEventListener('change',reportYearChanged);reportRoot.addEventListener('forecast-year-selected',reportYearChanged);
  return {dispose(){if(disposed)return;disposed=true;focused?.dispose();prerequisite.dispose();unsubscribePreview();unsubscribe();coordinator.dispose();adu.dispose();overview.dispose();attention.dispose();disclosures.dispose();shell.dispose();reportRoot.removeEventListener('change',reportYearChanged);reportRoot.removeEventListener('forecast-year-selected',reportYearChanged);root.removeEventListener('keydown',escape);root.removeEventListener('editor-discarded',discarded);root.removeEventListener('editor-removed',removed);root.removeEventListener('editor-add-contribution',addContribution);workspaceRoot.removeEventListener('financial-review',review);}};
}
