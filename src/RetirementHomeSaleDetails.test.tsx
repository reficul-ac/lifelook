import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ResolvedRetirementHome,
  RetirementMissingData,
  Scenario,
} from "./domain";
import { RetirementHomeSaleDetails } from "./RetirementHomeSaleDetails";

const scenario: Scenario = {
  id: "active",
  name: "Active plan",
  assumptions: { inflationBps: 250, thresholdInflationBps: 250 },
  assumptionsInherited: false,
  events: [],
  defaultContributionAccountId: "cash",
  contributions: [],
  withdrawals: [],
  horizon: { start: "2026-01", months: 360 },
};

const completeHome: ResolvedRetirementHome = {
  property: {
    assetId: "complete-home",
    name: "Complete home",
    valueCents: 825_000_00,
    mortgageCents: 225_000_00,
    monthlyGrossRentCents: 0,
    projectedDepreciationCents: 0,
    source: "current",
  },
  purchaseDate: "2018-03-15",
  taxBasisCents: 500_000_00,
  assumptions: {
    sellingCostBps: 500,
    primaryResidenceExclusionEligible: true,
    accumulatedFederalDepreciationCents: 0,
    accumulatedCaliforniaDepreciationCents: 0,
  },
  mortgageCents: 225_000_00,
  use: "personal",
};

const incompleteHome: ResolvedRetirementHome = {
  property: {
    assetId: "home",
    name: "Current home",
    valueCents: 700_000_00,
    mortgageCents: 300_000_00,
    monthlyGrossRentCents: 0,
    projectedDepreciationCents: 0,
    source: "current",
  },
  purchaseDate: null,
  taxBasisCents: 450_000_00,
  assumptions: null,
  mortgageCents: 300_000_00,
  use: "personal",
};

const incompleteIssues: readonly RetirementMissingData[] = [
  {
    assetId: "home",
    assetName: "Current home",
    field: "purchaseDate",
    message: "Add a purchase date for Current home.",
  },
  {
    assetId: "home",
    assetName: "Current home",
    field: "sellingCostBps",
    message: "Add selling costs for Current home.",
  },
  {
    assetId: "home",
    assetName: "Current home",
    field: "primaryResidenceEligibility",
    message: "Confirm primary residence eligibility for Current home.",
  },
  {
    assetId: "home",
    assetName: "Current home",
    field: "federalDepreciation",
    message: "Add federal depreciation for Current home.",
  },
  {
    assetId: "home",
    assetName: "Current home",
    field: "californiaDepreciation",
    message: "Add California depreciation for Current home.",
  },
];

describe("RetirementHomeSaleDetails current-home editing", () => {
  // Break caught: hiding authoritative values behind the disclosure or making Plan-derived values editable removes the no-interaction audit view.
  it("shows inherited and Plan-derived values before opening an editor", () => {
    render(
      <RetirementHomeSaleDetails
        homes={[completeHome]}
        issues={[]}
        scenario={scenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={vi.fn()}
        onUpdatePlannedHome={vi.fn()}
      />,
    );

    const home = screen.getByRole("article", { name: "Complete home sale details" });
    expect(within(home).getByText("Complete")).toBeInTheDocument();
    expect(within(home).getByText("March 15, 2018")).toBeInTheDocument();
    expect(within(home).getByText("$500,000")).toBeInTheDocument();
    expect(within(home).getByText("5%")).toBeInTheDocument();
    expect(within(home).getByText("$825,000")).toBeInTheDocument();
    expect(within(home).getByText("Plan-derived projected sale value")).toBeInTheDocument();
    expect(within(home).getByText("Plan-derived appreciation")).toBeInTheDocument();
    expect(within(home).queryByRole("textbox")).not.toBeInTheDocument();
  });

  // Break caught: sending only newly entered fields, or rendering a control for the inherited basis, corrupts the shared asset patch contract.
  it("renders controls only for missing facts and saves the complete authoritative patch", async () => {
    const onUpdateCurrentHome = vi.fn().mockResolvedValue(undefined);
    render(
      <RetirementHomeSaleDetails
        homes={[completeHome, incompleteHome]}
        issues={incompleteIssues}
        scenario={scenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={onUpdateCurrentHome}
        onUpdatePlannedHome={vi.fn()}
      />,
    );

    const home = screen.getByRole("article", { name: "Current home sale details" });
    expect(within(home).getByText("Needs details")).toBeInTheDocument();
    fireEvent.click(within(home).getByText("Edit sale details"));

    expect(within(home).queryByLabelText("Purchase price")).not.toBeInTheDocument();
    fireEvent.change(within(home).getByLabelText("Purchase date"), {
      target: { value: "2020-06-01" },
    });
    fireEvent.change(within(home).getByLabelText("Selling costs (%)"), {
      target: { value: "6" },
    });
    fireEvent.click(within(home).getByLabelText("Eligible for primary-home gain exclusion"));
    fireEvent.change(within(home).getByLabelText("Federal depreciation claimed"), {
      target: { value: "0" },
    });
    fireEvent.change(within(home).getByLabelText("California depreciation claimed"), {
      target: { value: "0" },
    });
    fireEvent.click(within(home).getByRole("button", { name: "Save sale details" }));

    await waitFor(() =>
      expect(onUpdateCurrentHome).toHaveBeenCalledWith("home", {
        purchaseDate: "2020-06-01",
        purchasePriceCents: 450_000_00,
        homeSaleAssumptions: {
          sellingCostBps: 600,
          primaryResidenceExclusionEligible: true,
          accumulatedFederalDepreciationCents: 0,
          accumulatedCaliforniaDepreciationCents: 0,
        },
      }),
    );
  });

  // Break caught: clearing local form state after a rejected persistence call prevents retrying the user's exact draft.
  it("retains a rejected draft and retries the same authoritative patch", async () => {
    const onUpdateCurrentHome = vi.fn()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(undefined);
    render(
      <RetirementHomeSaleDetails
        homes={[incompleteHome]}
        issues={incompleteIssues}
        scenario={scenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={onUpdateCurrentHome}
        onUpdatePlannedHome={vi.fn()}
      />,
    );

    const home = screen.getByRole("article", { name: "Current home sale details" });
    fireEvent.click(within(home).getByText("Edit sale details"));
    fireEvent.change(within(home).getByLabelText("Purchase date"), {
      target: { value: "2020-06-01" },
    });
    fireEvent.change(within(home).getByLabelText("Selling costs (%)"), {
      target: { value: "6" },
    });
    fireEvent.click(within(home).getByLabelText("Eligible for primary-home gain exclusion"));
    fireEvent.click(within(home).getByRole("button", { name: "Save sale details" }));

    expect(await within(home).findByRole("alert")).toHaveTextContent("could not be saved");
    expect(within(home).getByLabelText("Purchase date")).toHaveValue("2020-06-01");
    fireEvent.click(within(home).getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(onUpdateCurrentHome).toHaveBeenCalledTimes(2));
    expect(onUpdateCurrentHome.mock.calls[1]).toEqual(onUpdateCurrentHome.mock.calls[0]);
  });
});

describe("RetirementHomeSaleDetails planned-home editing", () => {
  const purchase = {
    id: "buy-planned-home",
    date: "2035-01-01",
    type: "asset-purchase" as const,
    assetId: "planned-home",
    name: "Planned home",
    valueCents: 900_000_00,
    annualGrowthBps: 300,
    fundingAccountId: "cash",
    downPaymentCents: 180_000_00,
    costsCents: 20_000_00,
    propertyDetails: {
      primaryResidence: true,
      rentalUseBps: 0,
      rentalTaxModelingEnabled: false,
      rentalType: "long-term" as const,
      maintenanceBps: 100,
    },
  };
  const rentalStart = {
    id: "rent-planned-home",
    date: "2039-01-01",
    type: "property-rental-start" as const,
    assetId: "planned-home",
    name: "Rent planned home",
    monthlyRentalIncomeCents: 3_000_00,
    rentalIncomeGrowthBps: 250,
    rentalUseBps: 10_000,
    rentalTaxModelingEnabled: true,
    rentalType: "long-term" as const,
  };
  const plannedScenario: Scenario = {
    ...scenario,
    events: [
      { id: "bonus", date: "2030-06-01", type: "one-time-income", amountCents: 25_000_00 },
      purchase,
      rentalStart,
    ],
  };
  const plannedHome: ResolvedRetirementHome = {
    property: {
      assetId: "planned-home",
      name: "Planned home",
      valueCents: 1_100_000_00,
      mortgageCents: 500_000_00,
      monthlyGrossRentCents: 3_000_00,
      rentalUseBps: 10_000,
      projectedDepreciationCents: 60_000_00,
      source: "planned",
    },
    purchaseDate: "2035-01-01",
    taxBasisCents: 900_000_00,
    assumptions: null,
    mortgageCents: 500_000_00,
    use: "rental",
  };
  const plannedIssues: readonly RetirementMissingData[] = [
    {
      assetId: "planned-home",
      assetName: "Planned home",
      field: "sellingCostBps",
      message: "Add selling costs for Planned home.",
    },
    {
      assetId: "planned-home",
      assetName: "Planned home",
      field: "primaryResidenceEligibility",
      message: "Confirm primary residence eligibility for Planned home.",
    },
    {
      assetId: "planned-home",
      assetName: "Planned home",
      field: "federalDepreciation",
      message: "Add federal depreciation for Planned home.",
    },
    {
      assetId: "planned-home",
      assetName: "Planned home",
      field: "californiaDepreciation",
      message: "Add California depreciation for Planned home.",
    },
  ];

  // Break caught: ignoring two years of provable Plan residence asks for redundant input or persists against the projected asset ID.
  it("infers eligibility from purchase, primary-residence, and history data and saves by event ID", async () => {
    const onUpdatePlannedHome = vi.fn().mockResolvedValue(undefined);
    render(
      <RetirementHomeSaleDetails
        homes={[plannedHome]}
        issues={plannedIssues}
        scenario={plannedScenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={vi.fn()}
        onUpdatePlannedHome={onUpdatePlannedHome}
      />,
    );

    const home = screen.getByRole("article", { name: "Planned home sale details" });
    expect(within(home).getByText("Eligible (inferred from Plan)")).toBeInTheDocument();
    fireEvent.click(within(home).getByText("Edit sale details"));
    expect(within(home).queryByLabelText("Eligible for primary-home gain exclusion")).not.toBeInTheDocument();
    fireEvent.change(within(home).getByLabelText("Selling costs (%)"), {
      target: { value: "6" },
    });
    fireEvent.click(within(home).getByRole("button", { name: "Save sale details" }));

    await waitFor(() =>
      expect(onUpdatePlannedHome).toHaveBeenCalledWith("buy-planned-home", {
        purchaseDate: "2035-01-01",
        purchasePriceCents: 900_000_00,
        homeSaleAssumptions: {
          sellingCostBps: 600,
          primaryResidenceExclusionEligible: true,
          accumulatedFederalDepreciationCents: 0,
          accumulatedCaliforniaDepreciationCents: 0,
        },
      }),
    );
  });

  // Break caught: treating absent primary-residence history as false silently invents a tax assumption instead of requesting confirmation.
  it("asks for eligibility confirmation only when Plan history cannot derive it", () => {
    const unknownScenario: Scenario = {
      ...plannedScenario,
      events: [
        plannedScenario.events[0],
        { ...purchase, propertyDetails: { ...purchase.propertyDetails, primaryResidence: undefined } },
      ],
    };
    render(
      <RetirementHomeSaleDetails
        homes={[{ ...plannedHome, property: { ...plannedHome.property, monthlyGrossRentCents: 0, rentalUseBps: 0 }, use: "personal" }]}
        issues={plannedIssues}
        scenario={unknownScenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={vi.fn()}
        onUpdatePlannedHome={vi.fn()}
      />,
    );

    const home = screen.getByRole("article", { name: "Planned home sale details" });
    expect(within(home).queryByText(/inferred from Plan/)).not.toBeInTheDocument();
    fireEvent.click(within(home).getByText("Edit sale details"));
    expect(within(home).getByLabelText("Eligible for primary-home gain exclusion")).toBeInTheDocument();
  });

  // Break caught: allowing derived history to replace a saved answer mutates an authoritative tax assumption during an unrelated save.
  it("keeps an explicit saved eligibility answer authoritative over Plan inference", async () => {
    const onUpdatePlannedHome = vi.fn().mockResolvedValue(undefined);
    render(
      <RetirementHomeSaleDetails
        homes={[{
          ...plannedHome,
          assumptions: {
            sellingCostBps: 500,
            primaryResidenceExclusionEligible: false,
            accumulatedFederalDepreciationCents: 10_000_00,
            accumulatedCaliforniaDepreciationCents: 8_000_00,
          },
        }]}
        issues={[]}
        scenario={plannedScenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={vi.fn()}
        onUpdatePlannedHome={onUpdatePlannedHome}
      />,
    );

    const home = screen.getByRole("article", { name: "Planned home sale details" });
    fireEvent.click(within(home).getByText("Edit sale details"));
    fireEvent.click(within(home).getByRole("button", { name: "Save sale details" }));

    await waitFor(() =>
      expect(onUpdatePlannedHome).toHaveBeenCalledWith(
        "buy-planned-home",
        expect.objectContaining({
          homeSaleAssumptions: expect.objectContaining({
            primaryResidenceExclusionEligible: false,
          }),
        }),
      ),
    );
  });
});
