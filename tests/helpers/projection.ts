import type { AnnualProjection, MonthlyProjection, ProjectionResult } from '../../src/engine/projection-types';

/** Fixture view omits traces only; every agreed numeric field and child balance is compared. */
export function numericProjectionRow(row:MonthlyProjection|AnnualProjection):unknown {
  const selected:Record<string,unknown>={year:row.year};
  if('month' in row){selected.month=row.month;selected.date=row.date;}
  for(const key of ['grossIncomeCents','salaryCents','otherIncomeCents','rentCents','ordinaryExpensesCents','propertyExpensesCents','expensesCents','debtPaymentCents','interestCents','principalPaidCents','federalIncomeTaxCents','californiaIncomeTaxCents','socialSecurityCents','medicareCents','additionalMedicareCents','sdiCents','totalTaxCents','requestedContributionCents','eligibleContributionCents','preventedContributionCents','accountBalanceCents','accountGrowthCents','propertyValueCents','propertyGrowthCents','loanBalanceCents','equityCents','cashFlowCents','reserveCents','netWorthCents'] as const){const v=row[key];selected[key]=v.status==='available'?v:{status:v.status};}
  selected.fundingStatus=row.fundingStatus;
  for(const key of ['accounts','properties','loans'] as const)selected[key]=row[key].map(child=>Object.fromEntries(Object.entries(child).map(([field,value])=>[field,typeof value==='object'&&value!==null&&'status' in value&&value.status!=='available'?{status:value.status}:value])));
  return selected;
}
export function numericProjectionView(result:ProjectionResult,selection?:Readonly<{months:readonly {date:string}[];years:readonly {year:number}[]}>):unknown {
  return {planId:result.planId,inputRevision:result.inputRevision,months:result.months.filter(row=>!selection||selection.months.some(s=>s.date===row.date)).map(numericProjectionRow),years:result.years.filter(row=>!selection||selection.years.some(s=>s.year===row.year)).map(numericProjectionRow)};
}
