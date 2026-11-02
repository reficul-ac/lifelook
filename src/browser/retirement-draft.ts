import {createDefaultRetirementAnalysis,validateRetirementAnalysis,type ValidatedPlan,type ValidatedRetirementAnalysis,type Issue} from '../engine';
import {Decimal} from '../engine/money';
import {parseMoneyInput,parseRateInput} from './input-parsers';
import type {RawObject} from './state';
export interface RetirementDraft {readonly baseSnapshot:string;readonly generation:number;readonly value:RawObject}
export const retirementDefinitionSnapshot=(plan:ValidatedPlan):string=>JSON.stringify(plan.retirementAnalysis??null);
const moneyKeys=new Set(['purchasePriceCents','annualOperatingCostsCents','monthlyRentCents','payoffFeesCents','salePriceCents','taxableCents','nontaxableCents','californiaTaxableCents']);
const rateKeys=new Set(['withdrawalBps','stockGrowthBps','appreciationBps','buyingCostBps','capitalizedBuyingCostBps','vacancyBps','rentGrowthBps','downPaymentBps','aprBps','sellingCostBps','buildingShareBps']);
const moneyHistoryKeys=new Set(['improvementsCents','taxableBasisCents','californiaBasisCents','rothContributionBasisCents','federalIraBasisCents','californiaIraBasisCents','californiaPre1987BasisCents']);
function kind(path:readonly string[]):'money'|'rate'|'integer'|'other'{
 const key=path.at(-1)!,parent=path.at(-2);if(moneyKeys.has(key))return 'money';if(rateKeys.has(key))return 'rate';
 if(key==='value'){if(moneyHistoryKeys.has(parent!)||['adjustedBasisByBook','priorDepreciationByBook'].some(k=>path.at(-3)===k))return 'money';if(parent==='rothFirstContributionYear'||parent==='rmdAgeAssumption')return 'integer';}
 return ['schemaVersion','termMonths','year'].includes(key)?'integer':'other';
}
function encode(value:unknown,path:readonly string[]=[]):unknown {
 if(typeof value==='number')return kind(path)==='money'||kind(path)==='rate'?new Decimal(value).div(100).toFixed(2):path.at(-1)==='schemaVersion'?value:String(value);
 if(Array.isArray(value))return value.map((v,i)=>encode(v,[...path,String(i)]));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,encode(v,[...path,key])]));return value;
}
export const toRetirementRaw=(value:unknown):RawObject=>encode(value) as RawObject;
export function createRetirementDraft(plan:ValidatedPlan):RetirementDraft{return {baseSnapshot:retirementDefinitionSnapshot(plan),generation:0,value:toRetirementRaw(plan.retirementAnalysis??createDefaultRetirementAnalysis(plan))};}
export function decodeRetirementDraft(draft:RetirementDraft,source:ValidatedPlan):{definition?:ValidatedRetirementAnalysis;issues:readonly Issue[]}{
 const issues:Issue[]=[];
 const decode=(value:unknown,path:readonly string[]=[]):unknown=>{
  if(Array.isArray(value))return value.map((v,i)=>decode(v,[...path,String(i)]));
  if(value&&typeof value==='object'){const object=value as RawObject;return Object.fromEntries(Object.entries(object).filter(([key])=>key!=='__draft'&&!(key==='value'&&object.known===false)).map(([key,v])=>[key,decode(v,[...path,key])]));}
  if(typeof value!=='string')return value;const type=kind(path);
  if(type==='money'||type==='rate'){const result=(type==='money'?parseMoneyInput:parseRateInput)(value);if(result.status==='available')return result.value;issues.push(...result.issues.map(i=>({...i,field:`retirementAnalysis.${path.join('.')}`})));}
  else if(type==='integer'){if(/^-?\d+$/.test(value.trim())&&Number.isSafeInteger(Number(value)))return Number(value);issues.push({code:'invalid-input',field:`retirementAnalysis.${path.join('.')}`,severity:'error',explanation:'Enter a whole number; blank is unknown.',resolution:'Review this retirement input.'});}
  return value;
 };
 const raw=decode(draft.value),validated=validateRetirementAnalysis(raw,source);return validated.ok&&issues.length===0?{definition:validated.definition,issues:[]}:{issues:[...issues,...(validated.ok?[]:validated.issues)]};
}
