import type {PlanDocument} from '../model/plan';
import type {Issue} from '../model/results';
import {MAX_CENTS} from '../money';
import {isValidISODate} from '../dates';
import type {ValidatedRetirementAnalysis} from './definition';
type Obj=Record<string,unknown>;
const object=(raw:unknown):raw is Obj=>typeof raw==='object'&&raw!==null&&!Array.isArray(raw)&&(Object.getPrototypeOf(raw)===Object.prototype||Object.getPrototypeOf(raw)===null);
/** Retirement validates its own input boundary; it does not widen saved forecast calendars. */
export function validateRetirementAnalysis(raw:unknown,source:PlanDocument):{ok:true;definition:ValidatedRetirementAnalysis}|{ok:false;issues:readonly Issue[]} {
 const issues:Issue[]=[];
 const issue=(field:string,explanation:string,code='invalid-input',recordId?:string)=>issues.push({code,field:`retirementAnalysis.${field}`,...(recordId?{recordId}:{}),severity:'error',explanation,resolution:'Review the retirement input or explicitly resolve its source reference.'});
 const obj=(value:unknown,path:string,keys:readonly string[]):Obj=>{if(!object(value)){issue(path,'A plain JSON object is required.');return {}; }for(const key of Object.keys(value))if(!keys.includes(key))issue(`${path}.${key}`,'This field is not a supported retirement input.');return value;};
 const arr=(value:unknown,path:string):unknown[]=>{if(!Array.isArray(value)){issue(path,'An array is required.');return [];}return value;};
 const integer=(value:unknown,path:string,min=0,max=MAX_CENTS)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)issue(path,`An integer from ${min} through ${max} is required.`);};
 const text=(value:unknown,path:string)=>{if(typeof value!=='string'||!value.trim())issue(path,'A nonempty string is required.');};
 const choice=(value:unknown,path:string,options:readonly unknown[])=>{if(!options.includes(value))issue(path,'Choose a supported value.');};
 const percent=(value:unknown,path:string)=>integer(value,path,0,10000);
 const growth=(value:unknown,path:string)=>integer(value,path,-9999,100000);
 const bool=(value:unknown,path:string)=>choice(value,path,[true,false]);
 const date=(value:unknown,path:string)=>{if(!isValidISODate(value))issue(path,'Use a valid ISO calendar date.');};
 const history=(value:unknown,path:string,check:(v:unknown,p:string)=>void)=>{const h=obj(value,path,['known','value']);bool(h.known,`${path}.known`);if(h.known===true)check(h.value,`${path}.value`);else if(Object.hasOwn(h,'value'))issue(path,'Unknown history must not carry a value.');};
 const ref=(value:unknown,path:string,ids:ReadonlySet<string>)=>{text(value,path);if(typeof value==='string'&&!ids.has(value))issue(path,'The referenced source record does not exist.','dangling-reference',value);};
 const propertyIds=new Set(source.properties.map(p=>p.id)),accountIds=new Set(source.accounts.map(a=>a.id)),ownerIds=new Set(source.household.filers.map(o=>o.id));
 const allIds=new Set([source.id,...ownerIds,...source.salaries.map(s=>s.id),...source.otherIncome.map(s=>s.id),...source.expenses.map(s=>s.id),...accountIds,...source.properties.flatMap(p=>[p.id,...p.loans.map(l=>l.id),...(p.aduProject?[p.aduProject.id,...p.aduProject.costs.map(c=>c.id),...(p.aduProject.financing?[p.aduProject.financing.id]:[])]:[])]),...source.rentals.map(r=>r.id),...source.debts.map(d=>d.id),...source.contributions.map(c=>c.id),...(source.children??[]).map(c=>c.id),...(source.cashFlowAllocation?[source.cashFlowAllocation.id,...source.cashFlowAllocation.entries.map(e=>e.id),source.cashFlowAllocation.overflow.id]:[])]);
 const root=obj(raw,'',['schemaVersion','mode','withdrawalBps','stockGrowthBps','existingProperties','newProperties','assumptions','commitments']);
 choice(root.schemaVersion,'schemaVersion',[1]);choice(root.mode,'mode',['projected','reallocate']);percent(root.withdrawalBps,'withdrawalBps');
 if(root.stockGrowthBps!==undefined)growth(root.stockGrowthBps,'stockGrowthBps');else if(root.mode==='reallocate'&&source.growthAssumptions?.stocksBps===undefined)issue('stockGrowthBps','Enter a retirement stock-growth assumption.');
 const unique=(rows:unknown[],path:string,key:string,visit:(o:Obj,p:string)=>void,keys:readonly string[])=>{const seen=new Set<unknown>();rows.forEach((value,i)=>{const p=`${path}[${i}]`,o=obj(value,p,keys);if(seen.has(o[key]))issue(`${p}.${key}`,'Duplicate record references are not permitted.','duplicate-id');seen.add(o[key]);visit(o,p);});};
 unique(arr(root.existingProperties,'existingProperties'),'existingProperties','propertyId',(o,p)=>{
  ref(o.propertyId,`${p}.propertyId`,propertyIds);choice(o.action,`${p}.action`,['keep','convert-to-rental','sell']);
  const loans=new Set(source.properties.find(s=>s.id===o.propertyId)?.loans.map(l=>l.id)??[]),seen=new Set<unknown>();
  arr(o.payoffLoanIds,`${p}.payoffLoanIds`).forEach((id,i)=>{ref(id,`${p}.payoffLoanIds[${i}]`,loans);if(seen.has(id))issue(`${p}.payoffLoanIds`,'A loan can be paid off only once.','duplicate-id');seen.add(id);});
  for(const k of ['payoffFeesCents','salePriceCents'])if(o[k]!==undefined)integer(o[k],`${p}.${k}`);
  if(o.sellingCostBps!==undefined)percent(o.sellingCostBps,`${p}.sellingCostBps`);
  if(o.conversion!==undefined){const b=obj(o.conversion,`${p}.conversion`,['monthlyRentCents','annualOperatingCostsCents','vacancyBps','rentGrowthBps']);budget(b,`${p}.conversion`,true);}
  if(o.action==='convert-to-rental'&&o.conversion===undefined)issue(`${p}.conversion`,'Enter the rental budget for this conversion.');
 },['propertyId','action','payoffLoanIds','payoffFeesCents','salePriceCents','sellingCostBps','conversion']);
 function budget(o:Obj,p:string,rental:boolean){integer(o.annualOperatingCostsCents,`${p}.annualOperatingCostsCents`);if(rental||o.monthlyRentCents!==undefined)integer(o.monthlyRentCents,`${p}.monthlyRentCents`);if(rental||o.vacancyBps!==undefined)percent(o.vacancyBps,`${p}.vacancyBps`);if(rental||o.rentGrowthBps!==undefined)growth(o.rentGrowthBps,`${p}.rentGrowthBps`);}
 unique(arr(root.newProperties,'newProperties'),'newProperties','id',(o,p)=>{
  text(o.id,`${p}.id`);if(typeof o.id==='string'){if(allIds.has(o.id))issue(`${p}.id`,'Target IDs must be distinct from source IDs.','duplicate-id');allIds.add(o.id);}
  text(o.name,`${p}.name`);choice(o.use,`${p}.use`,['personal','rental']);integer(o.purchasePriceCents,`${p}.purchasePriceCents`,1);growth(o.appreciationBps,`${p}.appreciationBps`);budget(o,p,o.use==='rental');if(o.buyingCostBps!==undefined)percent(o.buyingCostBps,`${p}.buyingCostBps`);
  const f=obj(o.financing,`${p}.financing`,['kind','downPaymentBps','aprBps','termMonths']);choice(f.kind,`${p}.financing.kind`,['cash','mortgage']);
  if(f.kind==='mortgage'){percent(f.downPaymentBps,`${p}.financing.downPaymentBps`);integer(f.aprBps,`${p}.financing.aprBps`,0,100000);integer(f.termMonths,`${p}.financing.termMonths`,1,1200);}else if(Object.keys(f).some(k=>k!=='kind'))issue(`${p}.financing`,'Cash financing does not carry mortgage terms.');
 },['id','name','use','purchasePriceCents','appreciationBps','buyingCostBps','annualOperatingCostsCents','monthlyRentCents','vacancyBps','rentGrowthBps','financing']);
 const assumptions=obj(root.assumptions,'assumptions',['properties','accounts','owners','sellingCostBps','buyingCostBps','buildingShareBps','noFederalSaltBenefitForCaliforniaAdditionalTax']);
 for(const k of ['sellingCostBps','buyingCostBps','buildingShareBps'])percent(assumptions[k],`assumptions.${k}`);
 bool(assumptions.noFederalSaltBenefitForCaliforniaAdditionalTax,'assumptions.noFederalSaltBenefitForCaliforniaAdditionalTax');
 unique(arr(assumptions.properties,'assumptions.properties'),'assumptions.properties','propertyId',(o,p)=>{
  ref(o.propertyId,`${p}.propertyId`,propertyIds);if(o.buildingShareBps!==undefined)percent(o.buildingShareBps,`${p}.buildingShareBps`);
  if(o.improvementsCents!==undefined)history(o.improvementsCents,`${p}.improvementsCents`,integer);
  for(const k of ['homeExclusionEligible','zero1231Lookback'])if(o[k]!==undefined)history(o[k],`${p}.${k}`,bool);
  if(o.activityId!==undefined)text(o.activityId,`${p}.activityId`);
  for(const key of ['adjustedBasisByBook','priorDepreciationByBook'])if(o[key]!==undefined){const b=obj(o[key],`${p}.${key}`,['federal','california','federal-amt','california-amt']);for(const [book,value]of Object.entries(b))history(value,`${p}.${key}.${book}`,integer);}
 },['propertyId','buildingShareBps','improvementsCents','adjustedBasisByBook','priorDepreciationByBook','homeExclusionEligible','activityId','zero1231Lookback']);
 unique(arr(assumptions.accounts,'assumptions.accounts'),'assumptions.accounts','accountId',(o,p)=>{
  ref(o.accountId,`${p}.accountId`,accountIds);
  for(const k of ['taxableBasisCents','californiaBasisCents','rothContributionBasisCents'])if(o[k]!==undefined)history(o[k],`${p}.${k}`,integer);
  if(o.rothFirstContributionYear!==undefined)history(o.rothFirstContributionYear,`${p}.rothFirstContributionYear`,(v,path)=>integer(v,path,1900,9999));
  if(o.separationDate!==undefined)history(o.separationDate,`${p}.separationDate`,date);
  if(o.conversionLayers!==undefined)unique(arr(o.conversionLayers,`${p}.conversionLayers`),`${p}.conversionLayers`,'year',(l,path)=>{integer(l.year,`${path}.year`,1900,9999);integer(l.taxableCents,`${path}.taxableCents`);integer(l.nontaxableCents,`${path}.nontaxableCents`);},['year','taxableCents','nontaxableCents']);
 },['accountId','taxableBasisCents','californiaBasisCents','rothContributionBasisCents','rothFirstContributionYear','conversionLayers','separationDate']);
 unique(arr(assumptions.owners,'assumptions.owners'),'assumptions.owners','ownerId',(o,p)=>{ref(o.ownerId,`${p}.ownerId`,ownerIds);if(o.birthDate!==undefined)history(o.birthDate,`${p}.birthDate`,date);for(const k of ['federalIraBasisCents','californiaIraBasisCents'])if(o[k]!==undefined)history(o[k],`${p}.${k}`,integer);},['ownerId','birthDate','federalIraBasisCents','californiaIraBasisCents']);
 const commitments=new Set(source.properties.flatMap(p=>[p.id,...(p.aduProject?[p.aduProject.id]:[])]));
 unique(arr(root.commitments,'commitments'),'commitments','recordId',(o,p)=>{ref(o.recordId,`${p}.recordId`,commitments);choice(o.action,`${p}.action`,['continue','exclude']);},['recordId','action']);
 return issues.length?{ok:false,issues}:{ok:true,definition:freeze(structuredClone(raw)) as ValidatedRetirementAnalysis};
}
function freeze<T>(value:T):T {if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
