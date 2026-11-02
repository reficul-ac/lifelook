import {validatePlan} from '../validation';
import {Decimal} from '../money';
import {initialTaxState} from '../model/tax-state';
import {projectRsuAccounts,rsuPriceAt} from '../equity/rsu';
import type {Available} from '../model/results';
import type {ForecastCheckpoint,ForecastContext} from './types';
const available=<T>(value:T):Available<T>=>({status:'available',value});
export function initializeForecast(context:ForecastContext):ForecastCheckpoint {
 const plan=context.plan,purchases=new Set(plan.properties.filter(p=>p.purchaseDate>`${plan.startYear}-01-01`).map(p=>p.id));
 return {sourceIssues:[],schemaVersion:1,year:plan.startYear,sourceBinding:context.sourceBinding,ruleBinding:context.ruleBinding,
  rothHistoryByAccount:Object.fromEntries(plan.accounts.filter(a=>a.type==='roth-ira'||a.type==='roth-401k').map(a=>[a.id,{openingContributionBasis:{known:false},contributionsSinceStartCents:available(0),conversionLayers:[]}])),
  accountExact:Object.fromEntries(plan.accounts.map(a=>[a.id,available(a.type==='rsu'?a.rsu!.grants.reduce((n,g)=>n.plus(g.openingHeldShares),new Decimal(0)).times(rsuPriceAt(plan.startYear,a)(plan.startYear,1)).toString():String(a.openingBalanceCents))])),
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
  const decimal=(v:unknown):v is string=>typeof v==='string'&&new Decimal(v).isFinite()&&new Decimal(v).gte(0);
  const money=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=99_999_999_999_999;
  const history=(v:unknown,test:(value:unknown)=>boolean):boolean=>obj(v)&&typeof v.known==='boolean'&&(v.known?test(v.value):!Object.hasOwn(v,'value'));
  const moneyHistory=(v:unknown)=>history(v,money);
  const year=(v:unknown)=>Number.isInteger(v)&&Number(v)>=1&&Number(v)<=9999;
  const ownerIds=new Set(context.plan.household.filers.map(o=>o.id));
  const cents=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v);
  if(c.retirementInventory||c.retirementAccounts){
   const {retirementAnalysis:_,...base}=context.plan;const active=validatePlan({...base,...c.retirementInventory,...(c.retirementAccounts?{accounts:c.retirementAccounts}:{})});if(!active.ok)return failed();
   if(c.retirementAccounts&&context.plan.accounts.some(a=>!c.retirementAccounts?.some(v=>v.id===a.id&&v.ownerId===a.ownerId&&v.type===a.type)))return failed();
  }
  const expectedAccounts=[...new Set([...Object.keys(initial.accountExact),...(c.retirementAccounts??[]).map(a=>a.id)])],expectedProperties=[...new Set([...Object.keys(initial.propertyExact),...(c.retirementInventory?.properties??[]).map(p=>p.id)])];
  for(const key of ['accountExact','propertyExact','existingHomeExact'] as const){if(!obj(c[key])||JSON.stringify(Object.keys(c[key]).sort())!==JSON.stringify((key==='accountExact'?expectedAccounts:expectedProperties).sort())||!Object.values(c[key]).every(v=>availableValue(v,decimal)))return failed();}
  for(const key of ['brokerageBasis','loanClosing'] as const)if(!obj(c[key])||!Object.values(c[key]).every(v=>availableValue(v,cents)))return failed();
  for(const key of ['brokerageBasisHistory','rsuState','priorMarketComplete','loanOrigin','rothHistoryByAccount'] as const)if(!obj(c[key]))return failed();
  if(!availableValue(c.reserve,cents)||!availableValue(c.lastEarmarked,cents)||!obj(c.taxState)||c.taxState.year!==c.year-1||!obj(c.taxState.rentals)||!obj(c.taxState.iraBasisByOwner)||!obj(c.taxState.minimumTaxCreditCoverage))return failed();
  const activeAccounts=c.retirementAccounts??context.plan.accounts,accountById=new Map(activeAccounts.map(a=>[a.id,a])),sameKeys=(a:Record<string,unknown>,ids:readonly string[])=>JSON.stringify(Object.keys(a).sort())===JSON.stringify([...ids].sort());
  if(c.retirementAccounts?.some(a=>!context.plan.accounts.some(original=>original.id===a.id)&&a.type!=='taxable-brokerage'))return failed();
  if(c.retirementAccountBalances!==undefined){
   if(!Array.isArray(c.retirementAccountBalances)||c.retirementAccountBalances.length!==activeAccounts.length||new Set(c.retirementAccountBalances.map(a=>a.accountId)).size!==activeAccounts.length)return failed();
   for(const a of c.retirementAccountBalances){const descriptor=accountById.get(a.accountId);if(!obj(a)||!descriptor||a.ownerId!==descriptor.ownerId||a.type!==descriptor.type||!decimal(a.balanceExact)||new Decimal(a.balanceExact).gt(99_999_999_999_999)||!moneyHistory(a.basis)||a.californiaBasis!==undefined&&!moneyHistory(a.californiaBasis)||[a.estimatedBasisCents,a.estimatedCaliforniaBasisCents].some(v=>v!==undefined&&!money(v)))return failed();}
  }
  const rothIds=activeAccounts.filter(a=>a.type==='roth-ira'||a.type==='roth-401k').map(a=>a.id),rsuIds=activeAccounts.filter(a=>a.type==='rsu').map(a=>a.id);
  if(!sameKeys(c.rsuState,rsuIds)||!sameKeys(c.rothHistoryByAccount,rothIds))return failed();
  const conversions=(v:unknown,availableAmounts=false):boolean=>Array.isArray(v)&&v.every(l=>obj(l)&&year(l.year)&&(availableAmounts?availableValue(l.taxableCents,money)&&availableValue(l.nontaxableCents,money):money(l.taxableCents)&&money(l.nontaxableCents))&&(l.californiaTaxableCents===undefined||money(l.californiaTaxableCents)));
  for(const h of Object.values(c.rothHistoryByAccount))if(!obj(h)||!moneyHistory(h.openingContributionBasis)||!availableValue(h.contributionsSinceStartCents,money)||!conversions(h.conversionLayers,true)||h.firstKnownContributionYear!==undefined&&(!year(h.firstKnownContributionYear)||Number(h.firstKnownContributionYear)>=c.year))return failed();
  const retirement=c.taxState.retirementAccountState;
  if(retirement!==undefined){
   if(!obj(retirement)||!obj(retirement.iraBasisByOwner)||!obj(retirement.rothByAccount))return failed();
   for(const [id,b]of Object.entries(retirement.iraBasisByOwner))if(!ownerIds.has(id)||!obj(b)||!moneyHistory(b.federal)||!moneyHistory(b.california)||b.californiaPre1987Basis!==undefined&&!moneyHistory(b.californiaPre1987Basis)||[b.estimatedFederalCents,b.estimatedCaliforniaCents].some(v=>v!==undefined&&!money(v)))return failed();
   for(const [id,h]of Object.entries(retirement.rothByAccount))if(!rothIds.includes(id)||!obj(h)||!moneyHistory(h.contributionBasis)||!history(h.firstContributionYear,year)||!conversions(h.conversionLayers)||h.estimatedContributionBasisCents!==undefined&&!money(h.estimatedContributionBasisCents)||h.firstKnownContributionYear!==undefined&&(!year(h.firstKnownContributionYear)||Number(h.firstKnownContributionYear)>=c.year))return failed();
  }
  for(const value of Object.values(c.taxState.iraBasisByOwner))if(!moneyHistory(value))return failed();
  for(const value of Object.values(c.taxState.minimumTaxCreditCoverage))if(!history(value,v=>typeof v==='boolean'))return failed();
  for(const state of Object.values(c.rsuState))if(!availableValue(state,v=>Array.isArray(v)&&v.every(s=>obj(s)&&typeof s.accountId==='string'&&typeof s.grantId==='string'&&Number.isInteger(s.eventIndex)&&['serviceVested','held','vestedValueExact','withholdingExact','priorVestedValueRounded','priorWithholdingRounded'].every(k=>decimal(s[k]))&&(s.basisExact===undefined||decimal(s.basisExact))&&(s.estimatedBasisExact===undefined||decimal(s.estimatedBasisExact)))))return failed();
  return available(c);
 }catch{return failed();}
}
