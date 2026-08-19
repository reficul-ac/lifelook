import { estimateHouseholdTax, estimateTax, TAX_RULES_2025, TAX_RULES_2026 } from "./tax";
import { projectedSharePrice, valueForUnits, vestValue, vestedUnitsAt } from "./equity";
import type { AnnualProjection, ContributionResult, ContributionRule, FinancialSnapshot, MonthlyProjection, ProjectionWarning, PropertyProjectionResult, PropertyProjectionStatus, RecurringEntry, Scenario } from "./types";

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
const grow = (cents: number, bps: number, months: number) => Math.round(cents * Math.pow(1 + bps / 10_000, months / 12));
const monthsBetween=(from:string,to:string)=>Math.max(0,(Number(to.slice(0,4))-Number(from.slice(0,4)))*12+Number(to.slice(5,7))-Number(from.slice(5,7)));
export const californiaAssessedValue=(asset:Pick<import("./types").Asset,"valueCents"|"purchasePriceCents"|"purchaseDate">,date:string,fallbackStart=date)=>grow(asset.purchasePriceCents??asset.valueCents,200,monthsBetween(asset.purchaseDate??fallbackStart,date));
export const appreciationRateForYear=(asset:Pick<import("./types").Asset,"annualGrowthBps"|"appreciationCurve">,year:number)=>{const curve=asset.appreciationCurve;if(!curve)return asset.annualGrowthBps;if(year<=curve.startYear)return curve.startRateBps;if(year>=curve.endYear)return curve.endRateBps;return Math.round(curve.startRateBps+(curve.endRateBps-curve.startRateBps)*(year-curve.startYear)/(curve.endYear-curve.startYear));};
export const vestedBpsAtDate=(asset:Pick<import("./types").Asset,"privateStock">,date:string)=>{const stock=asset.privateStock;if(!stock)return 10000;const start=isoDate(stock.vestingStartDate),current=isoDate(date);if(current<start)return stock.vestedBps;const months=(current.getUTCFullYear()-start.getUTCFullYear())*12+current.getUTCMonth()-start.getUTCMonth();const quarters=Math.min(stock.remainingVestingQuarters,Math.floor(months/3));return Math.min(10000,Math.round(stock.vestedBps+(10000-stock.vestedBps)*quarters/stock.remainingVestingQuarters));};
export const vestedAssetValue=(asset:Pick<import("./types").Asset,"valueCents"|"privateStock">&{value?:number},date:string)=>Math.round((asset.value??asset.valueCents)*vestedBpsAtDate(asset,date)/10000);
export const vestedEquityValue=(asset:Pick<import("./types").Asset,"equityHolding">,date:string)=>asset.equityHolding?.grants.reduce((sum,grant)=>sum+valueForUnits(vestedUnitsAt(grant,date),projectedSharePrice(asset.equityHolding!,date)),0)??0;
const isoDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new RangeError(`Invalid date: ${value}`);
  return date;
};
const addMonths = (date: Date, count: number) => {
  const day = date.getUTCDate();
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
  result.setUTCDate(Math.min(day, new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()));
  return result;
};
function annualHousingDeductions(snapshot:FinancialSnapshot,year:number){
  let mortgageInterestCents=0,propertyTaxCents=0,mortgageDebtCents=0;
  for(const asset of snapshot.assets)if(asset.housingCosts?.propertyTaxRateBps)propertyTaxCents+=Math.round(californiaAssessedValue(asset,`${year}-01`,`${year}-01`)*asset.housingCosts.propertyTaxRateBps/10_000);
  for(const liability of snapshot.liabilities){const mortgage=liability.mortgage;if(!mortgage)continue;mortgageDebtCents+=mortgage.originalPrincipalCents;let balance=mortgage.originalPrincipalCents,cursor=isoDate(mortgage.startDate);for(let count=0;count<mortgage.termMonths&&balance>0;count++,cursor=addMonths(cursor,1)){const interest=Math.round(balance*liability.annualRateBps/120_000);if(cursor.getUTCFullYear()===year)mortgageInterestCents+=interest;if(cursor.getUTCFullYear()>year)break;const payment=Math.min(mortgage.paymentOverrideCents??liability.minimumPaymentCents,balance+interest);balance=balance+interest-payment;}}
  return {mortgageInterestCents,propertyTaxCents,mortgageDebtCents};
}
export function effectiveContributionBps(rules:readonly ContributionRule[],monthlySurplusCents:number){
  if(monthlySurplusCents<=0)return 0;
  const fixed=Math.min(monthlySurplusCents,rules.reduce((sum,rule)=>sum+(rule.monthlyAmountCents??0),0));
  const remaining=monthlySurplusCents-fixed,percentBps=Math.min(10000,rules.reduce((sum,rule)=>sum+(rule.percentBps??0),0));
  return Math.min(10000,Math.round((fixed+remaining*percentBps/10000)*10000/monthlySurplusCents));
}
function contributionDates(anchor:Date,frequency:import("./types").RecurringFrequency,month:string){
  const first=isoDate(`${month}-01`),after=addMonths(first,1),dates:Date[]=[];
  if(frequency==="weekly"||frequency==="biweekly"){
    const interval=(frequency==="weekly"?7:14)*86400000;
    let cursor=anchor;
    if(cursor<first)cursor=new Date(cursor.valueOf()+Math.ceil((first.valueOf()-cursor.valueOf())/interval)*interval);
    while(cursor<after){if(cursor>=first)dates.push(cursor);cursor=new Date(cursor.valueOf()+interval);}
  }else{
    const step=frequency==="monthly"?1:frequency==="quarterly"?3:12;
    let n=Math.max(0,Math.ceil(((first.getUTCFullYear()-anchor.getUTCFullYear())*12+first.getUTCMonth()-anchor.getUTCMonth())/step));
    let cursor=addMonths(anchor,n*step);while(cursor<after){if(cursor>=first)dates.push(cursor);n++;cursor=addMonths(anchor,n*step);}
  }
  return dates;
}
function withPartialGrowth(cents:number,bps:number,date:Date){const days=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()-date.getUTCDate();return grow(cents,bps,days/(new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()) );}
function occurrences(entry: RecurringEntry, month: string) {
  const start = isoDate(entry.startDate), end = entry.endDate ? isoDate(entry.endDate) : undefined;
  if (end && end < start) throw new RangeError("Recurring end date must be on or after its start date");
  const first = new Date(`${month}-01T00:00:00Z`), after = addMonths(first, 1);
  let count = 0, cursor = start;
  const frequency = entry.frequency ?? "monthly";
  if (frequency === "weekly" || frequency === "biweekly") {
    const days = frequency === "weekly" ? 7 : 14;
    if (cursor < first) cursor = new Date(cursor.valueOf() + Math.max(0, Math.ceil((first.valueOf() - cursor.valueOf()) / (days * 86400000))) * days * 86400000);
    while (cursor < after && (!end || cursor <= end)) { if (cursor >= first) count++; cursor = new Date(cursor.valueOf() + days * 86400000); }
  } else {
    const step = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
    let n = Math.max(0, Math.floor(((first.getUTCFullYear() - start.getUTCFullYear()) * 12 + first.getUTCMonth() - start.getUTCMonth()) / step) - 1);
    cursor = addMonths(start, n * step);
    while (cursor < after && (!end || cursor <= end)) { if (cursor >= first) count++; n++; cursor = addMonths(start, n * step); }
  }
  return count;
}
function recurringAmount(entry:RecurringEntry,annualOrOccurrenceCents:number,month:string,growthBps:number,growthMonths:number,count:number){
  const salaryRaiseMonth=entry.annualGrowthMonth??new Date(`${entry.startDate}T00:00:00Z`).getUTCMonth()+1,currentYear=Number(month.slice(0,4)),currentMonth=Number(month.slice(5,7)),startYear=Number(entry.startDate.slice(0,4)),raises=entry.incomeType==="salary"?Math.max(0,currentYear-startYear-(currentMonth<salaryRaiseMonth?1:0)):0;
  const uncapped=entry.incomeType==="salary"?Math.round(annualOrOccurrenceCents*Math.pow(1+growthBps/10_000,raises)):grow(annualOrOccurrenceCents,growthBps,growthMonths);
  const grown=entry.incomeType==="salary"&&entry.annualGrowthCapCents!=null?Math.min(uncapped,entry.annualGrowthCapCents):uncapped;
  if(entry.incomeType!=="salary")return grown*count;
  const base=Math.floor(grown/12),remainder=grown-base*12,calendarMonth=Number(month.slice(5,7))-1;
  return base+(calendarMonth<remainder?1:0);
}

export const ProjectionEngine = {
  calculate(snapshot: FinancialSnapshot, scenario: Scenario, asOfDate: string): readonly AnnualProjection[] {
    if (scenario.horizon.months < 1 || scenario.horizon.months > 480) throw new RangeError("Projection horizon must be between 1 and 480 months");
    const asOf = isoDate(asOfDate), asOfMonth = monthKey(asOf);
    const start = new Date(`${asOfMonth}-01T00:00:00Z`);
    const accounts = new Map(snapshot.accounts.map(a => [a.id, { ...a, balance: a.balanceCents }]));
    const assets = new Map(snapshot.assets.map(a => [a.id, { ...a, value: a.valueCents, withheld: 0 }]));
    const debts = new Map(snapshot.liabilities.map(l => [l.id, { ...l, balance: l.balanceCents, payment: l.minimumPaymentCents }]));
    const contributions=scenario.contributions.map(rule=>({...rule,percentBps:rule.percentBps??undefined,monthlyAmountCents:rule.monthlyAmountCents??undefined,targetBalanceCents:rule.targetBalanceCents??undefined,overflowDestinationType:rule.overflowDestinationType??undefined,overflowDestinationId:rule.overflowDestinationId??undefined}));
    if(new Set(contributions.map(x=>x.id)).size!==contributions.length||new Set(contributions.map(x=>`${x.destinationType}:${x.destinationId}`)).size!==contributions.length)throw new RangeError("Contribution rules and destinations must be unique");
    if(contributions.some(x=>(x.percentBps===undefined)===(x.monthlyAmountCents===undefined)||x.percentBps!==undefined&&x.percentBps<=0||x.monthlyAmountCents!==undefined&&x.monthlyAmountCents<=0)||contributions.reduce((sum,x)=>sum+(x.percentBps??0),0)>10000)throw new RangeError("Each contribution needs one positive percentage or monthly amount, and percentages may total no more than 100%");
    const fallback=(scenario.defaultContributionAccountId?accounts.get(scenario.defaultContributionAccountId):undefined)??[...accounts.values()].find(item=>item.liquid&&(item.kind==="checking"||item.kind==="savings"))??accounts.values().next().value;
    if(!fallback)throw new RangeError("At least one account is required to retain projected surplus");
    const pending=new Map(contributions.map(rule=>[rule.id,0]));
    // Stored JSON array order is not part of the calculation contract.
    const events = [...scenario.events].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const propertyEvents=events.filter((event):event is Extract<(typeof events)[number],{type:"asset-purchase"}>=>event.type==="asset-purchase");
    const propertyStatus=new Map<string,PropertyProjectionStatus>(propertyEvents.map(event=>[event.assetId,"planned"]));
    const propertyShortfall=new Map<string,number>(),aduActive=new Set<string>(),aduBuildResults=new Map<string,{costCents:number;addedValueCents:number}>();
    const planned=[...Array(scenario.horizon.months)].map((_,index)=>{const date=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+index,1)),key=monthKey(date);let gross=0,pretax=0;for(const entry of snapshot.recurring){const count=occurrences(entry,key);if(!count)continue;const changes=events.filter(e=>(e.type==="recurring-change"||e.type==="income-change")&&e.entryId===entry.id&&e.date.slice(0,7)<=key);const base=changes.length?(changes.at(-1)! as {amountCents:number}).amountCents:entry.amountCents,value=recurringAmount(entry,base,key,entry.annualGrowthBps??(entry.kind==="expense"?scenario.assumptions.inflationBps:0),index,count);if(entry.kind==="income")gross+=value;else if(entry.taxTreatment==="pretax")pretax+=value;}for(const event of events.filter(e=>e.date.slice(0,7)===key))if(event.type==="one-time-income")gross+=event.amountCents;return {key,year:date.getUTCFullYear(),gross,pretax};});
    const vestIncomeByMonth=new Map<string,number>();
    const vestOwnerByMonth=new Map<string,Map<string,number>>();
    for(const asset of snapshot.assets.filter(asset=>asset.equityHolding))for(const grant of asset.equityHolding!.grants)for(const event of grant.vestEvents){const key=event.date.slice(0,7),value=vestValue(asset.equityHolding!,event);vestIncomeByMonth.set(key,(vestIncomeByMonth.get(key)??0)+value);const owners=vestOwnerByMonth.get(key)??new Map<string,number>();owners.set(grant.ownerPersonId,(owners.get(grant.ownerPersonId)??0)+value);vestOwnerByMonth.set(key,owners);}
    for(const original of snapshot.assets.filter(asset=>asset.privateStock?.taxOnVest)){
      let value=original.valueCents;
      let previousBps=vestedBpsAtDate(original,monthKey(addMonths(start,-1))+"-01");
      for(let index=0;index<scenario.horizon.months;index++){
        const date=addMonths(start,index),key=monthKey(date);
        value=grow(value,appreciationRateForYear(original,date.getUTCFullYear()),1);
        const currentBps=vestedBpsAtDate(original,`${key}-01`);
        const vestedIncome=Math.max(0,Math.round(value*(currentBps-previousBps)/10000));
        if(vestedIncome)vestIncomeByMonth.set(key,(vestIncomeByMonth.get(key)??0)+vestedIncome);
        previousBps=currentBps;
      }
    }
    const taxByMonth=new Map<string,number>(),stockTaxByMonth=new Map<string,number>(),taxLedgerByYear=new Map<number,import("./types").TaxLedger>();
    for(const year of new Set(planned.map(x=>x.year))){
      const rows=planned.filter(x=>x.year===year),gross=rows.reduce((s,x)=>s+x.gross,0),pretax=rows.reduce((s,x)=>s+x.pretax,0),stockGross=rows.reduce((sum,row)=>sum+(vestIncomeByMonth.get(row.key)??0),0),base=snapshot.taxProfile.taxYear===2025?TAX_RULES_2025:TAX_RULES_2026;
      const estimate=(wages:number,deductions=pretax)=>estimateTax({grossWageIncomeCents:wages,federalDeductionCents:deductions,californiaDeductionCents:deductions,ficaExemptWagesCents:0},snapshot.taxProfile.filingStatus,base,year>base.year).totalCents;
      const wageTax=estimate(gross);
      let annualHouseholdGross=0,annualHouseholdPretax=0;
      const memberIds=snapshot.taxProfile.taxUnit?.memberPersonIds??[],employeeWages=new Map(memberIds.map(id=>[id,{salaryCents:0,rsuCents:0}])),explicitTaxUnit=Boolean(snapshot.taxProfile.taxUnit);
      let annualNonWage=0;
      for(let calendarMonth=0;calendarMonth<12;calendarMonth++){
        const date=new Date(Date.UTC(year,calendarMonth,1)),key=monthKey(date),growthMonth=(year-start.getUTCFullYear())*12+calendarMonth-start.getUTCMonth();
        for(const entry of snapshot.recurring){const count=occurrences(entry,key);if(!count)continue;const changes=events.filter(e=>(e.type==="recurring-change"||e.type==="income-change")&&e.entryId===entry.id&&e.date.slice(0,7)<=key),amount=changes.length?(changes.at(-1)! as {amountCents:number}).amountCents:entry.amountCents,value=recurringAmount(entry,amount,key,entry.annualGrowthBps??(entry.kind==="expense"?scenario.assumptions.inflationBps:0),growthMonth,count);if(entry.kind==="income"){annualHouseholdGross+=value;if(explicitTaxUnit){const category=entry.incomeTaxCategory??(entry.incomeType==="salary"?"wages":"taxable-nonwage");if(category==="wages"){if(!entry.ownerPersonId||!employeeWages.has(entry.ownerPersonId))throw new RangeError("Wage income requires an owner in the tax unit");employeeWages.get(entry.ownerPersonId)!.salaryCents+=value;}else if(category==="taxable-nonwage")annualNonWage+=value;}}else if(entry.taxTreatment==="pretax")annualHouseholdPretax+=value;}
        for(const event of events.filter(e=>e.date.slice(0,7)===key))if(event.type==="one-time-income"){annualHouseholdGross+=event.amountCents;if(explicitTaxUnit){const category=event.incomeTaxCategory??"taxable-nonwage";if(category==="wages"){if(!event.ownerPersonId||!employeeWages.has(event.ownerPersonId))throw new RangeError("One-time wages require an owner in the tax unit");employeeWages.get(event.ownerPersonId)!.salaryCents+=event.amountCents;}else if(category==="taxable-nonwage")annualNonWage+=event.amountCents;}}
        for(const [owner,value] of vestOwnerByMonth.get(key)??[])if(employeeWages.has(owner))employeeWages.get(owner)!.rsuCents+=value;
      }
      if(explicitTaxUnit){
        const employees=[...employeeWages].map(([personId,wage])=>({personId,...wage})),annualBaseIncome=employees.reduce((sum,item)=>sum+item.salaryCents,0)+annualNonWage,futureBaseIncome=rows.reduce((sum,row)=>sum+row.gross,0),baseRatio=annualBaseIncome?Math.min(10000,Math.round(futureBaseIncome*10000/annualBaseIncome)):0;
        const housingDeductions=annualHousingDeductions(snapshot,year),deductions={traditionalRetirementCents:annualHouseholdPretax,...housingDeductions};
        const estimateWithStateTax=(wageRows:typeof employees)=>{const first=estimateHouseholdTax({year,status:snapshot.taxProfile.filingStatus,employees:wageRows,nonWageTaxableCents:annualNonWage,deductions,thresholdInflationBps:scenario.assumptions.thresholdInflationBps});return estimateHouseholdTax({year,status:snapshot.taxProfile.filingStatus,employees:wageRows,nonWageTaxableCents:annualNonWage,deductions:{...deductions,stateIncomeTaxCents:first.californiaCents},thresholdInflationBps:scenario.assumptions.thresholdInflationBps});},fullLedger=estimateWithStateTax(employees),noRsu=estimateWithStateTax(employees.map(item=>({...item,rsuCents:0}))),futureRsuByOwner=new Map<string,number>();for(const row of rows)for(const [owner,value] of vestOwnerByMonth.get(row.key)??[])futureRsuByOwner.set(owner,(futureRsuByOwner.get(owner)??0)+value);const withoutFutureRsu=estimateWithStateTax(employees.map(item=>({...item,rsuCents:Math.max(0,item.rsuCents-(futureRsuByOwner.get(item.personId)??0))}))),stockTax=Math.max(0,fullLedger.fullYearLiabilityCents-withoutFutureRsu.fullYearLiabilityCents),wageTax=Math.round(noRsu.fullYearLiabilityCents*baseRatio/10_000),ledger={...fullLedger,futureCashFlowCents:wageTax+stockTax};taxLedgerByYear.set(year,ledger);
        const allocate=(total:number,weights:number[])=>{const weight=weights.reduce((s,x)=>s+x,0),values=weights.map(value=>weight?Math.floor(total*value/weight):0);let remainder=total-values.reduce((s,x)=>s+x,0);for(let i=0;remainder>0&&i<values.length;i++,remainder--)values[i]++;return values;},wageAllocated=allocate(wageTax,rows.map(x=>Math.max(0,x.gross-x.pretax))),stockAllocated=allocate(stockTax,rows.map(x=>vestIncomeByMonth.get(x.key)??0));rows.forEach((row,i)=>{taxByMonth.set(row.key,wageAllocated[i]+stockAllocated[i]);stockTaxByMonth.set(row.key,stockAllocated[i]);});continue;
      }
      const stockTax=Math.max(0,estimate(annualHouseholdGross+stockGross,annualHouseholdPretax)-estimate(annualHouseholdGross,annualHouseholdPretax));
      const allocate=(total:number,weights:number[])=>{const weight=weights.reduce((s,x)=>s+x,0),values=weights.map(value=>weight?Math.floor(total*value/weight):0);let remainder=total-values.reduce((s,x)=>s+x,0);for(let i=0;remainder>0&&i<values.length;i++,remainder--)values[i]++;return values;};
      const wageAllocated=allocate(wageTax,rows.map(x=>Math.max(0,x.gross-x.pretax))),stockAllocated=allocate(stockTax,rows.map(x=>vestIncomeByMonth.get(x.key)??0));
      rows.forEach((row,i)=>{taxByMonth.set(row.key,wageAllocated[i]+stockAllocated[i]);stockTaxByMonth.set(row.key,stockAllocated[i]);});
    }
    const months: MonthlyProjection[] = [];
    for (let month = 0; month < asOf.getUTCMonth(); month++) {
      const key = `${asOf.getUTCFullYear()}-${String(month + 1).padStart(2, "0")}`;
      const actual = snapshot.actuals?.filter(x => x.date.slice(0, 7) === key) ?? [];
      const income = actual.filter(x => x.kind === "income").reduce((s, x) => s + Math.abs(x.amountCents), 0);
      const expense = actual.filter(x => x.kind === "expense").reduce((s, x) => s + Math.abs(x.amountCents), 0);
      months.push({month:key,status:"actual",incomeCents:income,expenseCents:expense,actualIncomeCents:income,actualExpenseCents:expense,incomeVarianceCents:0,expenseVarianceCents:0,taxCents:0,cashTaxCents:0,rsuSellToCoverTaxCents:0,surplusCents:income-expense,liquidWorthCents:null,netWorthCents:null,debtCents:null,balances:null,unfundedDeficitCents:0,contributionCents:0,contributionResults:[],principalAndInterestCents:0,housingCostCents:0,properties:[],warnings:[]});
    }
    let cumulativeDeficit = 0;
    for (let index = 0; index < scenario.horizon.months; index++) {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1)), key = monthKey(date);
      const warnings: ProjectionWarning[] = [];
      const account = (id: string) => { const value = accounts.get(id); if (!value) throw new RangeError(`Unknown account: ${id}`); return value; };
      const debt = (id: string) => { const value = debts.get(id); if (!value) throw new RangeError(`Unknown liability: ${id}`); return value; };
      for (const account of accounts.values()) account.balance = grow(account.balance, account.annualReturnBps, 1);
      for (const asset of assets.values()) { const rate=appreciationRateForYear(asset,date.getUTCFullYear());asset.value = grow(asset.value,rate,1);asset.withheld=grow(asset.withheld,rate,1); }
      let income = 0, expense = 0;
      for (const entry of snapshot.recurring) {
        const count = occurrences(entry, key);
        if (!count) continue;
        const changes = events.filter(e => (e.type === "recurring-change" || e.type === "income-change") && e.entryId === entry.id && e.date.slice(0, 7) <= key);
        const base = changes.length ? (changes.at(-1)! as { amountCents: number }).amountCents : entry.amountCents;
        const value = recurringAmount(entry,base,key,entry.annualGrowthBps ?? (entry.kind === "expense" ? scenario.assumptions.inflationBps : 0),index,count);
        if (entry.kind === "income") income += value; else {expense += value;if(entry.taxTreatment==="pretax"){if(!entry.accountId||accountKind(snapshot,entry.accountId)!=="retirement")throw new RangeError("Pre-tax contributions require a retirement destination account");account(entry.accountId).balance+=value;}}
      }
      const currentEvents = events.filter(e => e.date.slice(0, 7) === key);
      const fundEvent=(event:{id:string;fundingAccountId:string;fundingSources?:readonly {accountId:string;capCents?:number|null}[]},needed:number)=>{
        const sources=event.fundingSources?.length?event.fundingSources:[{accountId:event.fundingAccountId}];
        const available=sources.reduce((sum,source)=>sum+Math.min(Math.max(0,account(source.accountId).balance),source.capCents??Number.POSITIVE_INFINITY),0);
        if(available<needed){warnings.push({code:"event-unfunded",message:`${needed-available} cents are still needed; this event was not executed.`,month:key,entityId:event.id,inputField:"fundingSources"});return false}
        let remaining=needed;for(const source of sources){const target=account(source.accountId),draw=Math.min(remaining,Math.max(0,target.balance),source.capCents??Number.POSITIVE_INFINITY);target.balance-=draw;remaining-=draw;if(!remaining)break}return true;
      };
      for (const event of currentEvents) {
        if (event.type === "one-time-income") income += event.amountCents;
        else if (event.type === "one-time-expense") expense += event.amountCents;
        else if (event.type === "account-contribution") account(event.accountId).balance += event.amountCents;
        else if (event.type === "account-transfer") { account(event.fromAccountId).balance -= event.amountCents; account(event.toAccountId).balance += event.amountCents; }
        else if (event.type === "asset-purchase") {
          const required=event.downPaymentCents+event.costsCents;
          const sources=event.fundingSources?.length?event.fundingSources:[{accountId:event.fundingAccountId}],available=sources.reduce((sum,source)=>sum+Math.min(Math.max(0,account(source.accountId).balance),source.capCents??Number.POSITIVE_INFINITY),0);
          if(!fundEvent(event,required)){propertyStatus.set(event.assetId,"unfunded");propertyShortfall.set(event.assetId,Math.max(0,required-available));continue;}
          propertyStatus.set(event.assetId,"active");propertyShortfall.set(event.assetId,0);
          assets.set(event.assetId, { id: event.assetId, name: event.name, valueCents: event.valueCents, value: event.valueCents, withheld:0, annualGrowthBps: event.annualGrowthBps, housingCosts:event.housingCosts,purchasePriceCents:event.valueCents,purchaseDate:event.date });
          if (event.financing) debts.set(event.financing.liabilityId, { id: event.financing.liabilityId, name: event.financing.name, balanceCents: event.financing.principalCents, balance: event.financing.principalCents, annualRateBps: event.financing.annualRateBps, minimumPaymentCents: event.financing.minimumPaymentCents, payment: event.financing.minimumPaymentCents, mortgage:{originalPrincipalCents:event.financing.principalCents,termMonths:event.financing.termMonths??event.propertyDetails?.mortgageTermMonths??360,startDate:event.date,assetId:event.assetId} });
        } else if(event.type==="adu-build") {
          if(!assets.has(event.assetId)){warnings.push({code:"event-unfunded",message:"The ADU build was skipped because its property is not owned.",month:key,entityId:event.id,inputField:"assetId"});continue}
          if(!fundEvent(event,event.costCents))continue;
          const target=assets.get(event.assetId)!;
          if(!Number.isInteger(event.homeSquareFeet)||event.homeSquareFeet<=0||!Number.isInteger(event.aduSquareFeet)||event.aduSquareFeet<=0)throw new RangeError("ADU builds require positive home and ADU square footage");
          const addedValueCents=Math.round(target.value/event.homeSquareFeet*event.aduSquareFeet);
          target.value+=addedValueCents;
          aduBuildResults.set(`${event.assetId}:${key}`,{costCents:event.costCents,addedValueCents});
          aduActive.add(event.assetId);
        } else if (event.type === "debt-origination") {
          account(event.accountId).balance += event.principalCents;
          debts.set(event.liabilityId, { id: event.liabilityId, name: event.name, balanceCents: event.principalCents, balance: event.principalCents, annualRateBps: event.annualRateBps, minimumPaymentCents: event.minimumPaymentCents, payment: event.minimumPaymentCents });
        } else if (event.type === "debt-payoff") { const d = debt(event.liabilityId), paid = Math.min(d.balance, event.amountCents ?? d.balance); account(event.accountId).balance -= paid; d.balance -= paid;
        } else if (event.type === "asset-sale") {
          if (!assets.has(event.assetId)) {
            if(propertyEvents.some(item=>item.assetId===event.assetId)){warnings.push({code:"event-unfunded",message:"The sale was skipped because its planned property is not owned.",month:key,entityId:event.id,inputField:"assetId"});continue;}
            throw new RangeError(`Unknown asset: ${event.assetId}`);
          }
          assets.delete(event.assetId);propertyStatus.set(event.assetId,"sold"); let payoff = 0;
          if (event.payoff && event.payoff.mode !== "none") { const d = debt(event.payoff.liabilityId); payoff = Math.min(d.balance, event.payoff.mode === "full" ? d.balance : event.payoff.amountCents ?? 0); d.balance -= payoff; }
          account(event.destinationAccountId).balance += event.proceedsCents - event.costsCents - payoff;
        }
      }
      let housingCostCents=0,principalAndInterestCents=0;
      const propertyCosts=new Map<string,{propertyTaxCents:number;insuranceCents:number;hoaCents:number;maintenanceCents:number}>();
      for(const item of assets.values()) if(item.housingCosts){
        const age=Math.max(0,index);
        const propertyTaxCents=Math.round(californiaAssessedValue(item,key,asOfMonth)*item.housingCosts.propertyTaxRateBps/120000),insuranceCents=grow(item.housingCosts.insuranceMonthlyCents,item.housingCosts.insuranceAnnualGrowthBps,age),hoaCents=grow(item.housingCosts.hoaMonthlyCents,item.housingCosts.hoaAnnualGrowthBps,age),purchase=propertyEvents.find(event=>event.assetId===item.id),maintenanceCents=Math.round(item.value*(purchase?.propertyDetails?.maintenanceBps??purchase?.maintenanceBps??0)/120000);
        propertyCosts.set(item.id,{propertyTaxCents,insuranceCents,hoaCents,maintenanceCents});housingCostCents+=propertyTaxCents+insuranceCents+hoaCents+maintenanceCents;
      }
      expense+=housingCostCents;
      const mortgageParts=new Map<string,{principalCents:number;interestCents:number}>();
      for (const item of debts.values()) { if (item.balance <= 0) continue; const interest=Math.round(item.balance * item.annualRateBps / 120_000),due = item.balance + interest; const paid = Math.min(item.payment, due),principal=Math.max(0,paid-interest); if(item.payment<interest)warnings.push({code:"payment-below-interest",message:`${item.name}'s payment is below monthly interest.`,month:key,entityId:item.id,inputField:"minimumPaymentCents"}); expense += paid; principalAndInterestCents+=paid;item.balance = due - paid;if(item.mortgage?.assetId)mortgageParts.set(item.mortgage.assetId,{principalCents:principal,interestCents:interest}); }
      const properties:PropertyProjectionResult[]=propertyEvents.map(event=>{
        const state=propertyStatus.get(event.assetId)??"planned",asset=assets.get(event.assetId),loan=event.financing?debts.get(event.financing.liabilityId):undefined,cost=propertyCosts.get(event.assetId)??{propertyTaxCents:0,insuranceCents:0,hoaCents:0,maintenanceCents:0},mortgage=mortgageParts.get(event.assetId)??{principalCents:0,interestCents:0},age=monthsBetween(event.date,key),details=event.propertyDetails,rentalTaxModelingEnabled=details?.rentalTaxModelingEnabled??false,rentalShare=(details?.rentalUseBps??((details?.primaryResidence??true)?0:10000))/10000;
        const rent=state==="active"?grow(details?.monthlyRentalIncomeCents??event.monthlyRentalIncomeCents??0,details?.rentalIncomeGrowthBps??event.rentalIncomeGrowthBps??0,age):0,aduIncome=state==="active"&&aduActive.has(event.assetId)?grow(details?.adu?.monthlyRentalIncomeCents??0,details?.adu?.rentalIncomeGrowthBps??details?.rentalIncomeGrowthBps??0,age):0,depreciation=rentalTaxModelingEnabled&&state==="active"?Math.round((details?.buildingBasisCents??Math.round(event.valueCents*.8))*rentalShare/330):0,operating=cost.propertyTaxCents+cost.insuranceCents+cost.hoaCents+cost.maintenanceCents,taxableRental=rentalTaxModelingEnabled?rent+aduIncome-Math.round((mortgage.interestCents+operating)*rentalShare)-depreciation:0;
        income+=rent+aduIncome;
        const aduBuild=aduBuildResults.get(`${event.assetId}:${key}`);
        const rowWarnings:string[]=[];if(state==="unfunded")rowWarnings.push(`Funding shortfall: ${propertyShortfall.get(event.assetId)??0} cents.`);if(!rentalTaxModelingEnabled&&(rent||aduIncome||details===undefined))rowWarnings.push("Rental tax modeling not included");
        return {assetId:event.assetId,liabilityId:event.financing?.liabilityId,name:event.name,month:key,status:state,executionShortfallCents:propertyShortfall.get(event.assetId)??0,assetValueCents:state==="active"?asset?.value??null:null,mortgageBalanceCents:state==="active"?(loan?.balance??0):null,equityCents:state==="active"&&asset?asset.value-(loan?.balance??0):null,purchaseCashCents:key===event.date.slice(0,7)&&state==="active"?event.downPaymentCents+event.costsCents:0,rentCents:rent,principalCents:mortgage.principalCents,interestCents:mortgage.interestCents,...cost,aduCostCents:aduBuild?.costCents??0,aduAddedValueCents:aduBuild?.addedValueCents??0,aduIncomeCents:aduIncome,depreciationCents:depreciation,taxableRentalCents:taxableRental,federalAllowedRentalCents:taxableRental,californiaAllowedRentalCents:taxableRental,federalPassiveCarryforwardCents:0,californiaPassiveCarryforwardCents:0,estimatedTaxEffectCents:0,rentalTaxModelingEnabled,warnings:rowWarnings};
      });
      const tax = taxByMonth.get(key)??0,stockTax=stockTaxByMonth.get(key)??0;
      let coveredStockTax=0;
      if(stockTax){const taxable=[...assets.values()].filter(item=>item.privateStock?.taxOnVest||item.equityHolding),weights=taxable.map(item=>item.equityHolding?item.equityHolding.grants.flatMap(grant=>grant.vestEvents).filter(event=>event.date.slice(0,7)===key).reduce((sum,event)=>sum+vestValue(item.equityHolding!,event),0):(()=>{const previous=vestedBpsAtDate(item,monthKey(addMonths(date,-1))+"-01"),current=vestedBpsAtDate(item,`${key}-01`);return Math.max(0,Math.round(item.value*(current-previous)/10000));})()),total=weights.reduce((sum,value)=>sum+value,0);let assigned=0;taxable.forEach((item,i)=>{const amount=i===taxable.length-1?stockTax-assigned:(total?Math.floor(stockTax*weights[i]/total):0),sellToCover=item.equityHolding?.sellToCover??item.privateStock?.taxOnVest??false;if(sellToCover){item.withheld+=amount;coveredStockTax+=amount;}assigned+=amount;});}
      const surplus = income - expense - (tax-coveredStockTax);
      let unfunded = 0, contributionCents=0;
      const contributionResults:ContributionResult[]=[];
      if (surplus > 0) {
        fallback.balance+=surplus;
        let afterFixed=surplus;const shares=new Map<string,number>();
        for(const rule of contributions.filter(item=>item.monthlyAmountCents!==undefined)){const share=Math.min(afterFixed,rule.monthlyAmountCents!);shares.set(rule.id,share);afterFixed-=share;}
        for(const rule of contributions.filter(item=>item.percentBps!==undefined))shares.set(rule.id,Math.floor(afterFixed*rule.percentBps!/10000));
        for(const rule of contributions){
          const share=shares.get(rule.id)??0;pending.set(rule.id,(pending.get(rule.id)??0)+share);
          const dates=contributionDates(asOf,rule.frequency,key);if(!dates.length)continue;
          let amount=pending.get(rule.id)??0;pending.set(rule.id,0);
          const primaryBalance=rule.destinationType==="account"?account(rule.destinationId).balance:rule.destinationType==="asset"?assets.get(rule.destinationId)?.value:debts.get(rule.destinationId)?.balance;
          if(primaryBalance===undefined)continue;
          let remaining=amount,applied=0;
          for(const occurrence of dates){const piece=Math.floor(amount/dates.length)+(dates.indexOf(occurrence)<amount%dates.length?1:0);if(!piece)continue;let used=piece;
            if(rule.destinationType==="account"){const target=account(rule.destinationId);used=Math.min(piece,rule.targetBalanceCents===undefined?piece:Math.max(0,rule.targetBalanceCents-target.balance));target.balance+=withPartialGrowth(used,target.annualReturnBps,occurrence);}
            else if(rule.destinationType==="asset"){const target=assets.get(rule.destinationId),home=target&&Boolean(target.purchasePriceCents||target.purchaseDate||target.housingCosts&&(target.housingCosts.propertyTaxRateBps||target.housingCosts.insuranceMonthlyCents||target.housingCosts.hoaMonthlyCents)||[...debts.values()].some(item=>item.mortgage?.assetId===target.id));if(!target||target.privateStock||home){used=0;}else{used=Math.min(piece,rule.targetBalanceCents===undefined?piece:Math.max(0,rule.targetBalanceCents-target.value));target.value+=withPartialGrowth(used,appreciationRateForYear(target,date.getUTCFullYear()),occurrence);}}
            else {const target=debts.get(rule.destinationId);if(!target||!target.mortgage){used=0;}else{used=Math.min(piece,Math.max(0,target.balance));target.balance-=used;}}
            fallback.balance-=used;remaining-=used;applied+=used;
          }
          const overflow=amount-applied;if(overflow>0&&rule.overflowDestinationId){if(rule.overflowDestinationType==="account"){const target=accounts.get(rule.overflowDestinationId);if(target&&target.id!==rule.destinationId){fallback.balance-=overflow;target.balance+=overflow;}}else{const target=assets.get(rule.overflowDestinationId);if(target&&!target.privateStock&&!target.housingCosts&&target.id!==rule.destinationId){fallback.balance-=overflow;target.value+=overflow;}}}
          if(applied){contributionCents+=applied;contributionResults.push({ruleId:rule.id,destinationType:rule.destinationType,destinationId:rule.destinationId,amountCents:applied});}
        }
      } else if (surplus < 0) { let remaining=-surplus; const ordered=[...scenario.withdrawals].sort((a,b)=>a.priority-b.priority).map(r=>account(r.accountId)); for(const source of ordered){const drawn=Math.min(Math.max(0,source.balance),remaining);source.balance-=drawn;remaining-=drawn;if(source.balance===0&&drawn>0)warnings.push({code:"account-depleted",message:`${source.name} was depleted.`,month:key,entityId:source.id,inputField:"withdrawals"});if(!remaining)break;} unfunded=remaining; cumulativeDeficit+=unfunded; if(unfunded)warnings.push({code:"unfunded-deficit",message:`${unfunded} cents of the deficit could not be funded.`,month:key,inputField:"withdrawals"}); }
      const liquid = [...accounts.values()].filter(a => a.liquid).reduce((s, a) => s + a.balance, 0) - cumulativeDeficit;
      const accountTotal = [...accounts.values()].reduce((s, a) => s + a.balance, 0), assetTotal = [...assets.values()].reduce((s, a) => s + Math.max(0,(a.equityHolding?vestedEquityValue(a,`${key}-01`):vestedAssetValue(a,`${key}-01`))-a.withheld), 0), debtTotal = [...debts.values()].reduce((s, d) => s + d.balance, 0);
      const actual=snapshot.actuals?.filter(x=>x.date.slice(0,7)===key)??[], actualIncome=actual.filter(x=>x.kind==="income").reduce((s,x)=>s+Math.abs(x.amountCents),0),actualExpense=actual.filter(x=>x.kind==="expense").reduce((s,x)=>s+Math.abs(x.amountCents),0),status=key<asOfMonth?"actual":key===asOfMonth?"blended":"projected";
      const balanceDate=`${key}-01`;
      const balances={
        accounts:Object.fromEntries([...accounts].map(([id,item])=>[id,item.balance])),
        assets:Object.fromEntries([...assets].filter(([,item])=>!item.privateStock&&!item.equityHolding).map(([id,item])=>[id,item.value])),
        privateStock:Object.fromEntries([...assets].filter(([,item])=>item.privateStock||item.equityHolding).map(([id,item])=>{const grossVested=item.equityHolding?vestedEquityValue(item,balanceDate):vestedAssetValue(item,balanceDate),total=item.equityHolding?item.equityHolding.grants.reduce((sum,grant)=>sum+valueForUnits(grant.unitsMicros,projectedSharePrice(item.equityHolding!,balanceDate)),0):item.value,vestedCents=Math.max(0,grossVested-item.withheld);return [id,{vestedCents,unvestedCents:Math.max(0,total-grossVested)}];})),
        liabilities:Object.fromEntries([...debts].map(([id,item])=>[id,Math.max(0,item.balance)])),
      };
      months.push({ month: key, status, incomeCents: income, expenseCents: expense, actualIncomeCents:actualIncome,actualExpenseCents:actualExpense,incomeVarianceCents:actualIncome-income,expenseVarianceCents:actualExpense-expense,taxCents: tax,cashTaxCents:tax-coveredStockTax,rsuSellToCoverTaxCents:coveredStockTax, surplusCents: surplus, contributionCents,contributionResults, liquidWorthCents: liquid, netWorthCents: accountTotal + assetTotal - debtTotal - cumulativeDeficit, debtCents: debtTotal, balances, unfundedDeficitCents: unfunded,principalAndInterestCents,housingCostCents,properties,warnings });
    }
    const grouped = new Map<number, MonthlyProjection[]>();
    for (const month of months) { const year = Number(month.month.slice(0, 4)); grouped.set(year, [...(grouped.get(year) ?? []), month]); }
    return [...grouped].map(([year, items]) => {const income=sum(items,"incomeCents"),surplus=sum(items,"surplusCents"),properties=propertyEvents.map(event=>aggregateProperty(year,event.assetId,items));return ({ year, incomeCents:income,actualIncomeCents:sum(items,"actualIncomeCents"),actualExpenseCents:sum(items,"actualExpenseCents"), expenseCents: sum(items, "expenseCents"), taxCents: sum(items, "taxCents"),cashTaxCents:sum(items,"cashTaxCents"),rsuSellToCoverTaxCents:sum(items,"rsuSellToCoverTaxCents"),taxLedger:taxLedgerByYear.get(year), savingsRateBps:income?Math.round(Math.max(0,surplus)*10000/income):0,surplusCents:surplus,contributionCents:sum(items,"contributionCents"),contributionResults:items.flatMap(x=>x.contributionResults), liquidWorthCents: items.at(-1)!.liquidWorthCents, endingNetWorthCents: items.at(-1)!.netWorthCents, debtCents: items.at(-1)!.debtCents, debtPayoffMonth:items.find(x=>x.debtCents===0)?.month, unfundedDeficitCents: sum(items, "unfundedDeficitCents"),properties, warnings: items.flatMap(x => x.warnings), months: items });});
  }
} as const;

function sum(items: MonthlyProjection[], key: "incomeCents" | "expenseCents" | "actualIncomeCents" | "actualExpenseCents" | "taxCents"|"cashTaxCents"|"rsuSellToCoverTaxCents" | "surplusCents" | "unfundedDeficitCents"|"contributionCents") { return items.reduce((total, item) => total + item[key], 0); }
function accountKind(snapshot:FinancialSnapshot,id:string){return snapshot.accounts.find(x=>x.id===id)?.kind;}
function aggregateProperty(year:number,assetId:string,items:readonly MonthlyProjection[]):PropertyProjectionResult{const rows=items.flatMap(item=>item.properties).filter(item=>item.assetId===assetId),last=rows.at(-1)!;const total=(key:keyof PropertyProjectionResult)=>rows.reduce((sum,row)=>sum+(typeof row[key]==="number"?(row[key] as number):0),0);return {...last,month:undefined,year,purchaseCashCents:total("purchaseCashCents"),rentCents:total("rentCents"),principalCents:total("principalCents"),interestCents:total("interestCents"),propertyTaxCents:total("propertyTaxCents"),insuranceCents:total("insuranceCents"),hoaCents:total("hoaCents"),maintenanceCents:total("maintenanceCents"),aduCostCents:total("aduCostCents"),aduAddedValueCents:total("aduAddedValueCents"),aduIncomeCents:total("aduIncomeCents"),depreciationCents:total("depreciationCents"),taxableRentalCents:total("taxableRentalCents"),federalAllowedRentalCents:total("federalAllowedRentalCents"),californiaAllowedRentalCents:total("californiaAllowedRentalCents"),estimatedTaxEffectCents:total("estimatedTaxEffectCents"),warnings:[...new Set(rows.flatMap(row=>row.warnings))]};}
