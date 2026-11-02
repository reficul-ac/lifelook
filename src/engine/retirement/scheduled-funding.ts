import type {Cents,ValidatedPlan} from '../model/plan';
import type {ForecastCheckpoint} from '../forecast/types';
import {Decimal,settleCents} from '../money';
export interface ScheduledRetirementFunding {readonly id:string;readonly date:string;readonly accountId:string;readonly cashCents:Cents}
/** Preserve the source's explicit brokerage funding and original payment dates. Cash-funded commitments retain cash-gap reporting. */
export function compileScheduledRetirementFunding(plan:ValidatedPlan,opening:ForecastCheckpoint):readonly ScheduledRetirementFunding[]{
 const year=opening.year,events:ScheduledRetirementFunding[]=[];
 for(const p of plan.properties){
  if(opening.retirementPurchaseYears?.[p.id]===undefined&&p.purchaseDate.startsWith(`${year}-`)&&p.purchaseDate>`${plan.startYear}-01-01`&&p.purchaseFunding?.kind==='taxable-brokerage'&&p.downPaymentCents>0)events.push({id:p.id,date:p.purchaseDate,accountId:p.purchaseFunding.accountId,cashCents:p.downPaymentCents});
  const project=p.aduProject;if(project?.ownerFunding?.kind==='taxable-brokerage')for(const cost of project.costs.filter(c=>c.paymentDate.startsWith(`${year}-`))){const financed=settleCents((project.financing?.draws??[]).filter(d=>d.month<=cost.paymentDate.slice(0,7)).flatMap(d=>d.costAllocations.filter(a=>a.costId===cost.id)).reduce((n,a)=>n.plus(a.amountCents),new Decimal(0))),cashCents=Math.max(0,cost.amountCents-financed);if(cashCents>0)events.push({id:cost.id,date:cost.paymentDate,accountId:project.ownerFunding.accountId,cashCents});}
 }
 return events.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export const scheduledDistributionId=(event:ScheduledRetirementFunding)=>`retirement:${event.date}:0:scheduled:${event.id}`;
