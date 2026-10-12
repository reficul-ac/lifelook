import type { CashYear, WageFacts } from '../cash/income';
import type { RsuGrantMonth } from '../equity/rsu';
import type { Account } from '../model/plan';
import { sumCents } from './modified-income';

/** Add noncash compensation to tax wages while retaining the original cash streams. */
export function addRsuWages(cash:CashYear,accounts:readonly Account[],grants:readonly RsuGrantMonth[]):CashYear {
  if(!grants.length)return cash;
  const wages=new Map<string,WageFacts>(cash.wages.map(w=>[JSON.stringify([w.ownerId,w.employerId]),w]));
  for(const account of accounts.filter(a=>a.type==='rsu')) {
    const records=grants.filter(g=>g.accountId===account.id&&g.year===cash.year);
    const key=JSON.stringify([account.ownerId,account.rsu!.employerId]),prior=wages.get(key);
    const monthlyCents=Array.from({length:12},(_,i)=>sumCents([prior?.monthlyCents[i]??0,...records.filter(g=>g.month===i+1).map(g=>g.taxableIncomeCents)]));
    wages.set(key,{ownerId:account.ownerId,employerId:account.rsu!.employerId,monthlyCents,annualCents:sumCents(monthlyCents),streamIds:[...new Set([...(prior?.streamIds??[]),...records.map(g=>g.grantId)])]});
  }
  const months=cash.months.map((month,i)=>({...month,wageCents:sumCents([month.wageCents,...grants.filter(g=>g.year===cash.year&&g.month===i+1).map(g=>g.taxableIncomeCents)])}));
  return {...cash,months,annual:{...cash.annual,wageCents:sumCents(months.map(m=>m.wageCents))},wages:[...wages.values()].sort((a,b)=>a.ownerId.localeCompare(b.ownerId)||a.employerId.localeCompare(b.employerId))};
}
