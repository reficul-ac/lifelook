import type { TaxLedger } from "./domain";

const money=(cents:number)=>new Intl.NumberFormat("en-US",{
  style:"currency",currency:"USD",minimumFractionDigits:Math.abs(cents)%100===0?0:2,maximumFractionDigits:2,
}).format(cents/100);

export function PlanningTaxLedgerDeductions({ledger}:{ledger:TaxLedger}){
  const federal=ledger.federalMortgageInterestDeductionCents??ledger.mortgageInterestCents??0;
  const california=ledger.californiaMortgageInterestDeductionCents??ledger.mortgageInterestCents??0;
  return <dl className="planning-tax-deductions">
    <div><dt>Federal deductible mortgage interest</dt><dd aria-label={`Federal deductible mortgage interest: ${money(federal)}`}>{money(federal)}</dd></div>
    <div><dt>California deductible mortgage interest</dt><dd aria-label={`California deductible mortgage interest: ${money(california)}`}>{money(california)}</dd></div>
  </dl>;
}
