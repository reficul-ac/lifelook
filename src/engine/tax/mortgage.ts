import type { Cents } from '../model/plan';
import type { Available, Issue, RuleProvenance } from '../model/results';
import type { PropertyYearFacts } from '../property/facts';
import type { LoanSchedule } from '../property/loans';
import type { YearRules } from '../rules/types';
import { Decimal, settleCents } from '../money';
import { aggregateRuleProvenance } from '../rules/projection';
export interface MortgageLoanDeduction {
  readonly loanId: string;
  readonly paidInterestCents: Cents;
  readonly averageQualifiedDebtCents: Cents;
  readonly acquisitionDate: string;
  readonly averageMethod: 'first-last-balance';
}
export interface MortgageDeduction {
  readonly jurisdiction: 'federal'|'california';
  readonly paidInterestCents: Cents;
  readonly qualifiedInterestCents: Cents;
  readonly allowedInterestCents: Cents;
  readonly disallowedInterestCents: Cents;
  readonly averageQualifiedDebtCents: Cents;
  readonly applicableLimitCents: Cents;
  readonly loans: readonly MortgageLoanDeduction[];
  readonly provenance: RuleProvenance;
  readonly issues: readonly Issue[];
}
export interface MortgageDeductions { readonly federal:Available<MortgageDeduction>; readonly california:Available<MortgageDeduction> }
export function calculateMortgageDeduction(facts:PropertyYearFacts,loans:readonly LoanSchedule[],jurisdiction:'federal'|'california',rules:YearRules):Available<MortgageDeduction>{
  const issues:Issue[]=[];
  const unavailable:Issue[]=[];
  const rows:MortgageLoanDeduction[]=[];
  const assumptions:string[]=[];
  let paid=new Decimal(0), qualified=new Decimal(0), pre=new Decimal(0), post=new Decimal(0);
  let unsupported=false;
  const problem=(loanId:string,code:string,explanation:string):Issue=>({code,recordId:loanId,year:facts.year,field:'proceedsQualification',severity:'warning',explanation,resolution:'Supply complete acquisition/proceeds/collateral history and a supported loan schedule; special mixed/grandfathered debt needs its own supported tax schedule.'});
  for(const l of [...facts.personal.loans].sort((a,b)=>a.loanId.localeCompare(b.loanId))){
    if(l.personalInterestCents.status!=='available'){unavailable.push(...l.personalInterestCents.issues);unsupported ||= l.personalInterestCents.status==='unsupported-case';continue;}
    paid=paid.plus(l.personalInterestCents.value);
    if(l.personalInterestCents.value===0)continue;
    const q=l.qualification;
    const loan=loans.find(s=>s.loanId===l.loanId);
    if(!q || !loan || !q.proceedsQualification.qualifiedAcquisitionDebt.known || !q.proceedsQualification.historyComplete.known || !q.proceedsQualification.qualifiedPrincipalCents.known){unavailable.push(problem(l.loanId,'required-mortgage-history','The personal interest deduction lacks confirmed mortgage qualification history.'));continue;}
    if(!q.proceedsQualification.qualifiedAcquisitionDebt.value){issues.push(problem(l.loanId,'unqualified-mortgage-interest','The declared debt does not qualify as acquisition debt.'));continue;}
    if(!q.proceedsQualification.historyComplete.value || ['mixed','cash-out','grandfathered','unknown'].includes(q.proceedsQualification.kind) || q.proceedsQualification.qualifiedPrincipalCents.value!==q.originalPrincipalCents || q.collateralPropertyId!==l.propertyId){unavailable.push(problem(l.loanId,'unsupported-mortgage-history','This mortgage needs unsupported debt tracing or category-specific repayment evidence.'));unsupported=true;continue;}
    const balance=loan.averageBalanceEvidence.find(e=>e.year===facts.year);
    if(!balance){unavailable.push({...problem(l.loanId,'required-mortgage-average-balance','The qualified debt average needs first and last balances from a supported loan schedule for this year.'),field:'openingBalance'});continue;}
    const yearMonths=loan.months.filter(m=>Number(m.date.slice(0,4))===facts.year);
    if(yearMonths.some(m=>m.principalPaidCents<0)){unavailable.push(problem(l.loanId,'unsupported-capitalized-mortgage-interest','Unpaid capitalized interest needs a separate traced qualification schedule.'));unsupported=true;continue;}
    const allocations=q.proceedsAllocations.filter(a=>a.propertyId===l.propertyId&&a.use==='personal');
    if(!allocations.length){unavailable.push(problem(l.loanId,'required-personal-proceeds-allocation','Floor area and paid interest alone do not establish the acquisition-debt principal allocation.'));continue;}
    const share=allocations.reduce((sum,a)=>sum.plus(new Decimal(a.share.numerator).div(a.share.denominator)),new Decimal(0));
    const average=new Decimal(balance.openingPrincipalCents).plus(balance.closingPrincipalCents).div(2).mul(share);
    settleCents(average);
    if(loan.openingProvenance==='estimated'||loan.paymentProvenance==='estimated'){
      const assumption='Mortgage interest and average qualified debt are forecast estimates based on the loan schedule; actual balances or payments may differ.';
      assumptions.push(assumption);
      issues.push({code:'estimated-mortgage-deduction',recordId:l.loanId,year:facts.year,field:loan.openingProvenance==='estimated'?'openingBalance':'openingPayment',severity:'info',explanation:assumption,resolution:'Enter confirmed opening balances and payments to refine the forecast.'});
    }
    if(q.acquisitionDate<=rules.federal.mortgage.cutoffDate)pre=pre.plus(average);else post=post.plus(average);
    qualified=qualified.plus(l.personalInterestCents.value);
    rows.push({loanId:l.loanId,paidInterestCents:l.personalInterestCents.value,averageQualifiedDebtCents:settleCents(average),acquisitionDate:q.acquisitionDate,averageMethod:'first-last-balance'});
  }
  if(unavailable.length)return {status:unsupported?'unsupported-case':'needs-data',issues:unavailable};
  const debt=pre.plus(post);
  const cap=jurisdiction==='california'?new Decimal(rules.california.mortgage.acquisitionLimitCents):Decimal.max(pre.gt(0)?rules.federal.mortgage.pre2017LimitCents:0,rules.federal.mortgage.post2017LimitCents);
  const limit=jurisdiction==='california'?cap:Decimal.max(Decimal.min(pre,rules.federal.mortgage.pre2017LimitCents),rules.federal.mortgage.post2017LimitCents);
  // Publication936 Table1 applies one household ratio to all eligible personal mortgage interest.
  const allowed=debt.eq(0)?new Decimal(0):qualified.mul(Decimal.min(1,limit.div(debt)));
  const allowedCents=settleCents(allowed);
  const ruleProvenance=aggregateRuleProvenance(rules,jurisdiction==='federal'?['federal.mortgage.pre2017LimitCents','federal.mortgage.post2017LimitCents','federal.mortgage.cutoffDate']:['california.mortgage.acquisitionLimitCents']);
  const provenance={...ruleProvenance,assumptions:[...new Set([...ruleProvenance.assumptions,...assumptions])]};
  return {status:'available',value:{jurisdiction,paidInterestCents:settleCents(paid),qualifiedInterestCents:settleCents(qualified),allowedInterestCents:allowedCents,disallowedInterestCents:settleCents(paid.minus(allowedCents)),averageQualifiedDebtCents:settleCents(debt),applicableLimitCents:settleCents(limit),loans:rows,provenance,issues}};
}
