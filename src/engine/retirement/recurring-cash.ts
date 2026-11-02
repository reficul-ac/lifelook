import type {Cents,ValidatedPlan} from '../model/plan';
import type {Available} from '../model/results';
import type {CashYear} from '../cash/income';
import type {PropertyYearFacts} from '../property/facts';
import type {LoanSchedule} from '../property/loans';
import type {AduYear} from '../property/adu-lifecycle';
import type {MonthlyProjection} from '../projection-types';
import {allocateAduSharedExpense} from '../property/adu-allocation';
import {loanRentalShares,allocateShares} from '../property/allocation';
import {resolveAduOperatingCash} from '../property/adu-tax';
import {Decimal,settleSeries,CalculationRangeError} from '../money';
import {combineAvailableCents,sumCents,mapAvailableCents} from '../tax/modified-income';
const av=<T>(value:T):Available<T>=>({status:'available',value});
const sum=(values:readonly Available<Cents>[]):Available<Cents>=>{try{return combineAvailableCents(values);}catch(error){if(!(error instanceof CalculationRangeError))throw error;return {status:'unsupported-case',issues:[{code:'monetary-overflow',field:'cashCents',severity:'warning',explanation:'The combined cash amount exceeds the supported monetary range.',resolution:'Review the affected cash inputs.'}]};}};
export interface RetirementRecurringCashMonth {readonly rentalCashCents:Available<Cents>;readonly personalExpensesCents:Available<Cents>;readonly personalDebtPaymentsCents:Available<Cents>;readonly otherCashIncomeCents:Available<Cents>;readonly capitalFundingCents:Available<Cents>}
/** Reuse original dated streams and allocations. Project construction is a capital movement, not rental income. */
export function retirementRecurringCash(plan:ValidatedPlan,cash:CashYear,property:PropertyYearFacts,loans:readonly LoanSchedule[],adu:AduYear,mechanical:readonly MonthlyProjection[],retirementPurchaseYears:Readonly<Record<string,number>>={}):readonly RetirementRecurringCashMonth[]{
 const projectUnitIds=new Set(adu.projects.map(p=>p.rentalId)),ordinaryExpenseMonths:Available<Cents>[][]=Array.from({length:12},()=>[]);
 for(const row of property.expenses){
  const definition=plan.expenses.find(e=>e.id===row.expenseId),stream=cash.streams.find(s=>s.id===row.expenseId);if(!definition||!stream)continue;
  const host=plan.properties.find(p=>p.id===row.propertyId)!,projectUnit=host.aduProject?plan.rentals.find(r=>r.id===host.aduProject!.rentalId):undefined;
  if(projectUnit){const allocated=allocateAduSharedExpense(definition,host,projectUnit,stream.months,cash.year);for(let i=0;i<12;i++)ordinaryExpenseMonths[i]!.push(allocated.status==='available'?av(sumCents(Object.entries(allocated.value[i]!.rentalCentsByUnit).filter(([id])=>!projectUnitIds.has(id)).map(([,v])=>v))):allocated);}
  else {const rental=sumCents(Object.entries(row.rentalCentsByUnit).filter(([id])=>!projectUnitIds.has(id)).map(([,v])=>v)),allocated=settleSeries(stream.months.map(v=>row.paidCents?new Decimal(rental).times(v).div(row.paidCents):new Decimal(0)));allocated.forEach((v,i)=>ordinaryExpenseMonths[i]!.push(av(v)));}
 }
 const operations=adu.projects.map(p=>{const host=plan.properties.find(h=>h.id===p.propertyId)!,unit=plan.rentals.find(r=>r.id===p.rentalId)!;return {context:p,operating:resolveAduOperatingCash(plan,host,unit,cash.year)};});
 return Array.from({length:12},(_,i)=>{
  const base=mechanical[i]!,projectPaid=operations.map(p=>p.operating.status==='available'?av(p.operating.value.paid[i]!):p.operating),projectTax=operations.map(p=>{const row=p.context.months[i]!,bad=row.cashComplete.status==='available'?[]:row.cashComplete.issues.filter(issue=>issue.field==='projectTaxPaidCents');return bad.length?{status:'needs-data' as const,issues:bad}:av(row.projectTaxPaidCents);}),construction=base.adu?.constructionCostCents??av(0),ownerConstruction=operations.map(p=>{const row=p.context.months[i]!;return row.cashComplete.status==='available'?av(row.ownerConstructionCents):row.cashComplete;}),rentalPayments:Available<Cents>[]=[];
  for(const schedule of loans){const host=plan.properties.find(p=>p.loans.some(l=>l.id===schedule.loanId))??plan.properties.find(p=>plan.debts.some(d=>d.id===schedule.loanId&&d.propertyId===p.id));if(!host)continue;const loan=host.loans.find(l=>l.id===schedule.loanId),units=plan.rentals.filter(r=>r.propertyId===host.id),shares=loanRentalShares(loan,host,units),m=schedule.months.find(m=>Number(m.date.slice(5,7))===i+1);if(m)rentalPayments.push(av(sumCents(Object.values(allocateShares(m.paymentCents,shares).rentalCentsByUnit))));}
  for(const p of adu.projects){const id=plan.properties.find(h=>h.id===p.propertyId)!.aduProject!.financing?.id;if(id)rentalPayments.push(base.loans.find(l=>l.loanId===id)?.paymentCents??av(0));}
  const ordinaryPaid=sum(ordinaryExpenseMonths[i]!),rentalPaid=sum([ordinaryPaid,...projectPaid,...projectTax]),rentalDebt=sum(rentalPayments),rent=base.rentCents,purchases=plan.properties.filter(p=>p.purchaseDate>`${plan.startYear}-01-01`),scheduledPurchase=av(sumCents(purchases.filter(p=>retirementPurchaseYears[p.id]===undefined).map(p=>cash.streams.find(s=>s.kind==='expense'&&s.id===p.id)?.months[i]??0)));
  return {rentalCashCents:sum([rent,mapAvailableCents(rentalPaid,v=>-v),mapAvailableCents(rentalDebt,v=>-v)]),personalExpensesCents:sum([base.expensesCents,mapAvailableCents(rentalPaid,v=>-v),mapAvailableCents(construction,v=>-v),mapAvailableCents(scheduledPurchase,v=>-v)]),personalDebtPaymentsCents:sum([base.debtPaymentCents,mapAvailableCents(rentalDebt,v=>-v)]),otherCashIncomeCents:base.otherIncomeCents,capitalFundingCents:sum([...ownerConstruction,scheduledPurchase])};
 });
}
