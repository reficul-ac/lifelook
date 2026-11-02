import {Decimal} from '../money';
import {initialTaxState} from '../model/tax-state';
import {projectRsuAccounts} from '../equity/rsu';
import type {Available} from '../model/results';
import type {ForecastCheckpoint,ForecastContext} from './types';
const available=<T>(value:T):Available<T>=>({status:'available',value});
export function initializeForecast(context:ForecastContext):ForecastCheckpoint {
 const plan=context.plan,purchases=new Set(plan.properties.filter(p=>p.purchaseDate>`${plan.startYear}-01-01`).map(p=>p.id));
 return {sourceIssues:[],schemaVersion:1,year:plan.startYear,sourceBinding:context.sourceBinding,ruleBinding:context.ruleBinding,
  rothHistoryByAccount:Object.fromEntries(plan.accounts.filter(a=>a.type==='roth-ira'||a.type==='roth-401k').map(a=>[a.id,{openingContributionBasis:{known:false},contributionsSinceStartCents:available(0),conversionLayers:[]}])),
  accountExact:Object.fromEntries(plan.accounts.map(a=>[a.id,available(String(a.openingBalanceCents))])),
  brokerageBasis:Object.fromEntries(plan.accounts.filter(a=>a.type==='taxable-brokerage').map(a=>[a.id,available(a.openingTaxableBasis?.known?a.openingTaxableBasis.value:0)])),
  brokerageBasisHistory:Object.fromEntries(plan.accounts.filter(a=>a.type==='taxable-brokerage').map(a=>[a.id,a.openingTaxableBasis??{known:false}])),
  rsuState:Object.fromEntries(plan.accounts.filter(a=>a.type==='rsu').map(a=>[a.id,available(projectRsuAccounts({...plan,accounts:[a]},{startYear:plan.startYear,endYear:plan.startYear-1}).closingState!)])),
  propertyExact:Object.fromEntries(plan.properties.map(p=>[p.id,available(String(purchases.has(p.id)?0:p.openingValueCents))])),existingHomeExact:Object.fromEntries(plan.properties.map(p=>[p.id,available(String(purchases.has(p.id)?0:p.openingValueCents))])),priorMarketComplete:Object.fromEntries(plan.properties.map(p=>[p.id,true])),
  loanClosing:{},loanOrigin:{},taxState:initialTaxState(plan),reserve:available(plan.openingCashCents),conditionalOnGap:false,lastEarmarked:available(0)};
}
export function serializeForecastCheckpoint(checkpoint:ForecastCheckpoint):string {return JSON.stringify(checkpoint);}
export function restoreForecastCheckpoint(context:ForecastContext,json:string):Available<ForecastCheckpoint> {
 const failed=():Available<never>=>({status:'unsupported-case',issues:[{code:'invalid-forecast-checkpoint',recordId:context.source.id,field:'checkpoint',severity:'error',explanation:'The checkpoint is malformed or belongs to another source or rule set.',resolution:'Recalculate checkpoints from the current applied source.'}]});
 try{
  const raw:unknown=JSON.parse(json);if(!raw||typeof raw!=='object'||Array.isArray(raw))return failed();
  const c=raw as ForecastCheckpoint,initial=initializeForecast(context);
  if(c.schemaVersion!==1||c.sourceBinding!==context.sourceBinding||c.ruleBinding!==context.ruleBinding||!Number.isInteger(c.year)||c.year<context.source.startYear||c.year>2101&&c.year>context.source.startYear+context.source.horizonYears||typeof c.conditionalOnGap!=='boolean')return failed();
  const obj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
  const availableValue=(v:unknown,check:(v:unknown)=>boolean):boolean=>obj(v)&&(v.status==='available'?check(v.value):(v.status==='needs-data'||v.status==='unsupported-case')&&Array.isArray(v.issues));
  const decimal=(v:unknown)=>typeof v==='string'&&new Decimal(v).isFinite();
  const cents=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v);
  for(const key of ['accountExact','propertyExact','existingHomeExact'] as const){if(!obj(c[key])||JSON.stringify(Object.keys(c[key]).sort())!==JSON.stringify(Object.keys(initial[key]).sort())||!Object.values(c[key]).every(v=>availableValue(v,decimal)))return failed();}
  for(const key of ['brokerageBasis','loanClosing'] as const)if(!obj(c[key])||!Object.values(c[key]).every(v=>availableValue(v,cents)))return failed();
  for(const key of ['brokerageBasisHistory','rsuState','priorMarketComplete','loanOrigin','rothHistoryByAccount'] as const)if(!obj(c[key]))return failed();
  if(!availableValue(c.reserve,cents)||!availableValue(c.lastEarmarked,cents)||!obj(c.taxState)||c.taxState.year!==c.year-1||!obj(c.taxState.rentals)||!obj(c.taxState.iraBasisByOwner)||!obj(c.taxState.minimumTaxCreditCoverage))return failed();
  for(const state of Object.values(c.rsuState))if(!availableValue(state,v=>Array.isArray(v)&&v.every(s=>obj(s)&&typeof s.accountId==='string'&&typeof s.grantId==='string'&&Number.isInteger(s.eventIndex)&&['serviceVested','held','vestedValueExact','withholdingExact','priorVestedValueRounded','priorWithholdingRounded'].every(k=>decimal(s[k]))&&(s.basisExact===undefined||decimal(s.basisExact)))))return failed();
  return available(c);
 }catch{return failed();}
}
