import type { Cents, ISODate, Salary, ValidatedPlan } from '../model/plan';
import { Decimal, settleCents, settleSeries } from '../money';
import { calendarDate, daysInMonth, parseISODate } from '../dates';
import { expenseAmounts, recurringAmounts } from './expenses';
import { childExpenseAmounts } from '../children/planning';

export interface CashTotals {
  readonly salaryCents: Cents; readonly otherIncomeCents: Cents; readonly rentCents: Cents;
  readonly grossIncomeCents: Cents; readonly expensesCents: Cents; readonly wageCents: Cents;
  readonly ordinaryTaxableCents: Cents; readonly nonTaxableCents: Cents;
}
export interface CashMonth extends CashTotals { readonly year: number; readonly month: number; readonly date: string }
export interface CashStream {
  readonly id: string; readonly kind: 'salary' | 'other-income' | 'expense' | 'rent';
  readonly months: readonly Cents[]; readonly annualCents: Cents;
  readonly classification?: 'wage' | 'ordinary-taxable' | 'non-taxable';
  readonly niitTreatment?: 'included' | 'excluded' | 'unknown';
  readonly ownerId?: string; readonly employerId?: string; readonly propertyId?: string; readonly aduProjectId?: string;
}
export interface WageFacts {
  readonly ownerId: string; readonly employerId: string; readonly monthlyCents: readonly Cents[];
  readonly annualCents: Cents; readonly streamIds: readonly string[];
}
export interface SalaryPeriod {
  readonly salaryId: string; readonly ownerId: string; readonly employerId: string;
  readonly month: number; readonly startDate: ISODate; readonly endDate: ISODate;
  readonly annualGrossCents: Cents; readonly unroundedEarnedCents: string;
}
export interface CashYear {
  readonly year: number; readonly months: readonly CashMonth[]; readonly annual: CashTotals;
  readonly streams: readonly CashStream[]; readonly wages: readonly WageFacts[];
  readonly salaryPeriods: readonly SalaryPeriod[]; readonly positiveGrossCashByMonth: readonly Cents[];
  /** Generated investment-sale gain is a tax fact, separate from cash income and sale proceeds. */
  readonly longTermCapitalGainCents?: Cents;
}

const sum = (values: readonly Cents[]): Cents => settleCents(values.reduce((s,v) => s.plus(v), new Decimal(0)));
const day = (date: ISODate) => Number(date.slice(8,10));
const minDate = (a: ISODate, b: ISODate) => a < b ? a : b;
const maxDate = (a: ISODate, b: ISODate) => a > b ? a : b;

function earnedSalary(salary: Salary, year: number): { months: readonly Cents[]; periods: readonly SalaryPeriod[] } {
  const yearEnd = calendarDate(year,12,31);
  const explicit = new Map(salary.changes.map(c => [c.date,c]));
  const events = salary.changes.map(c => ({date:c.date, change:c, automatic:false}));
  for (let y=Number(salary.startDate.slice(0,4)); y<=year; y++) {
    const date=calendarDate(y,salary.raiseMonth,salary.raiseDay);
    if(date>salary.startDate && date<=yearEnd && !explicit.has(date)) events.push({date,change:{ date,kind:'percent',percentBps:salary.annualRaiseBps },automatic:true});
  }
  events.sort((a,b)=>a.date.localeCompare(b.date));
  const periods: SalaryPeriod[]=[];
  const unrounded=Array.from({length:12},()=>new Decimal(0));
  let rate=new Decimal(salary.annualGrossCents), current=salary.startDate;
  const addPeriod=(start:ISODate,end:ISODate,annualRate:Decimal) => {
    for(let month=1;month<=12;month++) {
      const from=maxDate(start,calendarDate(year,month,1));
      const to=minDate(end,calendarDate(year,month,daysInMonth(year,month)));
      if(from>to)continue;
      const earned=annualRate.div(12).mul(day(to)-day(from)+1).div(daysInMonth(year,month));
      unrounded[month-1]=unrounded[month-1]!.plus(earned);
      periods.push({salaryId:salary.id,ownerId:salary.ownerId,employerId:salary.employerId,month,startDate:from,endDate:to,annualGrossCents:settleCents(annualRate),unroundedEarnedCents:earned.toFixed()});
    }
  };
  const end=minDate(salary.endDate??yearEnd,yearEnd);
  for(const e of events) {
    if(e.date<salary.startDate || e.date>end)continue;
    if(e.date>current) {
      const {year:y,month:m,day:d}=parseISODate(e.date);
      const before=d>1?calendarDate(y,m,d-1):m>1?calendarDate(y,m-1,daysInMonth(y,m-1)):calendarDate(y-1,12,31);
      addPeriod(current,before,rate);
    }
    const nextRate=e.change.kind==='amount'?new Decimal(e.change.annualGrossCents):rate.mul(new Decimal(1).plus(new Decimal(e.change.percentBps).div(10000)));
    // Automatic growth must neither exceed its ceiling nor lower an explicit override.
    rate=e.automatic&&salary.annualRaiseCapCents!==undefined&&nextRate.gt(rate)
      ?Decimal.min(nextRate,Decimal.max(rate,salary.annualRaiseCapCents)):nextRate;
    current=e.date;
  }
  if(current<=end)addPeriod(current,end,rate);
  return {months:settleSeries(unrounded),periods};
}

export interface CashSelection {readonly streamIds?:ReadonlySet<string>}
export function resolveCashYear(plan: ValidatedPlan, year: number, selection?:CashSelection): CashYear {
  const include=(id:string):boolean=>!selection?.streamIds||selection.streamIds.has(id);
  const streams: CashStream[]=[], salaryPeriods: SalaryPeriod[]=[];
  for(const s of [...plan.salaries].sort((a,b)=>a.id.localeCompare(b.id))) {
    if(!include(s.id))continue;
    const result=earnedSalary(s,year); salaryPeriods.push(...result.periods);
    streams.push({id:s.id,kind:'salary',months:result.months,annualCents:sum(result.months),classification:'wage',ownerId:s.ownerId,employerId:s.employerId,niitTreatment:'excluded'});
  }
  for(const o of [...plan.otherIncome].sort((a,b)=>a.id.localeCompare(b.id))) {
    if(!include(o.id))continue;
    const months=recurringAmounts(o,year);
    streams.push({id:o.id,kind:'other-income',months,annualCents:sum(months),classification:o.classification,...(o.niitTreatment?{niitTreatment:o.niitTreatment}:{}),...(o.ownerId?{ownerId:o.ownerId}:{}),...(o.employerId?{employerId:o.employerId}:{})});
  }
  for(const e of [...plan.expenses].sort((a,b)=>a.id.localeCompare(b.id))) {
    if(!include(e.id))continue;
    const months=expenseAmounts(e,year);
    streams.push({id:e.id,kind:'expense',months,annualCents:sum(months),...(e.propertyId?{propertyId:e.propertyId}:{})});
  }
  for(const child of [...(plan.children??[])].sort((a,b)=>a.id.localeCompare(b.id))) {
    if(!include(child.id))continue;
    const months=childExpenseAmounts(child,year);
    streams.push({id:child.id,kind:'expense',months,annualCents:sum(months)});
  }
  for(const property of plan.properties) {
    const project=property.aduProject;if(!project)continue;
    for(const cost of project.costs) {
      if(!include(cost.id))continue;
      const months=Array.from({length:12},(_,index)=>cost.paymentDate.slice(0,7)===`${year}-${String(index+1).padStart(2,'0')}`?cost.amountCents:0);
      streams.push({id:cost.id,kind:'expense',months,annualCents:sum(months),propertyId:property.id,aduProjectId:project.id});
    }
    // Keep every declared payment stream in every year, with zero cash outside
    // its payment month, so projection can resolve records across the horizon.
    for(const row of project.propertyTax.paymentYears)for(const payment of row.payments) {
      if(!include(payment.id))continue;
      const months=Array.from({length:12},(_,index)=>payment.month===`${year}-${String(index+1).padStart(2,'0')}`?payment.amountCents:0);
      streams.push({id:payment.id,kind:'expense',months,annualCents:sum(months),propertyId:property.id,aduProjectId:project.id});
    }
  }
  for(const r of [...plan.rentals].sort((a,b)=>a.id.localeCompare(b.id))) {
    if(!include(r.id))continue;
    const startYear=Number(r.rentStartDate.slice(0,4));
    const amount=new Decimal(r.monthlyRentCents).mul(new Decimal(1).plus(new Decimal(r.rentGrowthBps).div(10000)).pow(Math.max(0,year-startYear)));
    const collected=r.vacancyBps===undefined?amount:amount.times(new Decimal(10000).minus(r.vacancyBps).div(10000));
    const exact=Array.from({length:12},(_,i)=>{
      const from=maxDate(r.rentStartDate,calendarDate(year,i+1,1));
      const to=minDate(r.rentEndDate??calendarDate(year,12,31),calendarDate(year,i+1,daysInMonth(year,i+1)));
      return from>to?new Decimal(0):collected.mul(day(to)-day(from)+1).div(daysInMonth(year,i+1));
    });
    const months=settleSeries(exact);
    streams.push({id:r.id,kind:'rent',months,annualCents:sum(months),propertyId:r.propertyId});
  }
  const select=(predicate:(s:CashStream)=>boolean,i:number)=>sum(streams.filter(predicate).map(s=>s.months[i]!));
  const months:CashMonth[]=Array.from({length:12},(_,i)=>({year,month:i+1,date:`${year}-${String(i+1).padStart(2,'0')}`,salaryCents:select(s=>s.kind==='salary',i),otherIncomeCents:select(s=>s.kind==='other-income',i),rentCents:select(s=>s.kind==='rent',i),grossIncomeCents:select(s=>s.kind!=='expense',i),expensesCents:select(s=>s.kind==='expense',i),wageCents:select(s=>s.classification==='wage',i),ordinaryTaxableCents:select(s=>s.classification==='ordinary-taxable',i),nonTaxableCents:select(s=>s.classification==='non-taxable',i)}));
  const annual:CashTotals={salaryCents:sum(months.map(m=>m.salaryCents)),otherIncomeCents:sum(months.map(m=>m.otherIncomeCents)),rentCents:sum(months.map(m=>m.rentCents)),grossIncomeCents:sum(months.map(m=>m.grossIncomeCents)),expensesCents:sum(months.map(m=>m.expensesCents)),wageCents:sum(months.map(m=>m.wageCents)),ordinaryTaxableCents:sum(months.map(m=>m.ordinaryTaxableCents)),nonTaxableCents:sum(months.map(m=>m.nonTaxableCents))};
  const grouped=new Map<string,CashStream[]>();
  for(const s of streams.filter(s=>s.classification==='wage')) {const key=JSON.stringify([s.ownerId,s.employerId]);grouped.set(key,[...(grouped.get(key)??[]),s]);}
  const wages:WageFacts[]=[...grouped.values()].map(group=>({ownerId:group[0]!.ownerId!,employerId:group[0]!.employerId!,monthlyCents:Array.from({length:12},(_,i)=>sum(group.map(s=>s.months[i]!))),annualCents:sum(group.map(s=>s.annualCents)),streamIds:group.map(s=>s.id)})).sort((a,b)=>a.ownerId.localeCompare(b.ownerId)||a.employerId.localeCompare(b.employerId));
  return {year,months,annual,streams,wages,salaryPeriods,positiveGrossCashByMonth:months.map(m=>Math.max(0,m.grossIncomeCents))};
}
