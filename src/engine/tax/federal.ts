import type { Cents, History, QbiLossVintage, RentalLossVintage } from '../model/plan';
import type { Available, Issue, RuleProvenance } from '../model/results';
import type { HouseholdTaxState } from '../model/tax-state';
import type { ResolvedTaxFacts } from './facts';
import type { DeductionChoice } from './itemized';
import type { YearRules } from '../rules/types';
import { Decimal, settleCents, settleSeries } from '../money';
import { aggregateRuleProvenance, mergeRuleProvenance } from '../rules/projection';
import { standardDeduction, limitFederalItemized } from './itemized';

export interface QbiUnitYear {
  readonly rentalId:string;readonly qualifiedIncomeCents:Cents;readonly incomeAfterLossesCents:Cents;
  readonly wagesCents:History<Cents>;readonly ubiaCents:History<Cents>;
}
export interface QbiYear {
  readonly year:number;readonly qualifiedIncomeCents:Cents;readonly potentialDeductionCents:Cents;
  readonly releasedQualifiedLossCents:Cents;readonly units:readonly QbiUnitYear[];
  readonly closingLossVintagesByRental:Readonly<Record<string,History<readonly QbiLossVintage[]>>>;
  readonly provenance:RuleProvenance;readonly issues:readonly Issue[];readonly explanations:readonly string[];
}
export interface FederalTaxResult {
  readonly year:number;readonly agiCents:Cents;readonly taxableIncomeCents:Cents;readonly taxableIncomeForTaxCents:Cents;
  readonly deductionMethod:'standard'|'itemized';readonly standardDeductionCents:Available<Cents>;
  readonly originalItemizedCents:Cents;readonly allowedItemizedCents:Cents;readonly disallowedItemizedCents:Cents;
  readonly seniorDeductionCents:Cents;readonly qbiDeductionCents:Cents;readonly preSection68TaxableCents:Cents;
  readonly ordinaryTaxCents:Cents;readonly amtIncomeCents:Cents;readonly amtExemptionCents:Cents;
  readonly tentativeMinimumTaxCents:Cents;readonly amtCents:Cents;
  readonly niitIncomeCents:Cents;readonly niitDeductionCents:Cents;readonly niitMagiCents:Cents;readonly niitCents:Cents;
  readonly totalCents:Cents;readonly qbi:QbiYear;readonly closingState:HouseholdTaxState;
  readonly provenance:RuleProvenance;readonly explanations:readonly string[];readonly issues:readonly Issue[];
}
const moneySum=(values:readonly Cents[]):Cents=>settleCents(values.reduce((n,v)=>n.plus(v),new Decimal(0)));
const taxRound=(cents:Decimal|Cents):Cents=>settleCents(new Decimal(cents).div(100).toDecimalPlaces(0,Decimal.ROUND_HALF_UP).mul(100));
function issue(year:number,code:string,field:string,explanation:string,recordId?:string):Issue{return {code,year,field,...(recordId?{recordId}:{}),severity:'warning',explanation,resolution:'Supply the explicitly qualified tax history or eligibility answer; the dependent liability remains unavailable.'};}
function missing<T>(values:readonly Available<unknown>[]):Available<T>|undefined{
  const absent=values.filter(v=>v.status!=='available');
  return absent.length?{status:absent.some(v=>v.status==='unsupported-case')?'unsupported-case':'needs-data',issues:absent.flatMap(v=>v.issues)}:undefined;
}

/** Resolve qualification and QBI loss books independently of the selected deduction method. */
export function resolveRentalQbi(facts:ResolvedTaxFacts,opening:HouseholdTaxState,rules:YearRules):Available<QbiYear>{
  if(facts.rental.federal.status!=='available')return facts.rental.federal;
  const issues:Issue[]=[];
  const rows:QbiUnitYear[]=[];
  const pool:{rentalId:string;year:number;amountCents:Cents}[]=[];
  const closing:Record<string,History<readonly QbiLossVintage[]>>={...opening.qbiLossVintages};
  let released=new Decimal(0);
  for(const rental of [...facts.preIra.rentalFacts].sort((a,b)=>a.rentalId.localeCompare(b.rentalId))){
    const q=rental.unit.qbi;
    if(!q.qualification.known){issues.push(issue(facts.year,'required-qbi-qualification','qbi.qualification','Rental QBI eligibility must be explicitly established.',rental.rentalId));continue;}
    const old=opening.qbiLossVintages[rental.rentalId];
    if(!old?.known){issues.push(issue(facts.year,'required-qbi-loss-history','qbi.openingLossVintages','The carried opening qualified business loss vintages are missing or unknown; declared original plan history cannot replace a later carried state.',rental.rentalId));continue;}
    pool.push(...old.value.map(v=>({...v,rentalId:rental.rentalId})));
    const book=facts.rental.federal.value.rentals.find(r=>r.rentalId===rental.rentalId);
    if(!book){issues.push(issue(facts.year,'required-qbi-rental-book','rental.federal','The resolved annual rental book is missing.',rental.rentalId));continue;}
    let qualifiedLoss=new Decimal(0);
    for(const vintage of book.releasedLossVintages){
      if(vintage.year<2018)continue;
      const origin=(vintage as RentalLossVintage & {readonly qbiQualification?:History<boolean>}).qbiQualification;
      if(!origin?.known){issues.push(issue(facts.year,'required-qbi-loss-origin','lossVintages.qbiQualification','A released post2017 loss lacks QBI qualification at its year of origin.',rental.rentalId));continue;}
      if(origin.value)qualifiedLoss=qualifiedLoss.plus(vintage.amountCents);
    }
    const income=new Decimal(q.qualification.value?Math.max(0,book.taxableProfitCents):0).minus(qualifiedLoss);
    released=released.plus(qualifiedLoss);
    if(income.lt(0))pool.push({rentalId:rental.rentalId,year:facts.year,amountCents:settleCents(income.negated())});
    rows.push({rentalId:rental.rentalId,qualifiedIncomeCents:settleCents(income),incomeAfterLossesCents:Math.max(0,settleCents(income)),wagesCents:q.wagesCents,ubiaCents:q.ubiaCents});
  }
  if(issues.length)return {status:'needs-data',issues};
  const positive=moneySum(rows.map(r=>Math.max(0,r.qualifiedIncomeCents)));
  let consume=Math.min(positive,moneySum(pool.map(v=>v.amountCents)));
  const used=consume;
  const remaining:{rentalId:string;year:number;amountCents:Cents}[]=[];
  for(const vintage of pool.sort((a,b)=>a.year-b.year||a.rentalId.localeCompare(b.rentalId))){
    const taken=Math.min(consume,vintage.amountCents);consume-=taken;
    if(taken<vintage.amountCents)remaining.push({...vintage,amountCents:vintage.amountCents-taken});
  }
  const offset=settleSeries(rows.map(r=>positive?new Decimal(used).mul(Math.max(0,r.qualifiedIncomeCents)).div(positive):new Decimal(0)));
  const after=rows.map((r,i)=>({...r,incomeAfterLossesCents:Math.max(0,r.incomeAfterLossesCents-offset[i]!)}));
  for(const rental of facts.preIra.rentalFacts){
    const grouped=new Map<number,Cents>();
    for(const v of remaining.filter(v=>v.rentalId===rental.rentalId))grouped.set(v.year,moneySum([grouped.get(v.year)??0,v.amountCents]));
    closing[rental.rentalId]={known:true,value:[...grouped].sort((a,b)=>a[0]-b[0]).map(([year,amountCents])=>({year,amountCents}))};
  }
  const qualifiedIncomeCents=moneySum(after.map(r=>r.incomeAfterLossesCents));
  return {status:'available',value:{year:facts.year,qualifiedIncomeCents,potentialDeductionCents:settleCents(new Decimal(qualifiedIncomeCents).mul(rules.federal.qbi.deductionBps).div(10000)),releasedQualifiedLossCents:settleCents(released),units:after,closingLossVintagesByRental:closing,provenance:aggregateRuleProvenance(rules,['federal.qbi.deductionBps']),issues:[],explanations:['Qualified post2017 loss releases enter QBI only when allowed for taxable income; pre2018 losses are excluded.','Opening QBI loss vintages and current qualified negative income offset household positive qualified income FIFO.','Potential deduction precedes the selected-candidate taxable-income, wage/UBIA and section68 calculations; passive rentals receive no active-business minimum.']}};
}

function ordinaryTax(taxable:Cents,rules:YearRules):{taxCents:Cents;usedTable:boolean}{
  const taxableForTax=taxRound(Math.max(0,taxable));
  let amount=new Decimal(taxableForTax);
  const table=rules.federal.taxTable;
  const usedTable=taxableForTax>0&&taxableForTax<table.maximumExclusiveCents;
  if(usedTable){
    let lower=0;
    const upper=table.initialUpperCents.find(bound=>taxableForTax<bound);
    if(upper!==undefined){for(const bound of table.initialUpperCents){if(bound===upper)break;lower=bound;}amount=new Decimal(lower).plus(upper).div(2);}
    else {const width=taxableForTax<table.narrowBinsThroughCents?table.narrowBinWidthCents:table.wideBinWidthCents;amount=new Decimal(Math.floor(taxableForTax/width)*width).plus(new Decimal(width).div(2));}
  }
  let lower=new Decimal(0),tax=new Decimal(0);
  for(const bracket of rules.federal.brackets){
    const upper=bracket.upperCents===null?amount:Decimal.min(amount,bracket.upperCents);
    tax=tax.plus(Decimal.max(0,upper.minus(lower)).mul(bracket.rateBps).div(10000));
    if(bracket.upperCents===null||amount.lte(bracket.upperCents))break;
    lower=new Decimal(bracket.upperCents);
  }
  return {taxCents:taxRound(tax),usedTable};
}

/** Ordinary long-term gains use the remaining 0%/15% bands above regular ordinary income. */
function capitalGainTax(gain:Decimal,ordinaryIncome:Decimal,rules:YearRules):Decimal{
  const r=rules.federal.capitalGains;
  const zero=Decimal.min(gain,Decimal.max(0,new Decimal(r.zeroRateMaximumCents).minus(ordinaryIncome)));
  const middle=Decimal.min(gain.minus(zero),Decimal.max(0,new Decimal(r.fifteenRateMaximumCents).minus(Decimal.max(ordinaryIncome,r.zeroRateMaximumCents))));
  return middle.mul(r.middleRateBps).plus(gain.minus(zero).minus(middle).mul(r.upperRateBps)).div(10000);
}

function regularTax(taxable:Cents,gain:Cents,rules:YearRules):{taxCents:Cents;usedTable:boolean}{
  const allOrdinary=ordinaryTax(taxable,rules);
  if(gain===0)return allOrdinary;
  const income=new Decimal(taxRound(taxable));
  const taxableGain=Decimal.min(income,taxRound(gain));
  const ordinaryIncome=income.minus(taxableGain);
  const ordinary=ordinaryTax(settleCents(ordinaryIncome),rules);
  const preferential=taxRound(new Decimal(ordinary.taxCents).plus(capitalGainTax(taxableGain,ordinaryIncome,rules)));
  // The capital-gain worksheet may never exceed tax on all income at ordinary rates.
  return {taxCents:Math.min(allOrdinary.taxCents,preferential),usedTable:ordinary.usedTable||allOrdinary.usedTable};
}

export function calculateFederalTax(facts:ResolvedTaxFacts,deductions:DeductionChoice,opening:HouseholdTaxState,rules:YearRules):Available<FederalTaxResult>{
  const mtc=opening.minimumTaxCreditCoverage.federal;
  if(!mtc.known)return {status:'needs-data',issues:[issue(facts.year,'required-minimum-tax-credit-history','minimumTaxCreditCoverage.federal','Federal prior minimum-tax-credit coverage is unknown.')]};
  if(mtc.value)return {status:'unsupported-case',issues:[issue(facts.year,'unsupported-minimum-tax-credit','minimumTaxCreditCoverage.federal','Existing federal minimum-tax-credit circumstances require additional credit calculations outside modeled coverage.')]};
  const required=missing<FederalTaxResult>([facts.federalAgiCents,facts.federalAmtIncomeCents,facts.niitMagiCents,facts.niitOtherIncomeCents,facts.rental.federal]);
  if(required)return required;
  if(facts.federalAgiCents.status!=='available'||facts.federalAmtIncomeCents.status!=='available'||facts.niitMagiCents.status!=='available'||facts.niitOtherIncomeCents.status!=='available'||facts.rental.federal.status!=='available')throw new Error('Unreachable federal facts');
  const standard=standardDeduction(facts.filers,facts.year,'federal',rules);
  if(deductions.method==='standard'&&standard.status!=='available')return standard;
  const rawItemized=deductions.method==='itemized'?deductions.allowedItemizedCents:0;
  if(deductions.method==='itemized'&&!deductions.detail)return {status:'needs-data',issues:[issue(facts.year,'required-itemized-detail','deductions.detail','Itemization requires detailed qualifying tax/mortgage and NIIT allocation facts.')]};
  const selected=deductions.method==='standard'&&standard.status==='available'?standard.value:rawItemized;
  const ageIssues:Issue[]=[];
  let seniors=0;
  const sr=rules.federal.seniorDeduction;
  const perSenior=Decimal.max(0,new Decimal(sr.perFilerCents).minus(Decimal.max(0,new Decimal(facts.federalAgiCents.value).minus(sr.phaseoutStartCents)).mul(sr.reductionBps).div(10000)));
  if(perSenior.gt(0))for(const filer of facts.filers){
    if(!filer.birthDate.known){ageIssues.push(issue(facts.year,'required-senior-age','birthDate','The temporary senior deduction requires a known age.',filer.id));continue;}
    const cutoff=`${String(facts.year-sr.minimumAge+1).padStart(4,'0')}-01-01`;
    if(filer.birthDate.value>cutoff)continue;
    const ssn=(filer as typeof filer&{readonly seniorDeductionSsnEligible?:History<boolean>}).seniorDeductionSsnEligible;
    if(!ssn?.known)ageIssues.push(issue(facts.year,'required-senior-ssn-eligibility','seniorDeductionSsnEligible','This eligible-age filer must confirm a qualifying SSN to receive the temporary senior bonus.',filer.id));
    else if(ssn.value)seniors++;
  }
  if(ageIssues.length)return {status:'needs-data',issues:ageIssues};
  const senior=settleCents(perSenior.mul(seniors));
  const qbi=resolveRentalQbi(facts,opening,rules);
  if(qbi.status!=='available')return qbi;
  const beforeQbi=Decimal.max(0,new Decimal(facts.federalAgiCents.value).minus(selected).minus(senior));
  const qr=rules.federal.qbi;
  const phase=Decimal.min(1,Decimal.max(0,beforeQbi.minus(qr.phaseoutStartCents).div(new Decimal(qr.phaseoutEndCents).minus(qr.phaseoutStartCents))));
  let businessDeduction=new Decimal(0);
  const qbiIssues:Issue[]=[];
  for(const unit of qbi.value.units){
    const potential=new Decimal(unit.incomeAfterLossesCents).mul(qr.deductionBps).div(10000);
    if(potential.eq(0)||phase.eq(0)){businessDeduction=businessDeduction.plus(potential);continue;}
    if(!unit.wagesCents.known||!unit.ubiaCents.known){qbiIssues.push(issue(facts.year,'required-qbi-wage-ubia','qbi.wagesCents','The selected taxable-income range requires known rental W2 wages and qualified property UBIA.',unit.rentalId));continue;}
    const wageLimit=Decimal.max(new Decimal(unit.wagesCents.value).mul(qr.wageOnlyLimitBps).div(10000),new Decimal(unit.wagesCents.value).mul(qr.wageMixedLimitBps).plus(new Decimal(unit.ubiaCents.value).mul(qr.ubiaLimitBps)).div(10000));
    const reduction=Decimal.max(0,potential.minus(wageLimit)).mul(phase);
    businessDeduction=businessDeduction.plus(potential.minus(reduction));
  }
  if(qbiIssues.length)return {status:'needs-data',issues:qbiIssues};
  const longTermCapitalGain=Math.max(0,facts.longTermCapitalGainCents??0);
  const qbiDeduction=settleCents(Decimal.min(businessDeduction,Decimal.max(0,beforeQbi.minus(longTermCapitalGain)).mul(qr.deductionBps).div(10000)));
  const preSection68=settleCents(Decimal.max(0,beforeQbi.minus(qbiDeduction)));
  const allowedItemized=deductions.method==='itemized'?limitFederalItemized(rawItemized,preSection68,rules):0;
  const taxable=settleCents(new Decimal(preSection68).plus(rawItemized-allowedItemized));
  const ordinary=regularTax(taxable,longTermCapitalGain,rules);
  const ar=rules.federal.amt;
  const amtRawDeduction=deductions.method==='itemized'?deductions.detail!.amtAllowedCents:0;
  const amtSenior=ar.seniorDeductionAllowed?senior:0;
  const amtBeforeRestriction=settleCents(Decimal.max(0,new Decimal(facts.federalAmtIncomeCents.value).minus(amtSenior).minus(qbiDeduction).minus(amtRawDeduction)));
  const amtAllowedDeduction=ar.itemizedRestrictionApplies?limitFederalItemized(amtRawDeduction,amtBeforeRestriction,rules):amtRawDeduction;
  const amtIncome=settleCents(Decimal.max(0,new Decimal(facts.federalAmtIncomeCents.value).minus(amtSenior).minus(qbiDeduction).minus(amtAllowedDeduction)));
  const exemption=settleCents(Decimal.max(0,new Decimal(ar.exemptionCents).minus(Decimal.max(0,new Decimal(amtIncome).minus(ar.phaseoutStartCents)).mul(ar.phaseoutBps).div(10000))));
  const amtBase=Decimal.max(0,new Decimal(amtIncome).minus(exemption));
  const amtRateTax=(amount:Decimal):Decimal=>Decimal.min(amount,ar.rateSplitCents).mul(ar.lowerRateBps).plus(Decimal.max(0,amount.minus(ar.rateSplitCents)).mul(ar.upperRateBps)).div(10000);
  let tentative=taxRound(amtRateTax(amtBase));
  if(longTermCapitalGain>0){
    const amtForTax=new Decimal(taxRound(settleCents(amtBase)));
    const amtGain=Decimal.min(amtForTax,taxRound(longTermCapitalGain));
    const regularOrdinary=Decimal.max(0,new Decimal(taxRound(taxable)).minus(taxRound(longTermCapitalGain)));
    // Form6251 PartIII: exemption limits taxable AMT gain; REGULAR ordinary income sets gain-band capacity.
    tentative=taxRound(Decimal.min(amtRateTax(amtForTax),amtRateTax(amtForTax.minus(amtGain)).plus(capitalGainTax(amtGain,regularOrdinary,rules))));
  }
  const amt=Math.max(0,tentative-ordinary.taxCents);
  const niiBefore=Decimal.max(0,new Decimal(facts.niitOtherIncomeCents.value).plus(facts.rental.federal.value.allowedRentalCents));
  let niitDeduction=0;
  if(deductions.method==='itemized'){
    const allocation=deductions.detail!.niitDeductionCents;
    if(allocation.status!=='available')return allocation;
    niitDeduction=rawItemized?settleCents(new Decimal(allocation.value).mul(allowedItemized).div(rawItemized)):0;
  }
  const nii=settleCents(Decimal.max(0,niiBefore.minus(niitDeduction)));
  const niit=taxRound(Decimal.min(nii,Decimal.max(0,new Decimal(facts.niitMagiCents.value).minus(rules.federal.niit.thresholdCents))).mul(rules.federal.niit.rateBps).div(10000));
  const deferral=amt>0&&facts.federalAmtIncomeCents.value!==facts.federalAgiCents.value;
  const closingState:HouseholdTaxState={...facts.rental.closing,year:facts.year,qbiLossVintages:qbi.value.closingLossVintagesByRental,iraBasisByOwner:facts.ira.closingIraBasisByOwner,minimumTaxCreditCoverage:{...opening.minimumTaxCreditCoverage,federal:deferral?{known:true,value:true}:opening.minimumTaxCreditCoverage.federal}};
  const paths=['federal.seniorDeduction.perFilerCents','federal.seniorDeduction.minimumAge','federal.seniorDeduction.phaseoutStartCents','federal.seniorDeduction.reductionBps','federal.niit.thresholdCents','federal.niit.rateBps',...Object.keys(rules.provenance).filter(p=>p.startsWith('federal.amt.')||p.startsWith('federal.brackets.'))];
  if(deductions.method==='standard')paths.push('federal.standardDeductionCents','federal.additionalStandardDeductionPerFilerCents','federal.ageDeductionMinimumAge');
  else paths.push('federal.itemized.restrictionNumerator','federal.itemized.restrictionDenominator','federal.itemized.thresholdCents',...Object.keys(rules.provenance).filter(p=>p.startsWith('federal.salt.')||p.startsWith('federal.mortgage.')));
  if(ordinary.usedTable)paths.push(...Object.keys(rules.provenance).filter(p=>p.startsWith('federal.taxTable.')));
  if(longTermCapitalGain>0)paths.push(...Object.keys(rules.provenance).filter(p=>p.startsWith('federal.capitalGains.')));
  if(qbi.value.units.some(u=>u.qualifiedIncomeCents!==0))paths.push('federal.qbi.deductionBps','federal.qbi.phaseoutStartCents','federal.qbi.phaseoutEndCents','federal.qbi.wageOnlyLimitBps','federal.qbi.wageMixedLimitBps','federal.qbi.ubiaLimitBps');
  const provenance=mergeRuleProvenance(rules,[aggregateRuleProvenance(rules,paths),qbi.value.provenance,...(deductions.method==='itemized'&&deductions.detail?[deductions.detail.provenance]:[])]);
  return {status:'available',value:{year:facts.year,agiCents:facts.federalAgiCents.value,taxableIncomeCents:taxable,taxableIncomeForTaxCents:taxRound(taxable),deductionMethod:deductions.method,standardDeductionCents:standard,originalItemizedCents:deductions.detail?.originalCents??rawItemized,allowedItemizedCents:allowedItemized,disallowedItemizedCents:deductions.method==='itemized'?moneySum([deductions.detail?.disallowedCents??0,rawItemized-allowedItemized]):0,seniorDeductionCents:senior,qbiDeductionCents:qbiDeduction,preSection68TaxableCents:preSection68,ordinaryTaxCents:ordinary.taxCents,amtIncomeCents:amtIncome,amtExemptionCents:exemption,tentativeMinimumTaxCents:tentative,amtCents:amt,niitIncomeCents:nii,niitDeductionCents:niitDeduction,niitMagiCents:facts.niitMagiCents.value,niitCents:niit,totalCents:moneySum([ordinary.taxCents,amt,niit]),qbi:qbi.value,closingState,provenance,explanations:[`Selected ${deductions.method} deduction ${selected} cents before section68; senior deduction ${senior} cents.`,`QBI taxable income before QBI and section68 ${settleCents(beforeQbi)} cents; QBI deduction ${qbiDeduction} cents.`,`Section68 taxable income before restriction ${preSection68} cents; allowed itemized ${allowedItemized} cents.`,`Ordinary liability uses ${ordinary.usedTable?'provisional official-table bin method':'published marginal rate schedule'} with separate whole-dollar tax rounding.`,`AMT uses its independent income/book, adds back the senior deduction, and disapplies section68; increment ${amt} cents.`,`NIIT excludes wages and QBI deductions; allowed investment tax allocation ${niitDeduction} cents.`,...(longTermCapitalGain>0?[`Regular tax includes ${longTermCapitalGain} cents of ordinary long-term gains stacked above ordinary taxable income at 0%, 15% and 20%; AMT applies the separate Form6251 capital-gain worksheet.`,`QBI taxable-income cap excludes net capital gain. Generated-sale losses receive no deduction, gain offset or carryforward benefit.`]:[]),...(deferral?['Deferral AMT creates a future minimum-tax-credit coverage boundary; later total liability requires that separate credit model.']:[])],issues:[]}};
}
