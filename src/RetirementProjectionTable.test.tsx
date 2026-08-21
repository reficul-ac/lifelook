import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  AvailableRetirementScenarioProjection,
  RetirementProjectionYear,
} from "./domain";
import { RetirementProjectionTable } from "./RetirementProjectionTable";

const firstYear = {
  year: 2042,
  ages: [{ personId: "person", name: "Avery", age: 62 }],
  startingPortfolioCents: 1_000_000_00,
  withdrawalTargetCents: 40_000_00,
  withdrawalFundedCents: 40_000_00,
  otherPreTaxIncomeCents: 0,
  rentalIncomeCents: 18_000_00,
  estimatedTaxCents: 8_500_00,
  earlyPenaltyCents: 0,
  afterTaxIncomeCents: 49_500_00,
  planExpenseCents: 36_000_00,
  housingExpenseCents: 12_000_00,
  surplusCents: 1_500_00,
  shortfallCents: 0,
  destinationBalanceCents: 13_500_00,
  endingNetWorthCents: 1_021_000_00,
  endingBalances: { accounts: {}, assets: {}, liabilities: {} },
  housing: {
    principalCents: 4_000_00,
    interestCents: 5_000_00,
    propertyTaxCents: 2_000_00,
    insuranceCents: 500_00,
    hoaCents: 300_00,
    maintenanceCents: 200_00,
  },
  homeSale: {
    grossSaleValueCents: 900_000_00,
    sellingCostsCents: 54_000_00,
    mortgagePayoffCents: 220_000_00,
    incrementalSaleTaxCents: 31_000_00,
    netProceedsCents: 595_000_00,
  },
  withdrawalSources: [{
    accountId: "traditional-ira",
    taxYear: 2042,
    amountCents: 40_000_00,
    taxableGainCents: 0,
    ordinaryIncomeCents: 40_000_00,
    rothTaxableCents: 0,
    earlyPenaltyCents: 2_000_00,
    federalShortTermGainCents: 0,
    federalLongTermGainCents: 0,
    californiaGainCents: 0,
    taxCharacterSupported: true,
  }],
  warnings: [
    { code: "early-withdrawal", year: 2042, entityId: "traditional-ira", message: "A 10% penalty applies before age 59½." },
    { code: "account-depleted", year: 2042, entityId: "traditional-ira", message: "The account reached zero." },
    { code: "activity-ended", year: 2042, entityId: "rental", message: "Rental activity ended after the sale." },
    { code: "unfunded-spending", year: 2042, message: "Planned spending was not fully funded." },
  ],
} satisfies RetirementProjectionYear;

const secondYear = {
  year: 2043,
  ages: [{ personId: "person", name: "Avery", age: 63 }],
  startingPortfolioCents: 1_021_000_00,
  withdrawalTargetCents: 42_000_00,
  withdrawalFundedCents: 42_000_00,
  otherPreTaxIncomeCents: 0,
  rentalIncomeCents: 18_500_00,
  estimatedTaxCents: 9_000_00,
  earlyPenaltyCents: 0,
  afterTaxIncomeCents: 51_500_00,
  planExpenseCents: 37_000_00,
  housingExpenseCents: 13_000_00,
  surplusCents: 0,
  shortfallCents: 2_500_00,
  destinationBalanceCents: 0,
  endingNetWorthCents: 990_500_00,
  endingBalances: { accounts: {}, assets: {}, liabilities: {} },
  housing: {
    principalCents: 4_200_00,
    interestCents: 5_100_00,
    propertyTaxCents: 2_100_00,
    insuranceCents: 500_00,
    hoaCents: 300_00,
    maintenanceCents: 800_00,
  },
  withdrawalSources: [],
  warnings: [],
} satisfies RetirementProjectionYear;

const projection: AvailableRetirementScenarioProjection<unknown> = {
  available: true,
  summary: {},
  years: [firstYear, secondYear],
};

describe("RetirementProjectionTable", () => {
  // Production mutation caught: omitting a domain-provided annual field or deriving a replacement value hides the reconciled annual projection.
  it("renders each domain annual field in semantic columns without recalculating it", () => {
    render(
      <RetirementProjectionTable
        selectedScenario="keep-homes"
        projection={projection}
        accountNames={{}}
      />,
    );

    expect(screen.getByRole("table", { name: "Keep homes annual projection" })).toBeInTheDocument();
    expect(screen.getByText("Keep homes annual projection — 2-year horizon")).toBeInTheDocument();
    for (const heading of [
      "Year and ages",
      "Starting portfolio",
      "Pre-tax withdrawal",
      "Estimated taxes",
      "After-tax income",
      "Plan expenses",
      "Housing expenses",
      "Surplus / shortfall",
      "Ending destination balance",
      "Ending net worth",
    ]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }

    const firstRow = screen.getByRole("row", { name: /2042.*Avery.*62/ });
    expect(within(firstRow).getByText("$1,000,000")).toBeInTheDocument();
    expect(within(firstRow).getByText("$40,000")).toBeInTheDocument();
    expect(within(firstRow).getByText("$8,500")).toBeInTheDocument();
    expect(within(firstRow).getByText("$49,500")).toBeInTheDocument();
    expect(within(firstRow).getByText("$36,000")).toBeInTheDocument();
    expect(within(firstRow).getByText("$12,000")).toBeInTheDocument();
    expect(within(firstRow).getByText("$1,500")).toBeInTheDocument();
    expect(within(firstRow).getByText("$13,500")).toBeInTheDocument();
    expect(within(firstRow).getByText("$1,021,000")).toBeInTheDocument();
  });

  // Production mutation caught: removing the semantic sign label makes a deficit dependent on red styling alone.
  it("gives a negative shortfall signed visible and accessible copy", () => {
    render(
      <RetirementProjectionTable
        selectedScenario="keep-homes"
        projection={projection}
        accountNames={{}}
      />,
    );

    const secondRow = screen.getByRole("row", { name: /2043.*Avery.*63/ });
    expect(within(secondRow).getByLabelText("Shortfall: negative $2,500")).toHaveTextContent("−$2,500");
  });

  // Production mutation caught: dropping the disclosure's rental or housing inputs leaves annual expenses unexplained.
  it("expands one full-width Keep detail row with rental income and every home-cost component", () => {
    render(
      <RetirementProjectionTable
        selectedScenario="keep-homes"
        projection={projection}
        accountNames={{ "traditional-ira": "Traditional IRA", rental: "Pine rental" }}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "View year details" })[0]!);
    const details = screen.getByText("Rental income").closest(".retirement-year-details")!;
    expect(details).toBeInTheDocument();
    expect(screen.getByText("Mortgage principal")).toBeInTheDocument();
    expect(screen.getByText("Mortgage interest")).toBeInTheDocument();
    expect(screen.getByText("Property tax")).toBeInTheDocument();
    expect(screen.getByText("Home insurance")).toBeInTheDocument();
    expect(screen.getByText("HOA")).toBeInTheDocument();
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
    expect(details.closest("td")).toHaveAttribute("colspan", "10");
  });

  // Production mutation caught: rendering sale details from a derived total instead of the domain home-sale fields conceals sale costs and tax.
  it("shows the Sell first-year gross proceeds, costs, payoff, and incremental sale tax", () => {
    render(
      <RetirementProjectionTable
        selectedScenario="sell-all-homes"
        projection={projection}
        accountNames={{}}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "View year details" })[0]!);
    expect(screen.getByText("Gross proceeds")).toBeInTheDocument();
    expect(screen.getByText("Selling costs")).toBeInTheDocument();
    expect(screen.getByText("Mortgage payoff")).toBeInTheDocument();
    expect(screen.getByText("Incremental sale tax")).toBeInTheDocument();
  });

  // Production mutation caught: omitting year warnings from the detail row hides retirement risk even though the domain returned it.
  it("keeps early withdrawal, depletion, ended activity, and unfunded spending with their domain context", () => {
    render(
      <RetirementProjectionTable
        selectedScenario="keep-homes"
        projection={projection}
        accountNames={{ "traditional-ira": "Traditional IRA", rental: "Pine rental" }}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "View year details" })[0]!);
    const warnings = within(screen.getByRole("region", { name: "Warnings for 2042" })).getAllByRole("listitem");
    expect(warnings[0]).toHaveTextContent("Early withdrawal: A 10% penalty applies before age 59½. Year 2042 · Traditional IRA");
    expect(warnings[1]).toHaveTextContent("Account depleted: The account reached zero. Year 2042 · Traditional IRA");
    expect(warnings[2]).toHaveTextContent("Activity ended: Rental activity ended after the sale. Year 2042 · Pine rental");
    expect(warnings[3]).toHaveTextContent("Unfunded spending: Planned spending was not fully funded. Year 2042");
  });
});
