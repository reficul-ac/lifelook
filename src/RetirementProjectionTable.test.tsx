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
    sellingCostsCents: 0,
    mortgagePayoffCents: 1,
    incrementalSaleTaxCents: 55,
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
    { code: "early-withdrawal", year: 2042, entityId: "traditional-ira", message: "5001 cents of early-distribution penalties were estimated." },
    { code: "account-depleted", year: 2042, entityId: "traditional-ira", message: "Traditional IRA was depleted." },
    { code: "activity-ended", year: 2042, entityId: "consulting", message: "Consulting income ends on 2042-06-30." },
    { code: "unfunded-spending", year: 2042, message: "753 cents of spending could not be funded." },
    { code: "unsupported-rental-tax", year: 2042, entityId: "rental", message: "Rental tax treatment is unavailable for Pine rental." },
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
      expect(screen.getByRole("columnheader", { name: heading })).toHaveAttribute("scope", "col");
    }

    const firstRow = screen.getByRole("row", { name: /2042.*Avery.*62/ });
    expect(within(firstRow).getByRole("rowheader", { name: /2042.*Avery.*62/ })).toHaveAttribute("scope", "row");
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

  // Production mutation caught: unmounting collapsed detail rows leaves aria-controls pointing at IDs that do not exist, and indistinguishable controls force screen-reader users to guess the year.
  it("keeps one uniquely named, connected disclosure control and detail target for every year", () => {
    render(
      <RetirementProjectionTable
        selectedScenario="keep-homes"
        projection={projection}
        accountNames={{}}
      />,
    );

    const controls = screen.getAllByRole("button", { name: /View 204[23] year details/ });
    expect(controls).toHaveLength(2);
    expect(controls[0]).toHaveAttribute("aria-expanded", "false");
    expect(controls[1]).toHaveAttribute("aria-expanded", "false");
    for (const control of controls) {
      const target = document.getElementById(control.getAttribute("aria-controls")!);
      expect(target).toBeInTheDocument();
      expect(target).toHaveAttribute("hidden");
    }

    fireEvent.click(controls[0]!);
    expect(controls[0]).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(controls[0]!.getAttribute("aria-controls")!)).not.toHaveAttribute("hidden");
    expect(controls[1]).toHaveAttribute("aria-expanded", "false");
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
        accountNames={{ "traditional-ira": "Traditional IRA", rental: "Pine rental", consulting: "Consulting income" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View 2042 year details" }));
    const details = document.getElementById("retirement-year-2042")!;
    expect(details).toBeInTheDocument();
    expect(within(details).getByText("Rental income")).toBeInTheDocument();
    expect(within(details).getByText("Mortgage principal")).toBeInTheDocument();
    expect(within(details).getByText("Mortgage interest")).toBeInTheDocument();
    expect(within(details).getByText("Property tax")).toBeInTheDocument();
    expect(within(details).getByText("Home insurance")).toBeInTheDocument();
    expect(within(details).getByText("HOA")).toBeInTheDocument();
    expect(within(details).getByText("Maintenance")).toBeInTheDocument();
    expect(within(details).getByRole("region", { name: "Withdrawal sources for 2042" })).toHaveTextContent("Traditional IRA: $40,000");
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

    fireEvent.click(screen.getByRole("button", { name: "View 2042 year details" }));
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
        accountNames={{ "traditional-ira": "Traditional IRA", rental: "Pine rental", consulting: "Consulting income" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View 2042 year details" }));
    const warnings = within(screen.getByRole("region", { name: "Warnings for 2042" })).getAllByRole("listitem");
    expect(warnings[0]).toHaveTextContent("Early withdrawal penalty: $50.01 of early-distribution penalties were estimated. Year 2042 · Traditional IRA");
    expect(warnings[1]).toHaveTextContent("Account depleted: Traditional IRA was depleted. Year 2042 · Traditional IRA");
    expect(warnings[2]).toHaveTextContent("Activity ended: Consulting income ends on 2042-06-30. Year 2042 · Consulting income");
    expect(warnings[3]).toHaveTextContent("Unfunded spending: $7.53 of spending could not be funded. Year 2042");
    expect(warnings[4]).toHaveTextContent("Rental tax needs attention: Rental tax treatment is unavailable for Pine rental. Year 2042 · Pine rental");
  });

  // Production mutation caught: formatting all dollars to whole units or applying a negative sign from the field label turns sub-dollar sale values into misleading signed zeroes.
  it("preserves sub-dollar sale amounts and never signs a zero cost", () => {
    render(
      <RetirementProjectionTable
        selectedScenario="sell-all-homes"
        projection={projection}
        accountNames={{}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View 2042 year details" }));
    expect(screen.getByLabelText("Selling costs: $0")).toHaveTextContent("$0");
    expect(screen.getByLabelText("Mortgage payoff: negative $0.01")).toHaveTextContent("−$0.01");
    expect(screen.getByLabelText("Incremental sale tax: negative $0.55")).toHaveTextContent("−$0.55");
  });

  // Production mutation caught: showing only missing-data issues makes a warning-only unavailable projection look like a home-data form instead of a failed calculation.
  it("shows warning-only unavailable calculation failures as actionable projection warnings", () => {
    const { rerender } = render(
      <RetirementProjectionTable
        selectedScenario="sell-all-homes"
        projection={{
          available: false,
          issues: [],
          warnings: [{
            code: "calculation-error",
            message: "Missing projection balances for 2042-08",
          }],
        }}
        accountNames={{}}
      />,
    );

    const unavailable = screen.getByRole("region", { name: "Sell all homes annual projection" });
    expect(unavailable).toHaveTextContent("Calculation needs attention: Missing projection balances for 2042-08");
    expect(unavailable).not.toHaveTextContent("Complete the following home details");

    rerender(
      <RetirementProjectionTable
        selectedScenario="sell-all-homes"
        projection={{
          available: false,
          issues: [{
            assetId: "pine-rental",
            assetName: "Pine rental",
            field: "purchaseDate",
            message: "Add a purchase date for Pine rental.",
          }],
          warnings: [{
            code: "calculation-error",
            message: "Missing projection balances for 2042-08",
          }],
        }}
        accountNames={{}}
      />,
    );
    expect(unavailable).toHaveTextContent("Add a purchase date for Pine rental.");
    expect(unavailable).toHaveTextContent("Calculation needs attention: Missing projection balances for 2042-08");
  });
});
