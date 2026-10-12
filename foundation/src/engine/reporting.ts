import type { Cents } from './model/plan';
import type { Available,Issue } from './model/results';
import type { HouseholdYear } from './tax/comparison';
import type { AccountProjection,AnnualProjection,LoanProjection,MonthlyProjection,MonetaryField,ProjectionMetadata,PropertyProjection } from './projection-types';
import { balanceFields,flowFields } from './projection-types';
import { CalculationRangeError,Decimal,settleCents } from './money';

const deduplicate=(issues:readonly Issue[]):readonly Issue[]=>[...new Map(issues.map(issue=>[JSON.stringify(issue),issue])).values()];

export function summarizeYear(months:readonly MonthlyProjection[],household:HouseholdYear):AnnualProjection {
  return summarize(months,{tax:household.tax,household:{status:'available',value:household},candidates:household.candidates,coverage:household.coverage,issues:household.issues});
}
/** Summarizes independent movements even when annual household tax is unavailable. */
export function summarizeProjectionYear(months:readonly MonthlyProjection[]):AnnualProjection {
  return summarize(months);
}

function summarize(months:readonly MonthlyProjection[],override?:Omit<ProjectionMetadata,'provenance'>):AnnualProjection {
  const ordered=[...months].sort((a,b)=>a.month-b.month);
  const first=ordered[0],last=ordered[ordered.length-1];
  if(!first||!last)throw new RangeError('An annual report requires at least one monthly projection.');
  const year=first.year;
  if(ordered.some(month=>month.year!==year))throw new RangeError('An annual report cannot combine different calendar years.');
  const issues:Issue[]=[...ordered.flatMap(month=>month.issues),...(override?.issues??[])];
  const generated:Issue[]=[];
  function track<T>(value:Available<T>):Available<T>{if(value.status!=='available')issues.push(...value.issues);return value;}
  function unavailable<T>(values:readonly Available<unknown>[]):Available<T>|undefined{
    const absent=values.filter(value=>value.status!=='available');
    return absent.length?track({status:absent.some(value=>value.status==='unsupported-case')?'unsupported-case':'needs-data',issues:deduplicate(absent.flatMap(value=>value.issues))}):undefined;
  }
  function sum(values:readonly Available<Cents>[],field:string):Available<Cents>{
    const absent=unavailable<Cents>(values);if(absent)return absent;
    try{return {status:'available',value:settleCents(values.reduce((total,value)=>total.plus(value.status==='available'?value.value:0),new Decimal(0)))};}
    catch(error){
      if(!(error instanceof CalculationRangeError))throw error;
      const issue:Issue={code:'monetary-overflow',year,field,severity:'error',explanation:`The annual ${field} exceeds the supported monetary range.`,resolution:'Reduce the amount or growth assumption before using this affected annual total.'};
      generated.push(issue);return track({status:'unsupported-case',issues:[issue]});
    }
  }
  function absentRecord(field:string):Available<Cents>{
    const issue:Issue={code:'required-monthly-record',year,field,severity:'warning',explanation:'A monthly asset or loan movement required for this annual record is missing.',resolution:'Resolve the missing monthly schedule before using this affected annual amount.'};
    generated.push(issue);return track({status:'needs-data',issues:[issue]});
  }
  const amounts={} as Record<MonetaryField,Available<Cents>>;
  for(const field of flowFields)amounts[field]=sum(ordered.map(month=>month[field]),field);
  for(const field of balanceFields)amounts[field]=track(last[field]);

  const accountIds=[...new Set(ordered.flatMap(month=>month.accounts.map(account=>account.accountId)))].sort();
  const accounts:AccountProjection[]=accountIds.map(accountId=>{
    const series=ordered.map(month=>month.accounts.find(account=>account.accountId===accountId));
    const value=(index:number,key:Exclude<keyof AccountProjection,'accountId'>)=>track(series[index]?.[key]??absentRecord(`accounts.${accountId}.${key}`));
    return {accountId,openingCents:value(0,'openingCents'),contributionCents:sum(series.map((_,i)=>value(i,'contributionCents')),`accounts.${accountId}.contributionCents`),growthCents:sum(series.map((_,i)=>value(i,'growthCents')),`accounts.${accountId}.growthCents`),closingCents:value(series.length-1,'closingCents')};
  });
  const propertyIds=[...new Set(ordered.flatMap(month=>month.properties.map(property=>property.propertyId)))].sort();
  const properties:PropertyProjection[]=propertyIds.map(propertyId=>{
    const series=ordered.map(month=>month.properties.find(property=>property.propertyId===propertyId));
    const value=(index:number,key:Exclude<keyof PropertyProjection,'propertyId'>)=>track(series[index]?.[key]??absentRecord(`properties.${propertyId}.${key}`));
    return {propertyId,openingValueCents:value(0,'openingValueCents'),growthCents:sum(series.map((_,i)=>value(i,'growthCents')),`properties.${propertyId}.growthCents`),closingValueCents:value(series.length-1,'closingValueCents'),loanBalanceCents:value(series.length-1,'loanBalanceCents'),equityCents:value(series.length-1,'equityCents')};
  });
  const loanIds=[...new Set(ordered.flatMap(month=>month.loans.map(loan=>loan.loanId)))].sort();
  const loans:LoanProjection[]=loanIds.map(loanId=>{
    const series=ordered.map(month=>month.loans.find(loan=>loan.loanId===loanId));
    const value=(index:number,key:Exclude<keyof LoanProjection,'loanId'>)=>track(series[index]?.[key]??absentRecord(`loans.${loanId}.${key}`));
    return {loanId,openingPrincipalCents:value(0,'openingPrincipalCents'),interestCents:sum(series.map((_,i)=>value(i,'interestCents')),`loans.${loanId}.interestCents`),paymentCents:sum(series.map((_,i)=>value(i,'paymentCents')),`loans.${loanId}.paymentCents`),principalPaidCents:sum(series.map((_,i)=>value(i,'principalPaidCents')),`loans.${loanId}.principalPaidCents`),closingPrincipalCents:value(series.length-1,'closingPrincipalCents')};
  });
  function ratio(numerator:Available<Cents>,field:string):Available<number>{
    const denominator=amounts.grossIncomeCents;
    const absent=unavailable<number>([numerator,denominator]);if(absent)return absent;
    if(numerator.status!=='available'||denominator.status!=='available')throw new Error('Unreachable annual ratio inputs');
    if(denominator.value===0){
      const issue:Issue={code:'undefined-income-ratio',year,field,severity:'info',explanation:'This ratio is unavailable because annual gross income is zero.',resolution:'Review the dollar amounts; a ratio can be calculated when annual gross income is nonzero.'};
      generated.push(issue);return track({status:'needs-data',issues:[issue]});
    }
    return {status:'available',value:new Decimal(numerator.value).div(denominator.value).toNumber()};
  }
  const ratios={expenseRatio:ratio(amounts.expensesCents,'ratios.expenseRatio'),taxRatio:ratio(amounts.totalTaxCents,'ratios.taxRatio'),contributionRatio:ratio(amounts.eligibleContributionCents,'ratios.contributionRatio'),cashFlowMargin:ratio(amounts.cashFlowCents,'ratios.cashFlowMargin')};
  const metadata=override??first;
  const affected=generated.some(issue=>issue.severity!=='info');
  const coverage=affected?{...metadata.coverage,completeForModeledScope:false,completeHouseholdLiability:false,issues:deduplicate([...metadata.coverage.issues,...generated.filter(issue=>issue.severity!=='info')])}:metadata.coverage;
  const conditionalOnGap=ordered.some(month=>month.conditionalOnGap);
  const fundingStatus=last.fundingStatus==='funded'&&conditionalOnGap?'conditional-on-gap':last.fundingStatus;
  return {...amounts,year,fundingStatus,conditionalOnGap,accounts,properties,loans,ratios,tax:metadata.tax,household:metadata.household,candidates:metadata.candidates,coverage,provenance:first.provenance,issues:deduplicate(issues)};
}
