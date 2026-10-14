import {calendarDate,isValidISODate,isValidYearMonth,yearMonth} from '../dates';
import {CalculationRangeError,Decimal,MAX_CENTS,settleCents} from '../money';
import type {Cents,Property} from '../model/plan';
import type {Available} from '../model/results';
import type {LoanMonth,LoanSchedule} from './loans';
import {scheduledPayment} from './loans';

export interface AduLoanMonth extends LoanMonth {
  readonly drawCents:Cents;readonly financedCostPaidCents:Cents;
  readonly openingEarmarkedCents:Cents;readonly closingEarmarkedCents:Cents;
}
export interface AduLoanSchedule extends LoanSchedule {
  readonly projectId:string;readonly propertyId:string;readonly rentalId:string;
  readonly months:readonly AduLoanMonth[];
}
export interface AduFundingMonth {
  readonly year:number;readonly month:number;readonly drawCents:Cents;readonly financedCostPaidCents:Cents;
  readonly ownerConstructionCents:Cents;readonly openingEarmarkedCents:Cents;readonly closingEarmarkedCents:Cents;
}
class ContractError extends Error {}
interface ContractMovements {costs:Map<string,Decimal>;draws:Map<string,Decimal>;financed:Map<string,Decimal>}
const index=(month:string):number=>Number(month.slice(0,4))*12+Number(month.slice(5,7))-1;
function unavailable(property:Property,code:string,explanation:string,year?:number):Available<never> {
  return {status:'needs-data',issues:[{code,recordId:property.aduProject?.financing?.id??property.aduProject?.id??property.id,...(year===undefined?{}:{year}),field:'aduProject.financing',severity:'warning',explanation,resolution:'Correct the dedicated loan contract and its cost attributions; no reimbursement or unused proceeds are supported.'}]};
}
function requireContract(condition:boolean,message:string):void {if(!condition)throw new ContractError(message);}
function validMoney(value:number):boolean{return Number.isSafeInteger(value)&&value>=0&&value<=MAX_CENTS;}
function add(map:Map<string,Decimal>,key:string,amount:number|Decimal):void {map.set(key,(map.get(key)??new Decimal(0)).plus(amount));}
/** Validate the whole declaration, without calculating future cash/debt prefixes. */
function contract(property:Property,startYear:number,horizonYears:number):ContractMovements {
  requireContract(Number.isInteger(startYear)&&startYear>=2026&&startYear<=9999&&Number.isInteger(horizonYears)&&horizonYears>=1&&horizonYears<=40&&startYear+horizonYears-1<=9999,'Invalid forecast calendar.');
  const project=property.aduProject;requireContract(!!project,'A property-owned ADU project is required.');
  requireContract(isValidISODate(project!.completionDate),'Enter a valid completion date.');
  const costs=new Map<string,Decimal>(),draws=new Map<string,Decimal>(),financed=new Map<string,Decimal>();
  const byId=new Map(project!.costs.map(cost=>[cost.id,cost]));
  requireContract(byId.size===project!.costs.length,'Cost identities must be unique.');
  for(const cost of project!.costs){
    requireContract(validMoney(cost.amountCents)&&isValidISODate(cost.paymentDate),'Costs require nonnegative supported cents and payment dates.');
    requireContract(cost.paymentDate>=`${startYear}-01-01`&&cost.paymentDate<=project!.completionDate,'Costs must be paid within the forecast and by completion.');
    add(costs,cost.paymentDate.slice(0,7),cost.amountCents);
  }
  const loan=project!.financing;
  if(loan){
    requireContract(loan.collateralPropertyId===property.id,'Loan collateral must be this project property.');
    requireContract(Number.isInteger(loan.aprBps)&&loan.aprBps>=0&&loan.aprBps<=100000,'Invalid fixed loan APR.');
    requireContract(Number.isInteger(loan.termMonths)&&loan.termMonths>=1&&loan.termMonths<=1200&&isValidYearMonth(loan.firstAmortizingPaymentMonth),'Enter a valid amortization month and complete contractual term.');
    const funded=new Map<string,Decimal>(),seen=new Set<string>();
    for(const draw of loan.draws){
      requireContract(!seen.has(draw.id),'Draw identities must be unique.');seen.add(draw.id);
      requireContract(validMoney(draw.amountCents)&&isValidYearMonth(draw.month),'Draws require nonnegative supported cents and months.');
      requireContract(draw.month>=`${startYear}-01`&&draw.month<=project!.completionDate.slice(0,7)&&draw.month<loan.firstAmortizingPaymentMonth,'All draws must occur within the forecast, by completion and before amortization.');
      let allocated=new Decimal(0);const used=new Set<string>();
      for(const allocation of draw.costAllocations){
        const cost=byId.get(allocation.costId);
        requireContract(!!cost&&!used.has(allocation.costId),'Each draw allocation must name a distinct owned stage.');used.add(allocation.costId);
        requireContract(validMoney(allocation.amountCents),'Allocated cents must be nonnegative and within range.');
        requireContract(draw.month<=cost!.paymentDate.slice(0,7),'A draw cannot reimburse an already-paid stage.');
        allocated=allocated.plus(allocation.amountCents);add(funded,allocation.costId,allocation.amountCents);
        requireContract(funded.get(allocation.costId)!.lte(cost!.amountCents),'A stage cannot be overfinanced or fund the same cent twice.');
        add(financed,cost!.paymentDate.slice(0,7),allocation.amountCents);
      }
      requireContract(allocated.eq(draw.amountCents),'Attributed cost cents must equal each full draw.');add(draws,draw.month,draw.amountCents);
    }
  }
  return {costs,draws,financed};
}
function reportError(property:Property,error:unknown,startYear:number):Available<never> {
  if(error instanceof CalculationRangeError)return unavailable(property,'monetary-overflow',error.message,startYear);
  if(error instanceof ContractError)return unavailable(property,'invalid-adu-financing',error.message,startYear);
  throw error;
}
export function resolveAduFunding(property:Property,startYear:number,horizonYears:number):Available<readonly AduFundingMonth[]> {
  try{
    const movements=contract(property,startYear,horizonYears);let earmarked=0;
    const months=Array.from({length:horizonYears*12},(_,offset)=>{
      const year=startYear+Math.floor(offset/12),month=offset%12+1,key=yearMonth(year,month);
      const drawCents=settleCents(movements.draws.get(key)??new Decimal(0));
      const financedCostPaidCents=settleCents(movements.financed.get(key)??new Decimal(0));
      const ownerConstructionCents=settleCents((movements.costs.get(key)??new Decimal(0)).minus(financedCostPaidCents));
      const openingEarmarkedCents=earmarked;
      earmarked=settleCents(new Decimal(earmarked).plus(drawCents).minus(financedCostPaidCents));
      return {year,month,drawCents,financedCostPaidCents,ownerConstructionCents,openingEarmarkedCents,closingEarmarkedCents:earmarked};
    });
    return {status:'available',value:months};
  }catch(error){return reportError(property,error,startYear);}
}
export function calculateAduLoanSchedule(property:Property,startYear:number,horizonYears:number):Available<AduLoanSchedule> {
  const project=property.aduProject,loan=project?.financing;
  if(!project||!loan)return unavailable(property,'required-adu-financing','This project has no dedicated financing contract.');
  try{
    const movements=contract(property,startYear,horizonYears),first=index(loan.firstAmortizingPaymentMonth);
    let balance=0,earmarked=0,payment:number|undefined;
    const months:AduLoanMonth[]=[];
    for(let offset=0;offset<horizonYears*12;offset++){
      const year=startYear+Math.floor(offset/12),month=offset%12+1,key=yearMonth(year,month),current=year*12+month-1;
      const openingPrincipalCents=balance,openingEarmarkedCents=earmarked;
      const drawCents=settleCents(movements.draws.get(key)??new Decimal(0));
      const financedCostPaidCents=settleCents(movements.financed.get(key)??new Decimal(0));
      balance=settleCents(new Decimal(balance).plus(drawCents));
      earmarked=settleCents(new Decimal(earmarked).plus(drawCents).minus(financedCostPaidCents));
      const interestCents=settleCents(new Decimal(balance).times(loan.aprBps).div(120000));
      const due=settleCents(new Decimal(balance).plus(interestCents));
      let paymentCents=interestCents;
      if(current>=first){
        payment??=scheduledPayment(balance,loan.aprBps,loan.termMonths);
        paymentCents=current===first+loan.termMonths-1?due:Math.min(payment,due);
      }
      const principalPaidCents=settleCents(new Decimal(paymentCents).minus(interestCents));
      balance=settleCents(new Decimal(balance).minus(principalPaidCents));
      months.push({loanId:loan.id,date:calendarDate(year,month,31),openingPrincipalCents,interestCents,paymentCents,principalPaidCents,closingPrincipalCents:balance,openingProvenance:'known',issues:[],drawCents,financedCostPaidCents,openingEarmarkedCents,closingEarmarkedCents:earmarked});
    }
    return {status:'available',value:{loanId:loan.id,projectId:project.id,propertyId:property.id,rentalId:project.rentalId,startYear,horizonYears,months,openingProvenance:'known',paymentProvenance:'known',averageBalanceEvidence:[],issues:[]}};
  }catch(error){return reportError(property,error,startYear);}
}
