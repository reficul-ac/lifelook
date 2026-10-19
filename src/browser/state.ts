import { calculateProjection,loadRuleSet,validatePlan,type Issue,type PlanDocument,type ProjectionResult,type RuleSet,type ValidatedPlan } from '../engine';
import { exportPlan,savePlan,type StoragePort } from './storage';
import {fromDraftValue,toDraftValue} from './draft-codec';
export {fromDraftValue,toDraftValue} from './draft-codec';
import {buildEditCandidate,equalActiveEdit} from './edit-candidate';
import type {CalculatedEdit,EditTarget,PreparedEdit,ReadyEdit} from './edit-types';

export type EditableSection='household'|'salaries'|'otherIncome'|'expenses'|'children'|'debts'|'accounts'|'contributions'|'properties'|'rentals';
export type RawObject=Record<string,unknown>;
export interface RecordDraft {readonly recordId:string;readonly section:EditableSection;readonly value:RawObject;readonly baseSnapshot?:string}
export interface CashFlowAllocationDraft {readonly recordId:string;readonly value:RawObject;readonly baseSnapshot:string}
export interface WorkspaceState {readonly allocationDraft?:CashFlowAllocationDraft;readonly savedPlan:PlanDocument;readonly drafts:Readonly<Record<string,RecordDraft>>;readonly projection:ProjectionResult;readonly persisted:boolean;readonly issues:readonly Issue[];readonly persistenceIssues:readonly Issue[]}
export interface SaveRecordResult {readonly accepted:boolean;readonly persisted:boolean;readonly issues:readonly Issue[];readonly persistenceIssues:readonly Issue[]}
export type CashFlowAllocationPreview=Readonly<{status:'calculated';projection:ProjectionResult;inputRevision:number}>|Readonly<{status:'invalid'|'failed';issues:readonly Issue[];inputRevision:number}>;
export interface WorkspaceController {
  getState():WorkspaceState;
  getAllocationDraft():CashFlowAllocationDraft;
  editAllocationDraft(draft:CashFlowAllocationDraft):void;
  discardAllocationDraft():void;
  previewAllocation():CashFlowAllocationPreview;
  applyAllocation():SaveRecordResult;
  getDraft(section:EditableSection,recordId:string):RecordDraft;
  editDraft(recordId:string,draft:RecordDraft):void;
  discardDraft(recordId:string):void;
  saveRecord(recordId:string):SaveRecordResult;
  saveProperty(propertyId:string):SaveRecordResult;
  removeRecord(section:EditableSection,recordId:string):SaveRecordResult;
  beginAdd(section:EditableSection,value?:RawObject):string;
  subscribe(listener:(operation?:WorkspaceOperation)=>void):()=>void;
  exportBackup():string;
  resetPlan(plan:PlanDocument,initial?:WorkspaceInitialization):void;
}
export interface EditorPublicationPort {
  readPersistence():WorkspaceInitialization;
  publish(plan:ValidatedPlan,projection:ProjectionResult,commitSession:()=>void):{accepted:true}|{accepted:false;issues:readonly Issue[]};
  retry():{accepted:true}|{accepted:false;issues:readonly Issue[]};
}
export interface WorkspaceInitialization {readonly persisted:boolean;readonly persistenceIssues:readonly Issue[]}
export type WorkspaceOperation=Readonly<{kind:'save'|'remove';recordId:string;result:SaveRecordResult}>|Readonly<{kind:'restore';persisted:boolean}>;
function requiredPlan(plan:PlanDocument){const validation=validatePlan(plan);if(!validation.ok)throw new Error('Workspace requires a structurally valid saved plan.');return validation.plan;}

/** Browser-only bridge: the worker receives the exact rules captured by its workspace. */
export type PreparedAllocationPreview=Readonly<{status:'ready';plan:ValidatedPlan;ruleSet:RuleSet;inputRevision:number}>|Extract<CashFlowAllocationPreview,{status:'invalid'|'failed'}>;
export type PreparedAduComparison=Readonly<{status:'ready';plan:ValidatedPlan;ruleSet:RuleSet;projection:ProjectionResult;inputRevision:number}>|Readonly<{status:'invalid'|'failed';issues:readonly Issue[]}>;
const allocationBridges=new WeakMap<WorkspaceController,{prepare():PreparedAllocationPreview;epoch():number;adu(projectId:string):PreparedAduComparison}>();
export function prepareAduComparison(controller:WorkspaceController,projectId:string):PreparedAduComparison{const bridge=allocationBridges.get(controller);if(!bridge)throw new Error('Unknown ADU workspace.');return bridge.adu(projectId);}
export function prepareAllocationPreview(controller:WorkspaceController):PreparedAllocationPreview {
  const bridge=allocationBridges.get(controller);if(!bridge)throw new Error('Unknown allocation workspace.');return bridge.prepare();
}
const editBridges=new WeakMap<WorkspaceController,{prepare(target:EditTarget):PreparedEdit;complete(prepared:ReadyEdit,projection:ProjectionResult):CalculatedEdit|null;apply(calculated:CalculatedEdit):SaveRecordResult}>();
export function prepareEdit(controller:WorkspaceController,target:EditTarget):PreparedEdit {const bridge=editBridges.get(controller);if(!bridge)throw Error('Unknown editing workspace.');return bridge.prepare(target);}
export function completePreparedEdit(controller:WorkspaceController,prepared:ReadyEdit,projection:ProjectionResult):CalculatedEdit|null {return editBridges.get(controller)?.complete(prepared,projection)??null;}
export function applyCalculatedEdit(controller:WorkspaceController,calculated:CalculatedEdit):SaveRecordResult {const bridge=editBridges.get(controller);if(!bridge)throw Error('Unknown editing workspace.');return bridge.apply(calculated);}
export function allocationPreviewEpoch(controller:WorkspaceController):number {return allocationBridges.get(controller)?.epoch()??0;}
export function allocationCalculationFailure(inputRevision:number):CashFlowAllocationPreview {
  return {status:'failed',inputRevision,issues:[{code:'calculation-failed',field:'cashFlowAllocation',severity:'error',explanation:'These allocation inputs could not be calculated. The saved plan and projection have been retained.',resolution:'Correct the draft inputs and request a new preview or Apply again.'}]};
}

export function createWorkspace(plan:PlanDocument,storage:StoragePort,ruleSet:RuleSet=loadRuleSet()):WorkspaceController {return createController(plan,ruleSet,storage);}
export function createEditorSession(plan:PlanDocument,port:EditorPublicationPort,ruleSet:RuleSet):WorkspaceController {return createController(plan,ruleSet,undefined,port);}
function createController(plan:PlanDocument,ruleSet:RuleSet,storage?:StoragePort,port?:EditorPublicationPort):WorkspaceController {
  let savedPlan:ValidatedPlan=requiredPlan(plan),projection=calculateProjection(requiredPlan(plan),ruleSet),persisted=true,issues:readonly Issue[]=[],persistenceIssues:readonly Issue[]=[];
  let drafts:Record<string,RecordDraft>={};const bases=new Map<string,string>();const listeners=new Set<(operation?:WorkspaceOperation)=>void>();let sequence=0;
  let allocationDraft:CashFlowAllocationDraft|undefined,allocationDefault:CashFlowAllocationDraft|undefined,allocationBase:string|undefined,allocationEpoch=0;
  let operationDepth=0,controllerEpoch=0,preparationToken=0;const draftGenerations=new Map<string,number>();
  const editKey=(target:EditTarget)=>target.kind==='allocation'?'allocation':`${target.section}:${target.recordId}`;
  const changed=(target:EditTarget)=>{const key=editKey(target);draftGenerations.set(key,(draftGenerations.get(key)??0)+1);};
  const notify=(operation?:WorkspaceOperation)=>{if(operationDepth===0||operation)listeners.forEach(listener=>listener(operation));};
  const operate=(kind:'save'|'remove',recordId:string,action:()=>SaveRecordResult):SaveRecordResult=>{operationDepth++;let outcome:SaveRecordResult;try{outcome=action();}finally{operationDepth--;}if(operationDepth===0)notify({kind,recordId,result:outcome});return outcome;};
  const persistence=():WorkspaceInitialization=>port?.readPersistence()??{persisted,persistenceIssues};
  const result=(accepted:boolean):SaveRecordResult=>({accepted,...persistence(),issues});
  const commitProjection=(candidate:ValidatedPlan,candidateProjection:ProjectionResult,clear:readonly string[],clearAllocation=false):SaveRecordResult=>{
    const commit=()=>{savedPlan=candidate;projection=candidateProjection;issues=[];
      drafts=Object.fromEntries(Object.entries(drafts).filter(([id])=>!clear.includes(id)));clear.forEach(id=>bases.delete(id));
      if(clearAllocation){allocationDraft=undefined;allocationDefault=undefined;allocationBase=undefined;allocationEpoch++;}
    };
    if(port){const outcome=port.publish(candidate,candidateProjection,commit);if(!outcome.accepted){issues=outcome.issues;notify();return result(false);}}
    else{commit();const saved=savePlan(storage!,savedPlan);persisted=saved.persisted;persistenceIssues=saved.issues.filter(issue=>issue.code==='storage-write-failed');}
    notify();return result(true);
  };
  const publish=(candidate:PlanDocument,clear:readonly string[],clearAllocation=false):SaveRecordResult=>{
    const validation=validatePlan(candidate);if(!validation.ok){issues=validation.issues;notify();return result(false);}
    let candidateProjection:ProjectionResult;
    try {candidateProjection=calculateProjection(validation.plan,ruleSet);}
    catch {issues=[{code:'calculation-failed',field:'plan',severity:'error',explanation:'These inputs could not be calculated. The saved plan and projection have been retained.',resolution:'Correct the draft inputs before saving again.'}];notify();return result(false);}
    return commitProjection(validation.plan,candidateProjection,clear,clearAllocation);
  };
  const issued=new WeakMap<ReadyEdit,{key:string;generation:number;epoch:number;token:number;base:ValidatedPlan;plan:ValidatedPlan;fingerprint:string;rulesFingerprint:string}>();
  const receipts=new WeakSet<CalculatedEdit>(),consumed=new WeakSet<CalculatedEdit>();
  const fresh=(prepared:ReadyEdit):boolean=>{
    const capture=issued.get(prepared);return !!capture&&capture.base===savedPlan&&capture.base===prepared.basePlan&&capture.epoch===controllerEpoch&&capture.epoch===prepared.controllerEpoch&&capture.generation===(draftGenerations.get(capture.key)??0)&&capture.generation===prepared.draftGeneration&&capture.token===prepared.token&&capture.plan===prepared.plan&&prepared.ruleSet===ruleSet&&capture.fingerprint===JSON.stringify(prepared.plan)&&capture.rulesFingerprint===JSON.stringify(ruleSet);
  };
  const complete=(prepared:ReadyEdit,calculated:ProjectionResult):CalculatedEdit|null=>{
    if(!fresh(prepared)||calculated.inputRevision!==prepared.plan.revision)return null;
    const receipt=Object.freeze({prepared,projection:calculated});receipts.add(receipt);return receipt;
  };
  const commitCalculated=(calculated:CalculatedEdit):SaveRecordResult=>{
    if(!receipts.has(calculated)||consumed.has(calculated)||!fresh(calculated.prepared)||calculated.projection.inputRevision!==calculated.prepared.plan.revision){issues=[{code:'stale-edit-preview',field:'plan',severity:'error',explanation:'This preview no longer matches the current draft and applied inputs.',resolution:'Wait for a current preview before applying.'}];notify();return result(false);}
    const target=calculated.prepared.target,outcome=commitProjection(calculated.prepared.plan,calculated.projection,target.kind==='record'?[target.recordId]:[],target.kind==='allocation');if(outcome.accepted)consumed.add(calculated);return outcome;
  };
  const householdValue=()=>({household:savedPlan.household,taxPolicy:savedPlan.taxPolicy,startYear:savedPlan.startYear,horizonYears:savedPlan.horizonYears,openingCashCents:savedPlan.openingCashCents});
  const propertyValue=(id:string)=>({property:savedPlan.properties.find(p=>p.id===id),rentals:savedPlan.rentals.filter(r=>r.propertyId===id),expenses:savedPlan.expenses.filter(e=>e.propertyId===id||e.rentalId&&savedPlan.rentals.some(r=>r.id===e.rentalId&&r.propertyId===id))});
  const usedRecordIds=():Set<string>=>{const ids=new Set<string>();const visit=(value:unknown):void=>{if(!value||typeof value!=='object')return;if('id' in value&&typeof value.id==='string')ids.add(value.id);Object.values(value).forEach(visit);};visit(savedPlan);visit(drafts);visit(allocationDraft);visit(allocationDefault);Object.keys(drafts).forEach(id=>ids.add(id));if(allocationDraft)ids.add(allocationDraft.recordId);if(allocationDefault)ids.add(allocationDefault.recordId);return ids;};
  const nextId=(prefix:string):string=>{const ids=usedRecordIds();let id:string;do{id=`${prefix}-${++sequence}`;}while(ids.has(id));return id;};
  const allocationSnapshot=():string=>JSON.stringify(savedPlan.cashFlowAllocation??null);
  const getAllocationDraft=():CashFlowAllocationDraft=>{
    if(allocationDraft)return allocationDraft;
    if(allocationDefault?.baseSnapshot===allocationSnapshot())return allocationDefault;
    const policy=savedPlan.cashFlowAllocation;
    const id=policy?.id??nextId('cash-flow-allocation');
    // Reserve the policy ID before choosing an overflow ID.
    allocationDefault={recordId:id,baseSnapshot:allocationSnapshot(),value:{id}};
    allocationDefault={...allocationDefault,value:toDraftValue(policy??{id,entries:[],overflow:{id:nextId('cash-flow-overflow'),destination:{kind:'cash'}}})};
    return allocationDefault;
  };
  const prepareAllocation=():PreparedAllocationPreview=>{
    const inputRevision=savedPlan.revision,prepared=prepare({kind:'allocation'});
    if(prepared.status==='unchanged')return {status:'ready',plan:savedPlan,ruleSet,inputRevision};
    return prepared.status==='ready'?{status:'ready',plan:prepared.plan,ruleSet,inputRevision}:{status:'invalid',inputRevision,issues:prepared.issues};
  };
  const draftFor=(id:string):RecordDraft|undefined=>Object.hasOwn(drafts,id)?drafts[id]:undefined;
  const snapshot=(section:EditableSection,id:string):string=>JSON.stringify(section==='household'?householdValue():section==='properties'?propertyValue(id):(savedPlan[section]??[]).find(row=>row.id===id)??null);
  const getDraft=(section:EditableSection,id:string):RecordDraft=>draftFor(id)??{recordId:id,section,baseSnapshot:snapshot(section,id),value:toDraftValue(section==='household'?householdValue():section==='properties'?propertyValue(id):(savedPlan[section]??[]).find(row=>row.id===id)??{})};
  const prepare=(target:EditTarget):PreparedEdit=>{
    const allocation=target.kind==='allocation',id=allocation?getAllocationDraft().recordId:target.recordId;
    const draft=allocation?getAllocationDraft():getDraft(target.section,id);
    if(!allocation&&(!('section' in draft)||draft.section!==target.section))return {status:'invalid',issues:[{code:'invalid-input',recordId:id,field:'id',severity:'error',explanation:'This draft belongs to another record collection.',resolution:'Select the original record.'}]};
    if(!allocation&&!draftFor(id)&&target.section!=='household'&&snapshot(target.section,id)==='null')return {status:'invalid',issues:[{code:'invalid-input',recordId:id,field:'id',severity:'error',explanation:'This record does not exist.',resolution:'Select an existing record or add a new one.'}]};
    const original=allocation?(allocationBase??draft.baseSnapshot):bases.get(id)??draft.baseSnapshot;
    const current=allocation?allocationSnapshot():snapshot(target.section,id);
    if(original!==undefined&&original!==current)return {status:'stale',issues:[{code:'stale-record-draft',recordId:id,field:allocation?'cashFlowAllocation':target.section,severity:'error',explanation:'A newer save changed this record or its linked records while these edits were open. Your draft has been retained.',resolution:'Discard these edits and reload the saved values, then reapply your changes before saving.'}]};
    if(allocation&&!allocationDraft)return {status:'unchanged'};
    const decoded=fromDraftValue(draft.value,id);if(decoded.issues.length)return {status:'invalid',issues:decoded.issues};
    const identity=allocation?decoded.value.id:target.section==='properties'?(decoded.value.property as RawObject|undefined)?.id:target.section==='household'?id:decoded.value.id;
    if(identity!==id)return {status:'invalid',issues:[{code:'invalid-input',recordId:id,field:!allocation&&target.section==='properties'?'property.id':'id',severity:'error',explanation:'The original record ID must remain unchanged.',resolution:'Keep this record ID so its linked records continue to refer to the same record.'}]};
    const candidate=buildEditCandidate(savedPlan,target,decoded.value);
    if(equalActiveEdit(candidate,savedPlan))return {status:'unchanged'};
    const validated=validatePlan(candidate);if(!validated.ok)return {status:'invalid',issues:validated.issues};
    const prepared:ReadyEdit=Object.freeze({status:'ready',target:Object.freeze({...target}),plan:validated.plan,basePlan:savedPlan,ruleSet,controllerEpoch,draftGeneration:draftGenerations.get(editKey(target))??0,token:++preparationToken});
    issued.set(prepared,{key:editKey(target),generation:prepared.draftGeneration,epoch:controllerEpoch,token:prepared.token,base:savedPlan,plan:prepared.plan,fingerprint:JSON.stringify(prepared.plan),rulesFingerprint:JSON.stringify(ruleSet)});return prepared;
  };
  const saveTarget=(target:EditTarget):SaveRecordResult=>{
    const prepared=prepare(target);
    if(prepared.status==='unchanged'){issues=[];notify();return result(true);}
    if(prepared.status!=='ready'){issues=prepared.issues;notify();return result(false);}
    try {const receipt=complete(prepared,calculateProjection(prepared.plan,prepared.ruleSet));return receipt?commitCalculated(receipt):result(false);}
    catch {issues=[{code:'calculation-failed',field:'plan',severity:'error',explanation:'These inputs could not be calculated. The saved plan and projection have been retained.',resolution:'Correct the draft inputs before saving again.'}];notify();return result(false);}
  };
  const controller:WorkspaceController={
    getState:()=>({savedPlan,drafts,projection,...persistence(),issues,...(allocationDraft?{allocationDraft}:{})}),getDraft,getAllocationDraft,
    editAllocationDraft(draft){changed({kind:'allocation'});if(allocationDraft&&allocationDraft.recordId!==draft.recordId)throw new Error('Allocation draft identity must remain stable.');if(allocationBase===undefined)allocationBase=draft.baseSnapshot;allocationDraft={...structuredClone(draft),baseSnapshot:allocationBase};issues=[];notify();},
    discardAllocationDraft(){changed({kind:'allocation'});allocationEpoch++;allocationDraft=undefined;allocationDefault=undefined;allocationBase=undefined;issues=[];notify();},
    previewAllocation(){const prepared=prepareAllocation();if(prepared.status!=='ready')return prepared;try{return {status:'calculated',projection:calculateProjection(prepared.plan,prepared.ruleSet),inputRevision:prepared.inputRevision};}catch{return allocationCalculationFailure(prepared.inputRevision);}},
    applyAllocation(){allocationEpoch++;const id=getAllocationDraft().recordId;return operate('save',id,()=>saveTarget({kind:'allocation'}));},
    editDraft(id,draft){if(id!==draft.recordId)throw new Error('Draft record identity must remain stable.');changed({kind:'record',section:draft.section,recordId:id});if(!bases.has(id))bases.set(id,draft.baseSnapshot??snapshot(draft.section,id));drafts={...drafts,[id]:structuredClone(draft)};issues=[];notify();},
    discardDraft(id){const draft=draftFor(id);if(draft)changed({kind:'record',section:draft.section,recordId:id});drafts=Object.fromEntries(Object.entries(drafts).filter(([key])=>key!==id));bases.delete(id);issues=[];notify();},
    saveRecord(id){return operate('save',id,()=>{
      const edited=draftFor(id);
      const section=edited?.section??(id==='household'?'household':(['salaries','otherIncome','expenses','children','debts','accounts','contributions','properties','rentals'] as const).find(section=>(savedPlan[section]??[]).some(row=>row.id===id)));
      return section?saveTarget({kind:'record',section,recordId:id}):result(false);
    });},
    saveProperty(id){return operate('save',id,()=>saveTarget({kind:'record',section:'properties',recordId:id}));},
    removeRecord(section,id){return operate('remove',id,()=>{if(section==='household')return result(false);if(!(savedPlan[section]??[]).some(row=>row.id===id)){controller.discardDraft(id);return result(true);}return publish({...savedPlan,[section]:(savedPlan[section]??[]).filter(row=>row.id!==id),revision:savedPlan.revision+1},[id]);});},
    beginAdd(section,value){const existingIds=usedRecordIds();let id:string;do{id=`${section}-${++sequence}`;}while(existingIds.has(id));const date=`${savedPlan.startYear}-01-01`,owner=savedPlan.household.filers[0].id;
      const defaults:Record<Exclude<EditableSection,'household'>,RawObject>={salaries:{id,name:'New salary',ownerId:owner,employerId:`employer-${sequence}`,annualGrossCents:0,startDate:date,annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]},otherIncome:{id,name:'Other income',amountCents:0,frequency:'monthly',startDate:date,annualGrowthBps:0,classification:'ordinary-taxable',niitTreatment:'unknown'},expenses:{id,name:'Expense',amountCents:0,frequency:'monthly',startDate:date,annualGrowthBps:0,use:'personal',taxCategory:'personal'},children:{id,name:'Child',birthMonth:date.slice(0,7),includeAge18:false},debts:{id,name:'Debt',openingBalanceCents:0,aprBps:0,monthlyPaymentCents:0,firstPaymentMonth:date.slice(0,7)},accounts:{id,name:'Account',ownerId:owner,type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}},contributions:{id,accountId:savedPlan.accounts.find(account=>account.type!=='rsu')?.id??'',priority:1,startDate:date,amount:{kind:'fixed',monthlyCents:0}},properties:{property:{id,name:'Property',role:'primary',purchaseDate:date,purchasePriceCents:0,downPaymentCents:0,openingValueCents:0,appreciationBps:0,appreciationOverrides:[],loans:[]},rentals:[],expenses:[]},rentals:{id,propertyId:savedPlan.properties[0]?.id??''}};
      bases.set(id,snapshot(section,id));drafts={...drafts,[id]:{recordId:id,section,value:toDraftValue(value??(section==='household'?householdValue():defaults[section]))}};issues=[];notify();return id;
    },
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},exportBackup:()=>exportPlan(savedPlan),
    resetPlan(next,initial={persisted:true,persistenceIssues:[]}){if(port)throw new Error('Managed editors require a scenario replacement.');const validated=requiredPlan(next),calculated=calculateProjection(validated,ruleSet);allocationEpoch++;controllerEpoch++;draftGenerations.clear();savedPlan=validated;projection=calculated;drafts={};bases.clear();allocationDraft=undefined;allocationDefault=undefined;allocationBase=undefined;persisted=initial.persisted;persistenceIssues=initial.persistenceIssues;issues=[];notify({kind:'restore',persisted});},
  };editBridges.set(controller,{prepare,complete,apply(calculated){const target=calculated.prepared.target,id=target.kind==='record'?target.recordId:getAllocationDraft().recordId;return operate('save',id,()=>commitCalculated(calculated));}});allocationBridges.set(controller,{prepare:prepareAllocation,epoch:()=>allocationEpoch,adu(projectId){if(!savedPlan.properties.some(p=>p.aduProject?.id===projectId))return{status:'invalid',issues:[{code:'required-adu-project',recordId:projectId,field:'aduComparison',severity:'warning',explanation:'This project is absent from the applied scenario.',resolution:'Select an applied ADU project.'}]};return{status:'ready',plan:savedPlan,ruleSet,projection,inputRevision:savedPlan.revision};}});return controller;
}
