import { calculateProjection,loadRuleSet,validatePlan,type Issue,type PlanDocument,type ProjectionResult,type RuleSet,type ValidatedPlan } from '../engine';
import { exportPlan,savePlan,type StoragePort } from './storage';
import { parseMoneyInput,parseRateInput } from './fields';
import { Decimal } from '../engine/money';

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
const moneyHistories=new Set(['openingIraBasis','openingBalance','openingPayment','openingBasis','conversionBuildingFmv','priorYearWagesCents','qualifiedPrincipalCents','wagesCents','ubiaCents','addedAssessedValueCents','valueCents']);
const rateHistories=new Set(['marginalRateBps']);
const decimalUnits=(value:number)=>{const sign=value<0?'-':'';const digits=String(Math.abs(value));return `${sign}${digits.length<3?'0':digits.slice(0,-2)}.${digits.slice(-2).padStart(2,'0')}`;};
/** Stored integers become entered dollars/percentages; histories retain explicit unknowns. */
export function toDraftValue(value:unknown,key='',historyKey=''):any {
  if(typeof value==='number')return key.endsWith('Cents')||key.endsWith('Bps')||key==='value'&&(moneyHistories.has(historyKey)||rateHistories.has(historyKey))?decimalUnits(value):String(value);
  if(Array.isArray(value))return value.map(row=>toDraftValue(row,key,historyKey));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([field,entry])=>[field,toDraftValue(entry,field,key)]));
  return value;
}
function decode(value:unknown,issues:Issue[],recordId:string,path:string,key='',historyKey=''):unknown {
  if(Array.isArray(value))return value.map((row,i)=>decode(row,issues,recordId,`${path}.${i}`,key,historyKey));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([field])=>field!=='__draft').map(([field,entry])=>[field,decode(entry,issues,recordId,path?`${path}.${field}`:field,field,key)]));
  if(typeof value!=='string')return value;
  const isMoney=key.endsWith('Cents')||key==='value'&&moneyHistories.has(historyKey),isRate=key.endsWith('Bps')||key==='value'&&rateHistories.has(historyKey);
  const integers=new Set(['year','startYear','horizonYears','raiseMonth','raiseDay','priority','termMonths','vestingMonths','cliffMonths','numerator','denominator','baselineYear','completedValueEnrollmentYear']);
  const parser=isMoney?parseMoneyInput:isRate?parseRateInput:undefined;
  if(parser){const result=parser(value);if(result.status==='available')return result.value;issues.push(...result.issues.map(issue=>({...issue,recordId,field:path})));return value;}
  if(key==='awardedShares'||key==='openingHeldShares'){
    const entered=value.trim(),number=Number(entered);
    if(/^-?\d+(?:\.\d{1,6})?$/.test(entered)&&Number.isFinite(number)&&new Decimal(entered).abs().lte(Number.MAX_SAFE_INTEGER)&&new Decimal(entered).eq(new Decimal(number)))return number;
    issues.push({code:'invalid-input',recordId,field:path,severity:'error',explanation:'Enter a finite ordinary share quantity with at most six decimal places; blank is unknown.',resolution:'Use digits and an optional decimal point, without exponents or separators, within the supported share range.'});return value;
  }
  if(key==='primaryArea'||key==='aduArea'){
    if(/^-?\d+(?:\.\d+)?$/.test(value.trim())&&Number.isFinite(Number(value)))return Number(value);
    issues.push({code:'invalid-input',recordId,field:path,severity:'error',explanation:'Enter living area as an ordinary finite decimal; blank is unknown.',resolution:'Enter the measured living area without exponents or separators.'});return value;
  }
  if(integers.has(key)){
    if(/^-?\d+$/.test(value.trim())&&Number.isSafeInteger(Number(value)))return Number(value);
    issues.push({code:'invalid-input',recordId,field:path,severity:'error',explanation:'Enter a whole number; a blank value is unknown, not zero.',resolution:'Enter a valid whole number before saving.'});
  }
  return value;
}
export function fromDraftValue(value:RawObject,recordId:string):Readonly<{value:RawObject;issues:readonly Issue[]}>{const issues:Issue[]=[];return {value:decode(value,issues,recordId,'') as RawObject,issues};}
function requiredPlan(plan:PlanDocument){const validation=validatePlan(plan);if(!validation.ok)throw new Error('Workspace requires a structurally valid saved plan.');return validation.plan;}

/** Browser-only bridge: the worker receives the exact rules captured by its workspace. */
export type PreparedAllocationPreview=Readonly<{status:'ready';plan:ValidatedPlan;ruleSet:RuleSet;inputRevision:number}>|Extract<CashFlowAllocationPreview,{status:'invalid'|'failed'}>;
export type PreparedAduComparison=Readonly<{status:'ready';plan:ValidatedPlan;ruleSet:RuleSet;projection:ProjectionResult;inputRevision:number}>|Readonly<{status:'invalid'|'failed';issues:readonly Issue[]}>;
const allocationBridges=new WeakMap<WorkspaceController,{prepare():PreparedAllocationPreview;epoch():number;adu(projectId:string):PreparedAduComparison}>();
export function prepareAduComparison(controller:WorkspaceController,projectId:string):PreparedAduComparison{const bridge=allocationBridges.get(controller);if(!bridge)throw new Error('Unknown ADU workspace.');return bridge.adu(projectId);}
export function prepareAllocationPreview(controller:WorkspaceController):PreparedAllocationPreview {
  const bridge=allocationBridges.get(controller);if(!bridge)throw new Error('Unknown allocation workspace.');return bridge.prepare();
}
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
  let operationDepth=0;
  const notify=(operation?:WorkspaceOperation)=>{if(operationDepth===0||operation)listeners.forEach(listener=>listener(operation));};
  const operate=(kind:'save'|'remove',recordId:string,action:()=>SaveRecordResult):SaveRecordResult=>{operationDepth++;let outcome:SaveRecordResult;try{outcome=action();}finally{operationDepth--;}if(operationDepth===0)notify({kind,recordId,result:outcome});return outcome;};
  const persistence=():WorkspaceInitialization=>port?.readPersistence()??{persisted,persistenceIssues};
  const result=(accepted:boolean):SaveRecordResult=>({accepted,...persistence(),issues});
  const persistApplied=():SaveRecordResult=>{
    if(port){const outcome=port.retry();issues=outcome.accepted?[]:outcome.issues;notify();return result(outcome.accepted);}
    const saved=savePlan(storage!,savedPlan);persisted=saved.persisted;persistenceIssues=saved.issues.filter(issue=>issue.code==='storage-write-failed');issues=[];notify();return result(true);
  };
  const publish=(candidate:PlanDocument,clear:readonly string[],clearAllocation=false):SaveRecordResult=>{
    const validation=validatePlan(candidate);if(!validation.ok){issues=validation.issues;notify();return result(false);}
    let candidateProjection:ProjectionResult;
    try { candidateProjection=calculateProjection(validation.plan,ruleSet); }
    catch { issues=[{code:'calculation-failed',field:'plan',severity:'error',explanation:'These inputs could not be calculated. The saved plan and projection have been retained.',resolution:'Correct the draft inputs before saving again.'}];notify();return result(false); }
    const commit=()=>{savedPlan=validation.plan;projection=candidateProjection;issues=[];
      drafts=Object.fromEntries(Object.entries(drafts).filter(([id])=>!clear.includes(id)));clear.forEach(id=>bases.delete(id));
      if(clearAllocation){allocationDraft=undefined;allocationDefault=undefined;allocationBase=undefined;}
    };
    if(port){const outcome=port.publish(validation.plan,candidateProjection,commit);if(!outcome.accepted){issues=outcome.issues;notify();return result(false);}}
    else{commit();const saved=savePlan(storage!,savedPlan);persisted=saved.persisted;persistenceIssues=saved.issues.filter(issue=>issue.code==='storage-write-failed');}
    notify();return result(true);
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
    const inputRevision=savedPlan.revision,draft=getAllocationDraft();
    if((allocationBase??draft.baseSnapshot)!==allocationSnapshot())return {status:'invalid',inputRevision,issues:[{code:'stale-record-draft',recordId:draft.recordId,field:'cashFlowAllocation',severity:'error',explanation:'A newer save changed the applied allocation while these edits were open. Your draft has been retained.',resolution:'Discard these edits and reload the applied allocation before editing again.'}]};
    const decoded=fromDraftValue(draft.value,draft.recordId);
    if(decoded.issues.length)return {status:'invalid',inputRevision,issues:decoded.issues};
    if(decoded.value.id!==draft.recordId)return {status:'invalid',inputRevision,issues:[{code:'invalid-input',recordId:draft.recordId,field:'id',severity:'error',explanation:'The original allocation ID must remain unchanged.',resolution:'Keep the original allocation ID.'}]};
    const validation=validatePlan({...savedPlan,cashFlowAllocation:decoded.value,revision:inputRevision+1});
    return validation.ok?{status:'ready',plan:validation.plan,ruleSet,inputRevision}:{status:'invalid',inputRevision,issues:validation.issues};
  };
  const draftFor=(id:string):RecordDraft|undefined=>Object.hasOwn(drafts,id)?drafts[id]:undefined;
  const snapshot=(section:EditableSection,id:string):string=>JSON.stringify(section==='household'?householdValue():section==='properties'?propertyValue(id):(savedPlan[section]??[]).find(row=>row.id===id)??null);
  const stale=(section:EditableSection,id:string):boolean=>{
    if(!bases.has(id)||bases.get(id)===snapshot(section,id))return false;
    issues=[{code:'stale-record-draft',recordId:id,field:section,severity:'error',explanation:'A newer save changed this record or its linked records while these edits were open. Your draft has been retained.',resolution:'Discard these edits and reload the saved values, then reapply your changes before saving.'}];notify();return true;
  };
  const rejectIdentity=(id:string,field:string):SaveRecordResult=>{issues=[{code:'invalid-input',recordId:id,field,severity:'error',explanation:'The original record ID must remain unchanged.',resolution:'Keep this record ID so its linked records continue to refer to the same record.'}];notify();return result(false);};
  const getDraft=(section:EditableSection,id:string):RecordDraft=>draftFor(id)??{recordId:id,section,baseSnapshot:snapshot(section,id),value:toDraftValue(section==='household'?householdValue():section==='properties'?propertyValue(id):(savedPlan[section]??[]).find(row=>row.id===id)??{})};
  const controller:WorkspaceController={
    getState:()=>({savedPlan,drafts,projection,...persistence(),issues,...(allocationDraft?{allocationDraft}:{})}),getDraft,getAllocationDraft,
    editAllocationDraft(draft){if(allocationDraft&&allocationDraft.recordId!==draft.recordId)throw new Error('Allocation draft identity must remain stable.');if(allocationBase===undefined)allocationBase=draft.baseSnapshot;allocationDraft={...structuredClone(draft),baseSnapshot:allocationBase};issues=[];notify();},
    discardAllocationDraft(){allocationEpoch++;allocationDraft=undefined;allocationDefault=undefined;allocationBase=undefined;issues=[];notify();},
    previewAllocation(){const prepared=prepareAllocation();if(prepared.status!=='ready')return prepared;try{return {status:'calculated',projection:calculateProjection(prepared.plan,prepared.ruleSet),inputRevision:prepared.inputRevision};}catch{return allocationCalculationFailure(prepared.inputRevision);}},
    applyAllocation(){allocationEpoch++;const id=getAllocationDraft().recordId;return operate('save',id,()=>{const prepared=prepareAllocation();if(prepared.status!=='ready'){issues=prepared.issues;notify();return result(false);}return publish(prepared.plan,[],true);});},
    editDraft(id,draft){if(id!==draft.recordId)throw new Error('Draft record identity must remain stable.');if(!bases.has(id))bases.set(id,draft.baseSnapshot??snapshot(draft.section,id));drafts={...drafts,[id]:structuredClone(draft)};issues=[];notify();},
    discardDraft(id){drafts=Object.fromEntries(Object.entries(drafts).filter(([key])=>key!==id));bases.delete(id);issues=[];notify();},
    saveRecord(id){return operate('save',id,()=>{
      const edited=draftFor(id),retry=persistence().persistenceIssues.some(issue=>issue.code==='storage-write-failed');
      if(!edited&&id==='household'&&retry)return persistApplied();
      const draft=edited??(id==='household'?getDraft('household',id):undefined);
      if(!draft){const sections=['salaries','otherIncome','expenses','children','debts','accounts','contributions','properties','rentals'] as const;return sections.some(section=>(savedPlan[section]??[]).some(record=>record.id===id))?persistApplied():result(false);}
      if(draft.section==='properties')return controller.saveProperty(id);
      if(stale(draft.section,id))return result(false);
      const decoded=fromDraftValue(draft.value,id);if(decoded.issues.length){issues=decoded.issues;notify();return result(false);}
      if(draft.section!=='household'&&decoded.value.id!==id)return rejectIdentity(id,'id');
      const candidate:PlanDocument=draft.section==='household'?{...savedPlan,...decoded.value,revision:savedPlan.revision+1}:{...savedPlan,[draft.section]:[...(savedPlan[draft.section]??[]).filter(row=>row.id!==id),decoded.value],revision:savedPlan.revision+1};
      return publish(candidate,[id]);
    });},
    saveProperty(id){return operate('save',id,()=>{if(!draftFor(id)&&savedPlan.properties.some(property=>property.id===id)&&persistence().persistenceIssues.some(issue=>issue.code==='storage-write-failed'))return persistApplied();const draft=draftFor(id)??getDraft('properties',id);if(stale('properties',id))return result(false);const decoded=fromDraftValue(draft.value,id);if(decoded.issues.length){issues=decoded.issues;notify();return result(false);}
      if((decoded.value.property as RawObject|undefined)?.id!==id)return rejectIdentity(id,'property.id');
      const existingRentalIds=new Set(savedPlan.rentals.filter(r=>r.propertyId===id).map(r=>r.id));
      return publish({...savedPlan,revision:savedPlan.revision+1,properties:[...savedPlan.properties.filter(p=>p.id!==id),decoded.value.property as PlanDocument['properties'][number]],rentals:[...savedPlan.rentals.filter(r=>r.propertyId!==id),...decoded.value.rentals as PlanDocument['rentals']],expenses:[...savedPlan.expenses.filter(e=>e.propertyId!==id&&(!e.rentalId||!existingRentalIds.has(e.rentalId))),...decoded.value.expenses as PlanDocument['expenses']]},[id]);
    });},
    removeRecord(section,id){return operate('remove',id,()=>{if(section==='household')return result(false);if(!(savedPlan[section]??[]).some(row=>row.id===id)){controller.discardDraft(id);return result(true);}return publish({...savedPlan,[section]:(savedPlan[section]??[]).filter(row=>row.id!==id),revision:savedPlan.revision+1},[id]);});},
    beginAdd(section,value){const existingIds=usedRecordIds();let id:string;do{id=`${section}-${++sequence}`;}while(existingIds.has(id));const date=`${savedPlan.startYear}-01-01`,owner=savedPlan.household.filers[0].id;
      const defaults:Record<Exclude<EditableSection,'household'>,RawObject>={salaries:{id,name:'New salary',ownerId:owner,employerId:`employer-${sequence}`,annualGrossCents:0,startDate:date,annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]},otherIncome:{id,name:'Other income',amountCents:0,frequency:'monthly',startDate:date,annualGrowthBps:0,classification:'ordinary-taxable',niitTreatment:'unknown'},expenses:{id,name:'Expense',amountCents:0,frequency:'monthly',startDate:date,annualGrowthBps:0,use:'personal',taxCategory:'personal'},children:{id,name:'Child',birthMonth:date.slice(0,7),includeAge18:false},debts:{id,name:'Debt',openingBalanceCents:0,aprBps:0,monthlyPaymentCents:0,firstPaymentMonth:date.slice(0,7)},accounts:{id,name:'Account',ownerId:owner,type:'taxable-brokerage',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false}},contributions:{id,accountId:savedPlan.accounts.find(account=>account.type!=='rsu')?.id??'',priority:1,startDate:date,amount:{kind:'fixed',monthlyCents:0}},properties:{property:{id,name:'Property',role:'primary',purchaseDate:date,purchasePriceCents:0,downPaymentCents:0,openingValueCents:0,appreciationBps:0,appreciationOverrides:[],loans:[]},rentals:[],expenses:[]},rentals:{id,propertyId:savedPlan.properties[0]?.id??''}};
      bases.set(id,snapshot(section,id));drafts={...drafts,[id]:{recordId:id,section,value:toDraftValue(value??(section==='household'?householdValue():defaults[section]))}};issues=[];notify();return id;
    },
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},exportBackup:()=>exportPlan(savedPlan),
    resetPlan(next,initial={persisted:true,persistenceIssues:[]}){if(port)throw new Error('Managed editors require a scenario replacement.');const validated=requiredPlan(next),calculated=calculateProjection(validated,ruleSet);allocationEpoch++;savedPlan=validated;projection=calculated;drafts={};bases.clear();allocationDraft=undefined;allocationDefault=undefined;allocationBase=undefined;persisted=initial.persisted;persistenceIssues=initial.persistenceIssues;issues=[];notify({kind:'restore',persisted});},
  };allocationBridges.set(controller,{prepare:prepareAllocation,epoch:()=>allocationEpoch,adu(projectId){if(!savedPlan.properties.some(p=>p.aduProject?.id===projectId))return{status:'invalid',issues:[{code:'required-adu-project',recordId:projectId,field:'aduComparison',severity:'warning',explanation:'This project is absent from the applied scenario.',resolution:'Select an applied ADU project.'}]};return{status:'ready',plan:savedPlan,ruleSet,projection,inputRevision:savedPlan.revision};}});return controller;
}
