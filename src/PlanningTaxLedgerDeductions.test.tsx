import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PlanningTaxLedgerDeductions } from "./PlanningTaxLedgerDeductions";
import type { TaxLedger } from "./domain";

it("shows the distinct federal and California capped mortgage-interest deductions",()=>{
  const ledger={
    federalMortgageInterestDeductionCents:1_200_000,
    californiaMortgageInterestDeductionCents:1_600_000,
  } as TaxLedger;

  render(<PlanningTaxLedgerDeductions ledger={ledger}/>);

  expect(screen.getByText("Federal deductible mortgage interest")).toBeInTheDocument();
  expect(screen.getByLabelText("Federal deductible mortgage interest: $12,000")).toBeInTheDocument();
  expect(screen.getByText("California deductible mortgage interest")).toBeInTheDocument();
  expect(screen.getByLabelText("California deductible mortgage interest: $16,000")).toBeInTheDocument();
});
