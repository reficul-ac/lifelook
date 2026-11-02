import type {AccountType,Cents,History,ISODate} from '../model/plan';
import type {Available,Issue} from '../model/results';
import type {RetirementRothHistory} from '../model/tax-state';
import type {YearRules} from '../rules/types';
import {calendarDate,isValidISODate,parseISODate} from '../dates';
import {Decimal,MAX_CENTS,settleCents} from '../money';
import {uniformLifeFactorsTenths,jointLifeFactorsTenths} from '../rules/rmd-life-factors';
export interface RmdYearInput {readonly year:number;readonly owners:readonly {readonly ownerId:string;readonly birthDate:History<ISODate>;readonly spouseBirthDate:History<ISODate>;readonly rmdAgeAssumption?:History<number>}[];readonly accounts:readonly {readonly accountId:string;readonly ownerId:string;readonly type:AccountType;readonly priorDecemberBalanceCents:Available<Cents>;readonly soleSpouseBeneficiary:History<boolean>;readonly inherited?:boolean}[]}
export interface RmdAccountRequirement {readonly accountId:string;readonly ownerId:string;readonly aggregationGroupId:string;readonly requiredCents:Available<Cents>;readonly divisorTenths:Available<number|null>}
export interface RmdYearRequirement {readonly year:number;readonly accounts:readonly RmdAccountRequirement[];readonly groups:readonly {readonly groupId:string;readonly accountIds:readonly string[];readonly requiredCents:Available<Cents>}[];readonly totalRequiredCents:Available<Cents>;readonly issues:readonly Issue[];readonly assumptions:readonly string[]}
const av=<T>(value:T):Available<T>=>({status:'available',value});
function missing(id:string,year:number,field:string,text:string):Available<never>{return {status:'needs-data',issues:[{code:'required-retirement-distribution-history',recordId:id,year,field,severity:'warning',explanation:text,resolution:'Supply the owner/account history or a labeled retirement-only assumption.'}]};}
function add(values:readonly Available<Cents>[]):Available<Cents>{const failures=values.filter(v=>v.status!=='available');if(failures.length)return {status:failures.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data',issues:failures.flatMap(v=>v.issues)};return av(settleCents(values.reduce((n,v)=>n.plus(v.status==='available'?v.value:0),new Decimal(0))));}
function addMonths(date:ISODate,months:number):ISODate {const p=parseISODate(date),index=p.year*12+p.month-1+months;return calendarDate(Math.floor(index/12),index%12+1,p.day);}
export function calculateRequiredDistributions(input:RmdYearInput):Available<RmdYearRequirement>{
 if(!Number.isInteger(input.year)||input.year<2026||input.year>2100)return missing('retirement',input.year,'year','RMD analysis requires a retirement year from2026 through2100.');
 const assumptions:string[]=[],accounts:RmdAccountRequirement[]=[];
 for(const account of [...input.accounts].sort((a,b)=>a.accountId.localeCompare(b.accountId))){
  const group=account.type==='traditional-ira'?`${account.ownerId}:ira`:`${account.ownerId}:plan:${account.accountId}`,base={accountId:account.accountId,ownerId:account.ownerId,aggregationGroupId:group};
  if(account.inherited){const f=missing(account.accountId,input.year,'inherited','Inherited-account RMD treatment is outside the owner-lifetime model.');accounts.push({...base,requiredCents:f,divisorTenths:f});continue;}
  if(account.type==='roth-ira'||account.type==='roth-401k'||account.type==='taxable-brokerage'||account.type==='rsu'){accounts.push({...base,requiredCents:av(0),divisorTenths:av(null)});continue;}
  const owner=input.owners.find(o=>o.ownerId===account.ownerId);let failure:Available<never>|undefined;
  if(!owner?.birthDate.known||!isValidISODate(owner.birthDate.value)||owner.birthDate.value>`${input.year}-12-31`)failure=missing(account.ownerId,input.year,'birthDate','Owner RMD cohort and table age require an explicit birth date.');
  if(failure||!owner?.birthDate.known){const f=failure!;accounts.push({...base,requiredCents:f,divisorTenths:f});continue;}
  const birth=owner.birthDate.value,birthYear=Number(birth.slice(0,4)),age=input.year-birthYear;
  let firstYear=birth<'1949-07-01'?Number(addMonths(birth,70*12+6).slice(0,4)):birthYear<=1950?birthYear+72:birthYear<=1958?birthYear+73:birthYear>=1960?birthYear+75:Infinity;
  if(birthYear===1959){if(owner.rmdAgeAssumption?.known&&[73,75].includes(owner.rmdAgeAssumption.value)){firstYear=birthYear+owner.rmdAgeAssumption.value;assumptions.push(`Owner ${owner.ownerId}: birth1959 applicable age${owner.rmdAgeAssumption.value} is an explicit planning assumption; final regulations reserve this cohort.`);}else if(input.year>=2034)firstYear=2034;else if(input.year>=2032)failure=missing(owner.ownerId,input.year,'rmdAgeAssumption','Final regulations reserve the birth1959 cohort; enter a labeled applicable-age assumption.');}
  if(!failure&&input.year<firstYear){accounts.push({...base,requiredCents:av(0),divisorTenths:av(null)});continue;}
  let factor:number|undefined;
  if(!failure){
   if(!account.soleSpouseBeneficiary.known)failure=missing(account.accountId,input.year,'soleSpouseBeneficiary','The sole-spouse-beneficiary answer selects the legal RMD table.');
   else if(account.soleSpouseBeneficiary.value){
    if(!owner.spouseBirthDate.known||!isValidISODate(owner.spouseBirthDate.value))failure=missing(owner.ownerId,input.year,'spouseBirthDate','A sole-beneficiary spouse requires an explicit date of birth.');
    else {const spouse=owner.spouseBirthDate.value,spouseAge=input.year-Number(spouse.slice(0,4)),tenth=`${birthYear+10}${birth.slice(4)}`;factor=spouse>tenth?jointLifeFactorsTenths[Math.min(120,age)]?.[Math.min(120,spouseAge)]:uniformLifeFactorsTenths[Math.min(120,age)];}
   }else factor=uniformLifeFactorsTenths[Math.min(120,age)];
  }
  if(!failure&&(!factor||age<0))failure=missing(account.accountId,input.year,'distributionPeriod','No sourced lifetime-table factor is available for these ages.');
  const prior=account.priorDecemberBalanceCents;
  if(!failure&&prior.status==='available'&&(!Number.isSafeInteger(prior.value)||prior.value<0||prior.value>MAX_CENTS))failure=missing(account.accountId,input.year,'priorDecemberBalanceCents','Use the supported nonnegative priorDecember31 balance.');
  accounts.push({...base,divisorTenths:failure??av(factor!),requiredCents:failure??(prior.status==='available'?av(settleCents(new Decimal(prior.value).times(10).div(factor!))):prior)});
 }
 const ids=[...new Set(accounts.map(a=>a.aggregationGroupId))].sort(),groups=ids.map(groupId=>{const rows=accounts.filter(a=>a.aggregationGroupId===groupId);return {groupId,accountIds:rows.map(a=>a.accountId),requiredCents:add(rows.map(a=>a.requiredCents))};}),totalRequiredCents=add(accounts.map(a=>a.requiredCents));
 const issues=[...new Map(accounts.flatMap(a=>a.requiredCents.status==='available'?[]:a.requiredCents.issues).map(i=>[JSON.stringify(i),i])).values()];
 return av({year:input.year,accounts,groups,totalRequiredCents,issues,assumptions:[...new Set(assumptions)]});
}
export interface DistributionAccessInput {readonly accountId:string;readonly ownerId:string;readonly accountKind:AccountType;readonly date:ISODate;readonly birthDate:History<ISODate>;readonly grossCents:Cents;readonly federalTaxableCents:Available<Cents>;readonly californiaTaxableCents:Available<Cents>;readonly rules:YearRules;readonly separationDate?:History<ISODate>;readonly rothHistory?:RetirementRothHistory;readonly rothHistoryEstimated?:boolean;readonly accountBalanceCents?:Cents;readonly basis?:History<Cents>;readonly californiaBasis?:History<Cents>}
export interface DistributionAccessResult {readonly federalTaxableCents:Available<Cents>;readonly californiaTaxableCents:Available<Cents>;readonly basisRecoveredCents:Available<Cents>;readonly californiaBasisRecoveredCents:Available<Cents>;readonly taxFreeCents:Available<Cents>;readonly additionalFederalTaxCents:Available<Cents>;readonly additionalCaliforniaTaxCents:Available<Cents>;readonly rmdEligibleCents:Available<Cents>;readonly closingRothHistory?:RetirementRothHistory;readonly qualified:boolean;readonly estimated:boolean;readonly assumptions:readonly string[]}
export function resolveDistributionAccess(input:DistributionAccessInput):Available<DistributionAccessResult>{
 const year=Number(input.date.slice(0,4)),fail=(field:string,text:string)=>missing(input.accountId,year,field,text);
 if(!isValidISODate(input.date)||!Number.isSafeInteger(input.grossCents)||input.grossCents<0||input.grossCents>MAX_CENTS)return fail('distributionDate','Use a valid distribution date and gross cents.');
 if(input.grossCents===0)return av({federalTaxableCents:av(0),californiaTaxableCents:av(0),basisRecoveredCents:av(0),californiaBasisRecoveredCents:av(0),taxFreeCents:av(0),additionalFederalTaxCents:av(0),additionalCaliforniaTaxCents:av(0),rmdEligibleCents:av(0),...(input.rothHistory?{closingRothHistory:input.rothHistory}:{}),qualified:false,estimated:false,assumptions:[]});
 if(input.rules.year!==year)return fail('rules.year','Distribution access requires rules for its calendar year.');
 const rates=input.rules.retirement.distributions;
 if(!input.birthDate.known||!isValidISODate(input.birthDate.value)||input.birthDate.value>input.date)return fail('birthDate','Distribution access requires an entered or explicit estimated date of birth.');
 const ageQualified=input.date>=addMonths(input.birthDate.value,rates.earlyAgeMonths),birthYear=Number(input.birthDate.value.slice(0,4));
 const employer=input.accountKind==='traditional-401k'||input.accountKind==='roth-401k',separated=employer&&input.separationDate?.known&&isValidISODate(input.separationDate.value)&&input.separationDate.value<=input.date&&Number(input.separationDate.value.slice(0,4))>=birthYear+rates.separationCalendarAge;
 const early=!ageQualified&&!separated,gross=input.grossCents,assumptions:string[]=[];
 let federal=input.federalTaxableCents,california=input.californiaTaxableCents,basisRecovered=av(0) as Available<Cents>,caRecovered=basisRecovered,penaltyFed=0,penaltyCa=0,closingRothHistory:RetirementRothHistory|undefined,qualified=false,estimated=false;
 const roth=input.accountKind==='roth-ira'||input.accountKind==='roth-401k';
 if(roth){
  const h=input.rothHistory??{contributionBasis:{known:false},firstContributionYear:{known:false},conversionLayers:[]};
  const guaranteedClock=h.firstKnownContributionYear!==undefined&&year>=h.firstKnownContributionYear+rates.rothQualificationYears;
  qualified=ageQualified&&(h.firstContributionYear.known&&year>=h.firstContributionYear.value+rates.rothQualificationYears||guaranteedClock);
  estimated=!!input.rothHistoryEstimated||!h.contributionBasis.known||!h.firstContributionYear.known;
  if(input.rothHistoryEstimated)assumptions.push('Unanswered additional owner Roth contribution basis assumes zero while known contribution basis is preserved.');
  if(!h.firstContributionYear.known&&!guaranteedClock)assumptions.push('Roth five-year qualification is unconfirmed; no qualified-distribution benefit assumed.');
  if(!h.contributionBasis.known)assumptions.push('No unestablished recoverable Roth contribution basis assumed.');
  if(input.accountKind==='roth-ira'){
   let left=gross;const contribution=h.contributionBasis.known?h.contributionBasis.value:h.estimatedContributionBasisCents??0,regular=Math.min(left,contribution);left-=regular;
   const layers=[...h.conversionLayers].sort((a,b)=>a.year-b.year).map(layer=>({...layer}));
   for(const conversionYear of [...new Set(layers.map(l=>l.year))]){
    if(conversionYear>year)continue;
    const group=layers.filter(l=>l.year===conversionYear),before=left,caTotal=group.reduce((n,l)=>n+(l.californiaTaxableCents??l.taxableCents),0);
    let taxableConsumed=0;
    for(const layer of group){const taken=Math.min(left,layer.taxableCents);left-=taken;layer.taxableCents-=taken;taxableConsumed+=taken;}
    for(const layer of group){const taken=Math.min(left,layer.nontaxableCents);left-=taken;layer.nontaxableCents-=taken;}
    const caConsumed=Math.min(before-left,caTotal);let caRemaining=caTotal-caConsumed;
    for(const layer of group){const amount=Math.min(caRemaining,layer.taxableCents+layer.nontaxableCents);caRemaining-=amount;if(layer.californiaTaxableCents!==undefined||amount!==layer.taxableCents)layer.californiaTaxableCents=amount;}
    if(early&&year<conversionYear+rates.conversionRecaptureYears){penaltyFed+=taxableConsumed;penaltyCa+=caConsumed;}
   }

   federal=av(qualified?0:left);california=federal;basisRecovered=av(gross-left);caRecovered=basisRecovered;
   closingRothHistory={...h,contributionBasis:h.contributionBasis.known?{known:true,value:contribution-regular}:{known:false},...(!h.contributionBasis.known?{estimatedContributionBasisCents:contribution-regular}:{}),conversionLayers:layers};
  }else{
   if(input.accountBalanceCents===undefined||input.accountBalanceCents<gross||input.accountBalanceCents<=0)return fail('accountBalanceCents','Designated-Roth pro-rata recovery requires its distribution-date account value.');
   if(h.conversionLayers.some(l=>l.taxableCents>0||l.nontaxableCents>0))return fail('conversionLayers','Designated-Roth in-plan rollover recapture requires a separately supported layer worksheet.');
   const basis=input.basis?.known?input.basis:h.contributionBasis.known?h.contributionBasis:input.basis??h.contributionBasis,caBasis=input.californiaBasis?.known?input.californiaBasis:basis,proportion=(b:History<Cents>)=>Math.min(gross,settleCents(new Decimal(b.known?b.value:h.estimatedContributionBasisCents??0).times(gross).div(input.accountBalanceCents!)));
   const recovered=proportion(basis),ca=proportion(caBasis);basisRecovered=av(recovered);caRecovered=av(ca);federal=av(qualified?0:gross-recovered);california=av(qualified?0:gross-ca);
   closingRothHistory={...h,contributionBasis:basis.known?{known:true,value:basis.value-recovered}:{known:false},...(!basis.known?{estimatedContributionBasisCents:Math.max(0,(h.estimatedContributionBasisCents??0)-recovered)}:{})};
  }
 }
 const multiply=(amount:Available<Cents>,rate:number,extra:number):Available<Cents>=>!early?av(0):amount.status==='available'?av(settleCents(new Decimal(amount.value).plus(extra).times(rate).div(10000))):amount;
 if(early&&(penaltyFed>0||federal.status==='available'&&federal.value>0)&&!input.separationDate?.known)assumptions.push('No special early-distribution exception assumed.');
 const taxFreeCents=federal.status==='available'?av(gross-federal.value):federal;
 return av({federalTaxableCents:federal,californiaTaxableCents:california,basisRecoveredCents:basisRecovered,californiaBasisRecoveredCents:caRecovered,taxFreeCents,additionalFederalTaxCents:multiply(federal,rates.earlyFederalRateBps,penaltyFed),additionalCaliforniaTaxCents:multiply(california,rates.earlyCaliforniaRateBps,penaltyCa),rmdEligibleCents:av(input.accountKind==='traditional-ira'||input.accountKind==='traditional-401k'?gross:0),...(closingRothHistory?{closingRothHistory}:{}),qualified,estimated:estimated||assumptions.length>0,assumptions});
}
