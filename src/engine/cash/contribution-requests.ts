import type { Cents, ValidatedPlan } from '../model/plan';
import { Decimal, settleSeries } from '../money';
import { calendarDate, daysInMonth } from '../dates';
import type { CashYear } from './income';

export interface ContributionRequest {
  readonly ruleId: string; readonly accountId: string; readonly ownerId: string;
  readonly year: number; readonly month: number; readonly priority: number; readonly requestedCents: Cents;
  readonly sponsoringSalaryId?: string; readonly employerId?: string;
}
export function requestContributions(plan: ValidatedPlan, cash: CashYear): readonly ContributionRequest[] {
  const requests:ContributionRequest[]=[];
  for(const rule of plan.contributions) {
    const account=plan.accounts.find(a=>a.id===rule.accountId)!;
    const sponsor=plan.salaries.find(s=>s.id===rule.sponsoringSalaryId);
    const amount=rule.amount;
    const values=Array.from({length:12},(_,i)=>{
      const end=calendarDate(cash.year,i+1,daysInMonth(cash.year,i+1));
      if(amount.kind==='fixed')return end>=rule.startDate&&(!rule.endDate||end<=rule.endDate)?new Decimal(amount.monthlyCents):new Decimal(0);
      return cash.salaryPeriods.filter(p=>p.salaryId===amount.salaryId&&p.month===i+1).reduce((total,p)=>{
        const from=p.startDate>rule.startDate?p.startDate:rule.startDate;
        const to=!rule.endDate||p.endDate<rule.endDate?p.endDate:rule.endDate;
        if(from>to)return total;
        const activeDays=Number(to.slice(8,10))-Number(from.slice(8,10))+1;
        const periodDays=Number(p.endDate.slice(8,10))-Number(p.startDate.slice(8,10))+1;
        return total.plus(new Decimal(p.unroundedEarnedCents).mul(activeDays).div(periodDays).mul(amount.percentBps).div(10000));
      },new Decimal(0));
    });
    for(const [i,requestedCents] of settleSeries(values).entries()) requests.push({ruleId:rule.id,accountId:account.id,ownerId:account.ownerId,year:cash.year,month:i+1,priority:rule.priority,requestedCents,...(rule.sponsoringSalaryId?{sponsoringSalaryId:rule.sponsoringSalaryId}:{}),...(sponsor?{employerId:sponsor.employerId}:{})});
  }
  return requests.sort((a,b)=>a.month-b.month||a.priority-b.priority||a.ruleId.localeCompare(b.ruleId));
}
