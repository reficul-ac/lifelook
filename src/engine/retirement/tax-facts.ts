import type {CashYear} from '../cash/income';
import type {Cents,RentalUnit,TaxBook,ValidatedPlan} from '../model/plan';
import type {Available,Issue} from '../model/results';
import type {HouseholdTaxState} from '../model/tax-state';
import type {PropertyYearFacts} from '../property/facts';
import type {LoanSchedule} from '../property/loans';
import type {YearRules} from '../rules/types';
import type {FixedHouseholdTaxYearInput} from '../tax/comparison';
import {buildResolvedTaxFacts,type PreIraFacts,type ResolvedTaxFacts} from '../tax/facts';
import {buildPreIraFacts,combineAvailableCents,mapAvailableCents,sumCents} from '../tax/modified-income';
import {resolveWorkplaceContributions} from '../tax/workplace';
import {calculatePayroll} from '../tax/payroll';
import {resolveRentalLosses,type RentalLossYear} from '../tax/rental-losses';
import {resolveIraContributions} from '../tax/ira';
import type {DistributionYearResult} from './distributions';
import type {PropertyDispositionTaxFacts} from './property-disposition';
import {prepareRetirementDispositions} from './disposition-losses';
export interface RetirementTaxYearInput {
 readonly plan:ValidatedPlan;readonly cash:CashYear;readonly property:PropertyYearFacts;readonly loans:readonly LoanSchedule[];readonly opening:HouseholdTaxState;readonly rules:YearRules;
 readonly distributions:DistributionYearResult;readonly dispositions?:readonly PropertyDispositionTaxFacts[];readonly disposedRentalUnits?:readonly RentalUnit[];readonly scope:'recurring'|'mandatory-excess'|'transition';
 readonly noFederalSaltBenefitForCaliforniaAdditionalTax:boolean;
 readonly generatedRetirementCoverage?:Readonly<{rmdSatisfiedOwnerIds:readonly string[]}>;
}
export interface ResolvedRetirementTaxYear extends FixedHouseholdTaxYearInput {readonly acceptedDistributions:DistributionYearResult;readonly taxScope:RetirementTaxYearInput['scope'];readonly facts:ResolvedTaxFacts;readonly assumptions:readonly string[];readonly issues:readonly Issue[]}
const av=<T>(value:T):Available<T>=>({status:'available',value});
const books:readonly TaxBook[]=['federal','california','federal-amt','california-amt'];
const fields={federal:'federal',california:'california','federal-amt':'federalAmt','california-amt':'californiaAmt'} as const;
/** Generated income precedes eligibility. Accepted distribution basis is never recomputed here. */
export function buildRetirementTaxFacts(input:RetirementTaxYearInput):ResolvedRetirementTaxYear {
 const {plan,cash,property,rules}=input,workplace=resolveWorkplaceContributions(plan,cash,[],rules),payroll=calculatePayroll(cash,workplace,rules),base=buildPreIraFacts(cash,workplace,property);
 const order={recurring:0,'mandatory-excess':1,transition:2},legs=input.distributions.taxFacts.filter(f=>order[f.purpose]<=order[input.scope]);
 const distributionAmount=(jurisdiction:'federal'|'california',onlyGains=false)=>combineAvailableCents(legs.filter(f=>!onlyGains||f.incomeCharacter==='long-term-gain').map(f=>mapAvailableCents(f[jurisdiction==='federal'?'federalTaxableCents':'californiaTaxableCents'],v=>f.incomeCharacter==='long-term-gain'?Math.max(0,v):v)));
 const disposals=input.scope==='transition'?input.dispositions??[]:[],prepared=prepareRetirementDispositions(disposals,input.opening,cash.year,rules,new Set(property.rentals.map(r=>r.rentalId)),input.disposedRentalUnits??plan.rentals);
 const accepted=input.distributions.closingTaxState,opening:HouseholdTaxState={...prepared.opening,iraBasisByOwner:accepted.iraBasisByOwner,...(accepted.retirementAccountState?{retirementAccountState:accepted.retirementAccountState}:{})};
 const byBook=prepared.income,add=(value:Available<Cents>,book:TaxBook)=>combineAvailableCents([value,distributionAmount(book.startsWith('california')?'california':'federal'),mapIncome(book,'totalCents')]);
 const magiByBook=Object.fromEntries(books.map(book=>[book,combineAvailableCents([add(base.nonRentalFederalAgiCents,book),mapIncome(book,'passiveSignedCents')],v=>sumCents([v[0]!,-v[1]!]))])) as Record<TaxBook,Available<Cents>>;
 function mapIncome(book:TaxBook,key:'totalCents'|'passiveCents'|'passiveSignedCents'|'preferredCents'|'unrecapturedCents'):Available<Cents>{const v=byBook[book];return v.status==='available'?av(v.value[key]):v;}
 const passiveDispositionIncomeByBook=Object.fromEntries(books.map(book=>[book,mapIncome(book,'passiveCents')])) as Record<TaxBook,Available<Cents>>;
 let pre:PreIraFacts={...base,...(byBook.federal.status==='available'?{retirementQbiOrdinaryByRental:byBook.federal.value.qbiOrdinaryByRental}:{}),nonRentalFederalAgiCents:add(base.nonRentalFederalAgiCents,'federal'),nonRentalCaliforniaAgiCents:add(base.nonRentalCaliforniaAgiCents,'california'),nonRentalFederalAmtIncomeCents:add(base.nonRentalFederalAgiCents,'federal-amt'),nonRentalCaliforniaAmtIncomeCents:add(base.nonRentalCaliforniaAgiCents,'california-amt'),niitOtherIncomeCents:combineAvailableCents([base.niitOtherIncomeCents,distributionAmount('federal',true),mapIncome('federal','totalCents')]),rentalFacts:[...property.rentals,...prepared.syntheticRentals],passiveDispositionIncomeByBook,passiveAllowanceMagiByBook:magiByBook};
 let rental=resolveRentalLosses(pre,opening,rules);
 // Full-activity overall loss is nonpassive after offsetting other passive net income (§469g).
 for(const book of books){
  const r=rental[fields[book]],released=prepared.releasedCents[book],income=byBook[book];if(r.status!=='available'||released.status!=='available'||income.status!=='available')continue;
  const otherNet=sumCents(r.value.rentals.filter(r=>!prepared.syntheticRentals.some(s=>s.rentalId===r.rentalId)).map(r=>sumCents([Math.max(0,r.taxableProfitCents),-r.atRisk.releaseCents,-r.passive.openingCents])));
  const overallLoss=Math.max(0,released.value-income.value.passiveSignedCents-Math.max(0,otherNet));
  if(overallLoss>0)magiByBook[book]=mapAvailableCents(magiByBook[book],v=>sumCents([v,-overallLoss]));
 }
 pre={...pre,passiveAllowanceMagiByBook:magiByBook};rental=resolveRentalLosses(pre,opening,rules);
 const withRelease={...rental};
 for(const book of books){const key=fields[book],r=rental[key],release=prepared.releasedCents[book];
  withRelease[key]=r.status==='available'&&release.status==='available'?av({...r.value,allowedRentalCents:sumCents([r.value.allowedRentalCents,-release.value]),rentals:r.value.rentals.map(row=>{const vintages=prepared.releasedVintages[book][row.rentalId]??[],amount=sumCents(vintages.map(v=>v.amountCents));return {...row,allowedRentalCents:sumCents([row.allowedRentalCents,-amount]),releasedLossVintages:[...row.releasedLossVintages,...vintages],passive:{...row.passive,releaseCents:sumCents([row.passive.releaseCents,amount])}};})}):r.status!=='available'?r:release.status!=='available'?release:r;
 }
 rental=withRelease as RentalLossYear;
 const ira=resolveIraContributions(plan,pre,rental,[],workplace,rules),facts=buildResolvedTaxFacts(pre,rental,ira,workplace);
 const preferred=combineAvailableCents([distributionAmount('federal',true),mapIncome('federal','preferredCents')]),amtPreferred=combineAvailableCents([distributionAmount('federal',true),mapIncome('federal-amt','preferredCents')]),U=mapIncome('federal','unrecapturedCents'),amtU=mapIncome('federal-amt','unrecapturedCents');
 const resolved:ResolvedTaxFacts={...facts,...(preferred.status==='available'?{longTermCapitalGainCents:sumCents([base.longTermCapitalGainCents??0,preferred.value])}:{}),...(U.status==='available'?{unrecaptured1250GainCents:U.value}:{}),...(amtPreferred.status==='available'?{federalAmtLongTermCapitalGainCents:sumCents([base.longTermCapitalGainCents??0,amtPreferred.value])}:{}),...(amtU.status==='available'?{federalAmtUnrecaptured1250GainCents:amtU.value}:{})};
 return {...input,acceptedDistributions:input.distributions,taxScope:input.scope,opening,payroll,facts:resolved,additionalFederalTaxCents:combineAvailableCents(legs.map(f=>f.additionalFederalTaxCents)),additionalCaliforniaTaxCents:combineAvailableCents(legs.map(f=>f.additionalCaliforniaTaxCents)),assumptions:[...input.distributions.assumptions,...prepared.assumptions,'Brokerage losses receive no loss-deduction, offset or carryforward benefit.',...(input.noFederalSaltBenefitForCaliforniaAdditionalTax?['No federal SALT benefit modeled for California early-distribution additional tax']:['Federal SALT treatment includes the entered California additional tax estimate.'])],issues:facts.issues};
}
