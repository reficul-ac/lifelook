import type {Issue,PlanDocument} from '../engine';
import {toDraftValue} from './draft-codec';
import {parseRateInput} from './input-parsers';
import type {RawObject} from './state';

export interface GrowthAssumptionsDraft {readonly value:RawObject;readonly baseSnapshot:string}

/** Only facts owned by the growth transaction conflict with its retained draft. */
export function growthAssumptionsSnapshot(plan:PlanDocument):string {
 return JSON.stringify({defaults:plan.growthAssumptions,accounts:plan.accounts.map(a=>({id:a.id,type:a.type,source:a.growthSource,rate:a.annualGrowthBps})),properties:plan.properties.map(p=>({id:p.id,source:p.appreciationSource,rate:p.appreciationBps,overrides:p.appreciationOverrides}))});
}
export function createGrowthDraft(plan:PlanDocument):GrowthAssumptionsDraft {
 return {baseSnapshot:growthAssumptionsSnapshot(plan),value:{defaults:toDraftValue(plan.growthAssumptions??{}),inheritAccountIds:plan.accounts.filter(a=>a.growthSource==='stocks-default').map(a=>a.id),inheritPropertyIds:plan.properties.filter(p=>p.appreciationSource==='property-default').map(p=>p.id)}};
}
export function decodeGrowthDraft(draft:GrowthAssumptionsDraft,plan:PlanDocument):Readonly<{value:RawObject;issues:readonly Issue[]}> {
 const issues:Issue[]=[],defaults:RawObject={},raw=draft.value.defaults;
 const invalid=(field:string,explanation:string)=>issues.push({code:'invalid-input',field,severity:'error',explanation,resolution:'Review the growth default and asset selection before applying.'});
 if(!raw||typeof raw!=='object'||Array.isArray(raw))invalid('growthAssumptions','Enter category growth defaults.');
 else for(const key of ['stocksBps','propertyBps'] as const){
  const text=(raw as RawObject)[key];if(text===undefined||typeof text==='string'&&text.trim()==='')continue;
  if(typeof text!=='string'){invalid(`growthAssumptions.${key}`,'Enter a percentage using ordinary decimal digits.');continue;}
  const parsed=parseRateInput(text);
  if(parsed.status==='available')defaults[key]=parsed.value;
  else issues.push(...parsed.issues.map(issue=>({...issue,field:`growthAssumptions.${key}`})));
 }
 const membership=(field:'inheritAccountIds'|'inheritPropertyIds',category:'stocksBps'|'propertyBps'):string[]=>{
  const value=draft.value[field];if(!Array.isArray(value)){invalid(field,'Choose a list of assets to use this default.');return [];}
  const selected:string[]=[],seen=new Set<string>();
  for(const id of value){
   if(typeof id!=='string'||seen.has(id)){invalid(field,'Each selected asset must have one unique ID.');continue;}
   seen.add(id);selected.push(id);
   const eligible=field==='inheritAccountIds'?plan.accounts.some(a=>a.id===id&&a.type!=='rsu'):plan.properties.some(p=>p.id===id);
   if(!eligible)invalid(field,'A selected asset is missing or is no longer eligible for this default.');
  }
  if(selected.length&&defaults[category]===undefined)invalid(`growthAssumptions.${category}`,'Set a category default or return its selected assets to Custom.');
  return selected;
 };
 const inheritAccountIds=membership('inheritAccountIds','stocksBps'),inheritPropertyIds=membership('inheritPropertyIds','propertyBps');
 return {value:{defaults,inheritAccountIds,inheritPropertyIds},issues};
}
