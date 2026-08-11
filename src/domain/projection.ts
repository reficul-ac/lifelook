import { estimateTax, TAX_RULES_2025, TAX_RULES_2026 } from "./tax";
import type { AnnualProjection, FinancialSnapshot, GoalFundingResult, MonthlyProjection, ProjectionWarning, RecurringEntry, Scenario, ScenarioGoal } from "./types";

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
const grow = (cents: number, bps: number, months: number) => Math.round(cents * Math.pow(1 + bps / 10_000, months / 12));
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
export function requiredMonthlyFunding(remainingCents:number, months:number, annualReturnBps:number):number {
  if (remainingCents <= 0) return 0;
  if (months <= 0) return remainingCents;
  const rate = Math.pow(1 + annualReturnBps / 10_000, 1 / 12) - 1;
  if (Math.abs(rate) < 1e-12) return Math.ceil(remainingCents / months);
  const factor = (Math.pow(1 + rate, months) - 1) / rate;
  if (factor <= 0 || !Number.isFinite(factor)) return Math.ceil(remainingCents / months);
  return Math.max(0, Math.ceil(remainingCents / factor));
}
const monthsUntil=(month:string,date:string)=>{const a=isoDate(`${month}-01`),b=isoDate(date);return Math.max(0,(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()+1)};
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

export const ProjectionEngine = {
  calculate(snapshot: FinancialSnapshot, scenario: Scenario, asOfDate: string): readonly AnnualProjection[] {
    if (scenario.horizon.months < 1 || scenario.horizon.months > 480) throw new RangeError("Projection horizon must be between 1 and 480 months");
    const asOf = isoDate(asOfDate), asOfMonth = monthKey(asOf);
    const start = new Date(`${asOfMonth}-01T00:00:00Z`);
    const accounts = new Map(snapshot.accounts.map(a => [a.id, { ...a, balance: a.balanceCents }]));
    const assets = new Map(snapshot.assets.map(a => [a.id, { ...a, value: a.valueCents }]));
    const debts = new Map(snapshot.liabilities.map(l => [l.id, { ...l, balance: l.balanceCents, payment: l.minimumPaymentCents }]));
    const allGoals=[...scenario.goals];
    if(new Set(allGoals.map(x=>x.id)).size!==allGoals.length) throw new RangeError("Goal ids must be unique");
    const goals=allGoals.filter(x=>x.enabled).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
    if(new Set(goals.map(x=>x.priority)).size!==goals.length) throw new RangeError("Goal priorities must be unique");
    const earmarks=new Map(allGoals.map(x=>[x.id,x.startingEarmarkedCents]));
    const earmarkedByAccount=new Map<string,number>();
    for(const goal of allGoals){const destination=goal.destinationAccountId;const total=(earmarkedByAccount.get(destination)??0)+goal.startingEarmarkedCents;const current=accounts.get(destination);if(!current)throw new RangeError(`Unknown goal destination account: ${destination}`);if(total>current.balance)throw new RangeError("Combined starting goal earmarks exceed the destination account balance");earmarkedByAccount.set(destination,total);}
    // Stored JSON array order is not part of the calculation contract.
    const events = [...scenario.events].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const planned=[...Array(scenario.horizon.months)].map((_,index)=>{const date=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+index,1)),key=monthKey(date);let gross=0,pretax=0;for(const entry of snapshot.recurring){const count=occurrences(entry,key);if(!count)continue;const changes=events.filter(e=>(e.type==="recurring-change"||e.type==="income-change")&&e.entryId===entry.id&&e.date.slice(0,7)<=key);const base=changes.length?(changes.at(-1)! as {amountCents:number}).amountCents:entry.amountCents,value=grow(base,entry.annualGrowthBps??(entry.kind==="expense"?scenario.assumptions.inflationBps:0),index)*count;if(entry.kind==="income")gross+=value;else if(entry.taxTreatment==="pretax")pretax+=value;}for(const event of events.filter(e=>e.date.slice(0,7)===key))if(event.type==="one-time-income")gross+=event.amountCents;return {key,year:date.getUTCFullYear(),gross,pretax};});
    const taxByMonth=new Map<string,number>();
    for(const year of new Set(planned.map(x=>x.year))){const rows=planned.filter(x=>x.year===year),gross=rows.reduce((s,x)=>s+x.gross,0),pretax=rows.reduce((s,x)=>s+x.pretax,0),base=snapshot.taxProfile.taxYear===2025?TAX_RULES_2025:TAX_RULES_2026,total=estimateTax({grossWageIncomeCents:gross,federalDeductionCents:pretax,californiaDeductionCents:pretax,ficaExemptWagesCents:0},snapshot.taxProfile.filingStatus,base,year>base.year).totalCents,weights=rows.map(x=>Math.max(0,x.gross-x.pretax)),weight=weights.reduce((s,x)=>s+x,0),allocated=weights.map(value=>weight?Math.floor(total*value/weight):0);let remainder=total-allocated.reduce((sum,value)=>sum+value,0);for(let i=0;remainder>0&&i<allocated.length;i++,remainder--)allocated[i]++;rows.forEach((row,i)=>taxByMonth.set(row.key,allocated[i]));}
    const months: MonthlyProjection[] = [];
    for (let month = 0; month < asOf.getUTCMonth(); month++) {
      const key = `${asOf.getUTCFullYear()}-${String(month + 1).padStart(2, "0")}`;
      const actual = snapshot.actuals?.filter(x => x.date.slice(0, 7) === key) ?? [];
      const income = actual.filter(x => x.kind === "income").reduce((s, x) => s + Math.abs(x.amountCents), 0);
      const expense = actual.filter(x => x.kind === "expense").reduce((s, x) => s + Math.abs(x.amountCents), 0);
      months.push({month:key,status:"actual",incomeCents:income,expenseCents:expense,actualIncomeCents:income,actualExpenseCents:expense,incomeVarianceCents:0,expenseVarianceCents:0,taxCents:0,surplusCents:income-expense,liquidWorthCents:null,netWorthCents:null,debtCents:null,unfundedDeficitCents:0,allocationCents:0,goalFundingCents:0,goalResults:[],principalAndInterestCents:0,housingCostCents:0,warnings:[]});
    }
    let cumulativeDeficit = 0;
    for (let index = 0; index < scenario.horizon.months; index++) {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1)), key = monthKey(date);
      const warnings: ProjectionWarning[] = [];
      const account = (id: string) => { const value = accounts.get(id); if (!value) throw new RangeError(`Unknown account: ${id}`); return value; };
      const debt = (id: string) => { const value = debts.get(id); if (!value) throw new RangeError(`Unknown liability: ${id}`); return value; };
      for (const account of accounts.values()) account.balance = grow(account.balance, account.annualReturnBps, 1);
      for (const goal of goals) {
        const destination=account(goal.destinationAccountId);
        earmarks.set(goal.id,grow(earmarks.get(goal.id)??0,destination.annualReturnBps,1));
      }
      for (const asset of assets.values()) asset.value = grow(asset.value, asset.annualGrowthBps, 1);
      let income = 0, expense = 0;
      for (const entry of snapshot.recurring) {
        const count = occurrences(entry, key);
        if (!count) continue;
        const changes = events.filter(e => (e.type === "recurring-change" || e.type === "income-change") && e.entryId === entry.id && e.date.slice(0, 7) <= key);
        const base = changes.length ? (changes.at(-1)! as { amountCents: number }).amountCents : entry.amountCents;
        const value = grow(base, entry.annualGrowthBps ?? (entry.kind === "expense" ? scenario.assumptions.inflationBps : 0), index) * count;
        if (entry.kind === "income") income += value; else {expense += value;if(entry.taxTreatment==="pretax"){if(!entry.accountId||accountKind(snapshot,entry.accountId)!=="retirement")throw new RangeError("Pre-tax contributions require a retirement destination account");account(entry.accountId).balance+=value;}}
      }
      const currentEvents = events.filter(e => e.date.slice(0, 7) === key);
      for (const event of currentEvents) {
        if (event.type === "one-time-income") income += event.amountCents;
        else if (event.type === "one-time-expense") expense += event.amountCents;
        else if (event.type === "account-contribution") account(event.accountId).balance += event.amountCents;
        else if (event.type === "account-transfer") { account(event.fromAccountId).balance -= event.amountCents; account(event.toAccountId).balance += event.amountCents; }
        else if (event.type === "asset-purchase") {
          account(event.fundingAccountId).balance -= event.downPaymentCents + event.costsCents;
          assets.set(event.assetId, { id: event.assetId, name: event.name, valueCents: event.valueCents, value: event.valueCents, annualGrowthBps: event.annualGrowthBps, housingCosts:event.housingCosts });
          if (event.financing) debts.set(event.financing.liabilityId, { id: event.financing.liabilityId, name: event.financing.name, balanceCents: event.financing.principalCents, balance: event.financing.principalCents, annualRateBps: event.financing.annualRateBps, minimumPaymentCents: event.financing.minimumPaymentCents, payment: event.financing.minimumPaymentCents });
        } else if (event.type === "debt-origination") {
          account(event.accountId).balance += event.principalCents;
          debts.set(event.liabilityId, { id: event.liabilityId, name: event.name, balanceCents: event.principalCents, balance: event.principalCents, annualRateBps: event.annualRateBps, minimumPaymentCents: event.minimumPaymentCents, payment: event.minimumPaymentCents });
        } else if (event.type === "debt-payoff") { const d = debt(event.liabilityId), paid = Math.min(d.balance, event.amountCents ?? d.balance); account(event.accountId).balance -= paid; d.balance -= paid;
        } else if (event.type === "asset-sale") {
          if (!assets.has(event.assetId)) throw new RangeError(`Unknown asset: ${event.assetId}`);
          assets.delete(event.assetId); let payoff = 0;
          if (event.payoff && event.payoff.mode !== "none") { const d = debt(event.payoff.liabilityId); payoff = Math.min(d.balance, event.payoff.mode === "full" ? d.balance : event.payoff.amountCents ?? 0); d.balance -= payoff; }
          account(event.destinationAccountId).balance += event.proceedsCents - event.costsCents - payoff;
        }
      }
      let housingCostCents=0,principalAndInterestCents=0;
      for(const item of assets.values()) if(item.housingCosts){
        const age=Math.max(0,index);
        housingCostCents+=Math.round(item.value*item.housingCosts.propertyTaxRateBps/120000);
        housingCostCents+=grow(item.housingCosts.insuranceMonthlyCents,item.housingCosts.insuranceAnnualGrowthBps,age);
        housingCostCents+=grow(item.housingCosts.hoaMonthlyCents,item.housingCosts.hoaAnnualGrowthBps,age);
      }
      expense+=housingCostCents;
      for (const item of debts.values()) { if (item.balance <= 0) continue; const interest=Math.round(item.balance * item.annualRateBps / 120_000),due = item.balance + interest; const paid = Math.min(item.payment, due); if(item.payment<interest)warnings.push({code:"payment-below-interest",message:`${item.name}'s payment is below monthly interest.`,month:key,entityId:item.id,inputField:"minimumPaymentCents"}); expense += paid; principalAndInterestCents+=paid; item.balance = due - paid; }
      const tax = taxByMonth.get(key)??0;
      const surplus = income - expense - tax;
      let availableSurplus=Math.max(0,surplus),goalFundingCents=0;
      const goalResults:GoalFundingResult[]=[];
      for(const goal of goals){
        const destination="destinationAccountId" in goal?account(goal.destinationAccountId):undefined;
        const earmarked=earmarks.get(goal.id)??0;
        let target=goalTarget(goal,snapshot,debts,key,index,scenario.assumptions.inflationBps),returnBps=destination?.annualReturnBps??0;
        const remaining=Math.max(0,target-earmarked),left=monthsUntil(key,goal.targetDate);
        let required=requiredMonthlyFunding(remaining,left,returnBps);
        let funded=Math.min(required,availableSurplus);availableSurplus-=funded;
        if(funded<required&&goal.allowCashShortfall){let need=required-funded;for(const rule of [...scenario.withdrawals].sort((a,b)=>a.priority-b.priority)){if(destination&&rule.accountId===destination.id)continue;const source=account(rule.accountId),draw=Math.min(Math.max(0,source.balance),need);source.balance-=draw;funded+=draw;need-=draw;if(!need)break;}}
        if(destination){destination.balance+=funded;earmarks.set(goal.id,earmarked+funded);}
        goalFundingCents+=funded;const current=earmarks.get(goal.id)??0;const shortfall=Math.max(0,required-funded),completion=target?Math.min(10000,Math.round(current*10000/target)):10000;const due=goal.targetDate.slice(0,7)<=key;const horizonEnd=monthKey(addMonths(start,scenario.horizon.months-1));const outside=goal.targetDate.slice(0,7)>horizonEnd;const result:GoalFundingResult={goalId:goal.id,requiredCents:required,fundedCents:funded,shortfallCents:shortfall,earmarkedCents:current,targetCents:target,completionBps:completion,projectedCompletionDate:completion>=10000?key:(!shortfall?goal.targetDate.slice(0,7):undefined),targetResult:completion>=10000?"completed":due?"missed":outside?"outside-horizon":shortfall?"infeasible":"on-track"};goalResults.push(result);
        if(shortfall)warnings.push({code:"goal-shortfall",message:`${goal.name} is short by ${shortfall} cents this month.`,month:key,entityId:goal.id,inputField:"goals"});
        if(due&&completion<10000)warnings.push({code:"goal-missed",message:`${goal.name} missed its target.`,month:key,entityId:goal.id,inputField:"targetDate"});
        if(outside&&index===0)warnings.push({code:"goal-outside-horizon",message:`${goal.name} is outside the scenario horizon.`,month:key,entityId:goal.id,inputField:"targetDate"});
      }
      let unfunded = 0, allocationCents=0;
      if (surplus > 0) {
        let remaining = availableSurplus;
        const ordered = [...scenario.allocations].sort((a, b) => a.priority - b.priority);
        if (ordered.length && ordered.at(-1)!.percentBps !== 10_000) throw new RangeError("The final allocation rule must be a 100% catch-all");
        for (const rule of ordered) { const target = account(rule.accountId); let amount = Math.round(remaining * rule.percentBps / 10_000); if (rule.targetBalanceCents !== undefined) amount = Math.min(amount, Math.max(0, rule.targetBalanceCents - target.balance)); target.balance += amount; remaining -= amount; allocationCents+=amount; }
        if (remaining > 0) { const fallback = snapshot.accounts.find(a => a.liquid); if (fallback) account(fallback.id).balance += remaining; }
      } else if (surplus < 0) { let remaining=-surplus; const ordered=[...scenario.withdrawals].sort((a,b)=>a.priority-b.priority).map(r=>account(r.accountId)); for(const source of ordered){const drawn=Math.min(Math.max(0,source.balance),remaining);source.balance-=drawn;remaining-=drawn;if(source.balance===0&&drawn>0)warnings.push({code:"account-depleted",message:`${source.name} was depleted.`,month:key,entityId:source.id,inputField:"withdrawals"});if(!remaining)break;} unfunded=remaining; cumulativeDeficit+=unfunded; if(unfunded)warnings.push({code:"unfunded-deficit",message:`${unfunded} cents of the deficit could not be funded.`,month:key,inputField:"withdrawals"}); }
      const liquid = [...accounts.values()].filter(a => a.liquid).reduce((s, a) => s + a.balance, 0) - cumulativeDeficit;
      const accountTotal = [...accounts.values()].reduce((s, a) => s + a.balance, 0), assetTotal = [...assets.values()].reduce((s, a) => s + a.value, 0), debtTotal = [...debts.values()].reduce((s, d) => s + d.balance, 0);
      const actual=snapshot.actuals?.filter(x=>x.date.slice(0,7)===key)??[], actualIncome=actual.filter(x=>x.kind==="income").reduce((s,x)=>s+Math.abs(x.amountCents),0),actualExpense=actual.filter(x=>x.kind==="expense").reduce((s,x)=>s+Math.abs(x.amountCents),0),status=key<asOfMonth?"actual":key===asOfMonth?"blended":"projected";
      months.push({ month: key, status, incomeCents: income, expenseCents: expense, actualIncomeCents:actualIncome,actualExpenseCents:actualExpense,incomeVarianceCents:actualIncome-income,expenseVarianceCents:actualExpense-expense,taxCents: tax, surplusCents: surplus, allocationCents,goalFundingCents,goalResults, liquidWorthCents: liquid, netWorthCents: accountTotal + assetTotal - debtTotal - cumulativeDeficit, debtCents: debtTotal, unfundedDeficitCents: unfunded,principalAndInterestCents,housingCostCents,warnings });
    }
    const grouped = new Map<number, MonthlyProjection[]>();
    for (const month of months) { const year = Number(month.month.slice(0, 4)); grouped.set(year, [...(grouped.get(year) ?? []), month]); }
    return [...grouped].map(([year, items]) => {const income=sum(items,"incomeCents"),surplus=sum(items,"surplusCents");return ({ year, incomeCents:income,actualIncomeCents:sum(items,"actualIncomeCents"),actualExpenseCents:sum(items,"actualExpenseCents"), expenseCents: sum(items, "expenseCents"), taxCents: sum(items, "taxCents"), savingsRateBps:income?Math.round(Math.max(0,surplus)*10000/income):0,surplusCents:surplus,allocationCents:sum(items,"allocationCents"),goalFundingCents:items.reduce((s,x)=>s+x.goalFundingCents,0),goalResults:items.at(-1)?.goalResults??[], liquidWorthCents: items.at(-1)!.liquidWorthCents, endingNetWorthCents: items.at(-1)!.netWorthCents, debtCents: items.at(-1)!.debtCents, debtPayoffMonth:items.find(x=>x.debtCents===0)?.month, unfundedDeficitCents: sum(items, "unfundedDeficitCents"), warnings: items.flatMap(x => x.warnings), months: items });});
  }
} as const;

function sum(items: MonthlyProjection[], key: "incomeCents" | "expenseCents" | "actualIncomeCents" | "actualExpenseCents" | "taxCents" | "surplusCents" | "unfundedDeficitCents"|"allocationCents") { return items.reduce((total, item) => total + item[key], 0); }
function accountKind(snapshot:FinancialSnapshot,id:string){return snapshot.accounts.find(x=>x.id===id)?.kind;}
function goalTarget(goal:ScenarioGoal,snapshot:FinancialSnapshot,debts:Map<string,{balance:number}>,month:string,index:number,inflationBps:number){
  if(goal.type==="debt-payoff")return debts.get(goal.liabilityId)?.balance??0;
  if(goal.type==="emergency-fund"){const targetIndex=index+monthsUntil(month,goal.targetDate)-1;const monthly=snapshot.recurring.filter(x=>goal.expenseEntryIds.includes(x.id)&&x.kind==="expense").reduce((s,x)=>s+grow(x.amountCents,goal.todayDollarBasis?(x.annualGrowthBps??inflationBps):0,targetIndex),0);return Math.max(goal.minimumTargetCents??0,monthly*goal.coverageMonths);}
  if(goal.type==="education"){const start=isoDate(goal.attendanceStartDate),end=isoDate(goal.attendanceEndDate),years=Math.max(1,Math.ceil(((end.valueOf()-start.valueOf())/86400000+1)/365.25)),toStart=index+monthsUntil(month,goal.attendanceStartDate)-1;let total=0;for(let year=0;year<years;year++)total+=grow(goal.annualCostCents,goal.todayDollarBasis?goal.educationInflationBps:0,toStart+year*12);return total;}
  if(goal.type==="major-purchase")return grow(goal.costCents,goal.todayDollarBasis?inflationBps:0,index+monthsUntil(month,goal.purchaseDate)-1);
  const destination=snapshot.accounts.find(x=>x.id===goal.destinationAccountId);if(!destination)return 0;
  const target=isoDate(goal.targetDate);let months=0;for(const personId of goal.participantIds){const person=snapshot.household.people.find(x=>x.id===personId);const age=goal.planningThroughAges[personId];if(!person?.birthDate)throw new RangeError("Retirement participants need birth dates when planning-through ages are used");const end=new Date(`${person.birthDate}T00:00:00Z`);end.setUTCFullYear(end.getUTCFullYear()+age);months=Math.max(months,(end.getUTCFullYear()-target.getUTCFullYear())*12+end.getUTCMonth()-target.getUTCMonth());}
  const targetOffset=index+monthsUntil(month,goal.targetDate)-1;const spending=grow(goal.desiredSpendingCents,goal.todayDollarBasis?inflationBps:0,targetOffset),healthcare=grow(goal.healthcareCents,goal.todayDollarBasis?goal.healthcareGrowthBps:0,targetOffset);return retirementPresentValue(spending,healthcare,goal.pensions,target,months,destination.annualReturnBps,goal.healthcareGrowthBps);
}
function retirementPresentValue(spending:number,healthcare:number,pensions:readonly {monthlyCents:number;startDate:string}[],target:Date,months:number,annualReturnBps:number,healthcareGrowthBps:number){if(months<=0)return 0;const rate=Math.pow(1+annualReturnBps/10000,1/12)-1;let total=0;for(let index=0;index<months;index++){const date=addMonths(target,index),dateKey=monthKey(date),pension=pensions.filter(item=>item.startDate.slice(0,7)<=dateKey).reduce((sum,item)=>sum+item.monthlyCents,0),cost=spending+grow(healthcare,healthcareGrowthBps,index);total+=Math.max(0,cost-pension)/Math.pow(1+rate,index+1);}return Math.max(0,Math.round(total));}
