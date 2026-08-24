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
    accumulatedFederalDepreciationCents: 12_000_00,
    accumulatedCaliforniaDepreciationCents: 9_000_00,
  },
  mortgageCents: 225_000_00,
  use: "personal",
  primaryResidenceEligibility: { source: "stored", eligible: true },
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
  primaryResidenceEligibility: { source: "unknown" },
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
  it("resolves mixed-use sale tax treatment from the linked editor", async () => {
    const onUpdateCurrentHome = vi.fn().mockResolvedValue(undefined);
    const mixedUseHome = { ...completeHome, use: undefined };
    render(
      <RetirementHomeSaleDetails
        homes={[mixedUseHome]}
        issues={[{
          assetId: completeHome.property.assetId,
          assetName: completeHome.property.name,
          field: "rentalUse",
          message: "Review rental use for Complete home; mixed-use sale tax is not supported.",
        }]}
        scenario={scenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={onUpdateCurrentHome}
        onUpdatePlannedHome={vi.fn()}
      />,
    );

    const home = screen.getByRole("article", { name: "Complete home sale details" });
    expect(within(home).getByText("Needs selection")).toBeInTheDocument();
    fireEvent.click(within(home).getByText("Edit sale details"));
    fireEvent.change(within(home).getByLabelText("Sale tax treatment"), {
      target: { value: "personal" },
    });
    fireEvent.click(within(home).getByRole("button", { name: "Save sale details" }));

    await waitFor(() => expect(onUpdateCurrentHome).toHaveBeenCalledWith(
      completeHome.property.assetId,
      { homeSaleAssumptions: { ...completeHome.assumptions!, saleUse: "personal" } },
    ));
  });

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
    expect(
      within(home).getByText("Primary-home gain exclusion"),
    ).toBeInTheDocument();
    expect(within(home).getByText("Eligible")).toBeInTheDocument();
    expect(
      within(home).getAllByText("Federal depreciation claimed")[0],
    ).toBeInTheDocument();
    expect(within(home).getByText("$12,000")).toBeInTheDocument();
    expect(
      within(home).getAllByText("California depreciation claimed")[0],
    ).toBeInTheDocument();
    expect(within(home).getByText("$9,000")).toBeInTheDocument();
    expect(within(home).getByText("$825,000")).toBeInTheDocument();
    expect(within(home).getByText("Plan-derived projected sale value")).toBeInTheDocument();
    expect(within(home).getByText("Plan-derived appreciation")).toBeInTheDocument();
    expect(within(home).getByText("Edit sale details").closest("details"))
      .not.toHaveAttribute("open");
  });

  // Break caught: an empty complete-home form prevents corrections, while editing acquisition facts here duplicates Net Worth ownership.
  it("edits every mutable sale assumption and routes acquisition corrections to Net Worth", async () => {
    const onUpdateCurrentHome = vi.fn().mockResolvedValue(undefined);
    const onEditAcquisition = vi.fn();
    render(
      <RetirementHomeSaleDetails
        homes={[completeHome, incompleteHome]}
        issues={incompleteIssues}
        scenario={scenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={onUpdateCurrentHome}
        onUpdatePlannedHome={vi.fn()}
        onEditAcquisition={onEditAcquisition}
      />,
    );

    const home = screen.getByRole("article", { name: "Current home sale details" });
    expect(within(home).getByText("Needs details")).toBeInTheDocument();
    const missingDetails = within(home).getByRole("list", { name: "Current home missing sale details" });
    expect(missingDetails).toHaveTextContent("Add a purchase date for Current home.");
    expect(missingDetails).toHaveTextContent("Add selling costs for Current home.");
    fireEvent.click(within(home).getByText("Edit sale details"));

    expect(within(home).queryByLabelText("Purchase date")).not.toBeInTheDocument();
    expect(within(home).queryByLabelText("Purchase price")).not.toBeInTheDocument();
    fireEvent.click(within(home).getByRole("button", {
      name: "Edit Current home acquisition in Net Worth",
    }));
    expect(onEditAcquisition).toHaveBeenCalledWith(
      incompleteHome,
      expect.any(HTMLElement),
    );
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
        homeSaleAssumptions: {
          sellingCostBps: 600,
          primaryResidenceExclusionEligible: true,
          accumulatedFederalDepreciationCents: 0,
          accumulatedCaliforniaDepreciationCents: 0,
        },
      }),
    );
  });

  it("shows editable mutable assumptions even when a home is complete", () => {
    const onEditAcquisition = vi.fn();
    render(
      <RetirementHomeSaleDetails
        homes={[completeHome]}
        issues={[]}
        scenario={scenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={vi.fn()}
        onUpdatePlannedHome={vi.fn()}
        onEditAcquisition={onEditAcquisition}
      />,
    );

    const home = screen.getByRole("article", { name: "Complete home sale details" });
    fireEvent.click(within(home).getByText("Edit sale details"));
    expect(within(home).getByLabelText("Selling costs (%)")).toHaveValue("5");
    expect(within(home).getByLabelText("Federal depreciation claimed")).toHaveValue("12000");
    expect(within(home).getByLabelText("California depreciation claimed")).toHaveValue("9000");
    expect(within(home).getByLabelText("Eligible for primary-home gain exclusion")).toBeChecked();
    fireEvent.click(within(home).getByRole("button", {
      name: "Edit Complete home acquisition in Net Worth",
    }));
    expect(onEditAcquisition).toHaveBeenCalledWith(
      completeHome,
      expect.any(HTMLElement),
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
    fireEvent.change(within(home).getByLabelText("Selling costs (%)"), {
      target: { value: "6" },
    });
    fireEvent.click(within(home).getByLabelText("Eligible for primary-home gain exclusion"));
    fireEvent.click(within(home).getByRole("button", { name: "Save sale details" }));

    expect(await within(home).findByRole("alert")).toHaveTextContent("could not be saved");
    expect(within(home).getByLabelText("Selling costs (%)")).toHaveValue("6");
    fireEvent.click(within(home).getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(onUpdateCurrentHome).toHaveBeenCalledTimes(2));
    expect(onUpdateCurrentHome.mock.calls[1]).toEqual(onUpdateCurrentHome.mock.calls[0]);
  });

  // Break caught: acquisition facts must remain owned by the Net Worth editor, including boundary values.
  it("routes a missing purchase basis instead of accepting a private retirement copy", () => {
    const onEditAcquisition = vi.fn();
    render(
      <RetirementHomeSaleDetails
        homes={[{ ...completeHome, taxBasisCents: null }]}
        issues={[
          {
            assetId: "complete-home",
            assetName: "Complete home",
            field: "taxBasis",
            message: "Add a tax basis for Complete home.",
          },
        ]}
        scenario={scenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={vi.fn()}
        onUpdatePlannedHome={vi.fn()}
        onEditAcquisition={onEditAcquisition}
      />,
    );

    const home = screen.getByRole("article", {
      name: "Complete home sale details",
    });
    fireEvent.click(within(home).getByText("Edit sale details"));
    expect(within(home).queryByLabelText("Purchase price")).not.toBeInTheDocument();
    fireEvent.click(within(home).getByRole("button", {
      name: "Edit Complete home acquisition in Net Worth",
    }));
    expect(onEditAcquisition).toHaveBeenCalledWith(
      expect.objectContaining({ property: expect.objectContaining({ assetId: "complete-home" }) }),
      expect.any(HTMLElement),
    );
  });

  // Break caught: reusing App's signed money parser without an editor guard allows negative accumulated depreciation into the repository payload.
  it("keeps accumulated depreciation non-negative with the shared parser", async () => {
    const onUpdateCurrentHome = vi.fn();
    render(
      <RetirementHomeSaleDetails
        homes={[completeHome]}
        issues={[
          {
            assetId: "complete-home",
            assetName: "Complete home",
            field: "federalDepreciation",
            message: "Add federal depreciation for Complete home.",
          },
        ]}
        scenario={scenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={onUpdateCurrentHome}
        onUpdatePlannedHome={vi.fn()}
      />,
    );

    const home = screen.getByRole("article", {
      name: "Complete home sale details",
    });
    fireEvent.click(within(home).getByText("Edit sale details"));
    fireEvent.change(
      within(home).getByLabelText("Federal depreciation claimed"),
      {
        target: { value: "-1" },
      },
    );
    fireEvent.click(
      within(home).getByRole("button", { name: "Save sale details" }),
    );

    expect(await within(home).findByRole("alert")).toHaveTextContent(
      "non-negative accumulated depreciation",
    );
    expect(onUpdateCurrentHome).not.toHaveBeenCalled();
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
    primaryResidenceEligibility: { source: "derived", eligible: true },
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

  // Break caught: ignoring domain-derived eligibility asks for redundant input or persists a derived fact against the projected asset ID.
  it("uses domain-derived eligibility and saves only uncertain assumptions by event ID", async () => {
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
    expect(within(home).getByText("Eligible (derived from Plan)")).toBeInTheDocument();
    fireEvent.click(within(home).getByText("Edit sale details"));
    expect(within(home).queryByLabelText("Eligible for primary-home gain exclusion")).not.toBeInTheDocument();
    fireEvent.change(within(home).getByLabelText("Selling costs (%)"), {
      target: { value: "6" },
    });
    fireEvent.click(within(home).getByRole("button", { name: "Save sale details" }));

    await waitFor(() =>
      expect(onUpdatePlannedHome).toHaveBeenCalledWith("buy-planned-home", {
        homeSaleAssumptions: {
          sellingCostBps: 600,
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
        homes={[{ ...plannedHome, property: { ...plannedHome.property, monthlyGrossRentCents: 0, rentalUseBps: 0 }, use: "personal", primaryResidenceEligibility: { source: "unknown" } }]}
        issues={[
          ...plannedIssues,
          {
            assetId: "planned-home",
            assetName: "Planned home",
            field: "primaryResidenceEligibility",
            message: "Confirm primary residence eligibility for Planned home.",
          },
        ]}
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
          primaryResidenceEligibility: { source: "stored", eligible: false },
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

  // Break caught: reusing one asset-keyed draft after a sale and repurchase writes the first purchase's facts into the newly resolved purchase event.
  it("resets a rejected draft when the resolved planned purchase identity changes", async () => {
    const firstPurchase = {
      ...purchase,
      id: "buy-first-home",
      date: "2030-01-01",
      valueCents: 500_000_00,
      propertyDetails: {
        ...purchase.propertyDetails,
        primaryResidence: false,
      },
    };
    const sale = {
      id: "sell-first-home",
      date: "2035-01-01",
      type: "asset-sale" as const,
      assetId: "planned-home",
      proceedsCents: 700_000_00,
      costsCents: 40_000_00,
      destinationAccountId: "cash",
    };
    const secondPurchase = {
      ...firstPurchase,
      id: "buy-second-home",
      date: "2038-01-01",
      valueCents: 900_000_00,
    };
    const repurchaseScenario: Scenario = {
      ...scenario,
      events: [firstPurchase, sale, secondPurchase],
    };
    const onUpdatePlannedHome = vi.fn()
      .mockRejectedValueOnce(new Error("write unavailable"))
      .mockResolvedValueOnce(undefined);
    const { rerender } = render(
      <RetirementHomeSaleDetails
        homes={[
          {
            ...plannedHome,
            purchaseDate: firstPurchase.date,
            taxBasisCents: firstPurchase.valueCents,
          },
        ]}
        issues={plannedIssues}
        scenario={repurchaseScenario}
        retirementDate="2034-01-01"
        onUpdateCurrentHome={vi.fn()}
        onUpdatePlannedHome={onUpdatePlannedHome}
      />,
    );

    let home = screen.getByRole("article", { name: "Planned home sale details" });
    fireEvent.click(within(home).getByText("Edit sale details"));
    fireEvent.change(within(home).getByLabelText("Selling costs (%)"), {
      target: { value: "7" },
    });
    fireEvent.click(
      within(home).getByRole("button", { name: "Save sale details" }),
    );
    expect(await within(home).findByRole("alert")).toBeInTheDocument();
    expect(onUpdatePlannedHome).toHaveBeenLastCalledWith(
      "buy-first-home",
      expect.objectContaining({
        homeSaleAssumptions: expect.objectContaining({ sellingCostBps: 700 }),
      }),
    );

    rerender(
      <RetirementHomeSaleDetails
        homes={[
          {
            ...plannedHome,
            purchaseDate: secondPurchase.date,
            taxBasisCents: secondPurchase.valueCents,
          },
        ]}
        issues={plannedIssues}
        scenario={repurchaseScenario}
        retirementDate="2042-01-01"
        onUpdateCurrentHome={vi.fn()}
        onUpdatePlannedHome={onUpdatePlannedHome}
      />,
    );

    home = screen.getByRole("article", { name: "Planned home sale details" });
    expect(within(home).queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(within(home).getByText("Edit sale details"));
    expect(within(home).getByLabelText("Selling costs (%)")).toHaveValue("");
    fireEvent.change(within(home).getByLabelText("Selling costs (%)"), {
      target: { value: "6" },
    });
    fireEvent.click(
      within(home).getByRole("button", { name: "Save sale details" }),
    );

    await waitFor(() => expect(onUpdatePlannedHome).toHaveBeenCalledTimes(2));
    expect(onUpdatePlannedHome).toHaveBeenLastCalledWith(
      "buy-second-home",
      expect.objectContaining({
        homeSaleAssumptions: expect.objectContaining({ sellingCostBps: 600 }),
      }),
    );
  });

  // Break caught: retaining a stale boundary result after the retirement month changes can display the wrong derived eligibility.
  it("resets the editor when the boundary supplies changed derived eligibility", async () => {
    const inferenceScenario: Scenario = {
      ...scenario,
      events: [purchase],
    };
    const onUpdatePlannedHome = vi
      .fn()
      .mockRejectedValueOnce(new Error("write unavailable"))
      .mockResolvedValueOnce(undefined);
    const renderDetails = (retirementDate: string, eligible: boolean) => (
      <RetirementHomeSaleDetails
        homes={[{
          ...plannedHome,
          primaryResidenceEligibility: { source: "derived", eligible },
        }]}
        issues={plannedIssues}
        scenario={inferenceScenario}
        retirementDate={retirementDate}
        onUpdateCurrentHome={vi.fn()}
        onUpdatePlannedHome={onUpdatePlannedHome}
      />
    );
    const { rerender } = render(renderDetails("2036-01-01", false));

    let home = screen.getByRole("article", { name: "Planned home sale details" });
    expect(
      within(home).getByText("Not eligible (derived from Plan)"),
    ).toBeInTheDocument();
    fireEvent.click(within(home).getByText("Edit sale details"));
    fireEvent.change(within(home).getByLabelText("Selling costs (%)"), {
      target: { value: "7" },
    });
    fireEvent.click(
      within(home).getByRole("button", { name: "Save sale details" }),
    );
    expect(await within(home).findByRole("alert")).toBeInTheDocument();
    expect(onUpdatePlannedHome).toHaveBeenLastCalledWith(
      "buy-planned-home",
      expect.objectContaining({
        homeSaleAssumptions: expect.not.objectContaining({
          primaryResidenceExclusionEligible: expect.anything(),
        }),
      }),
    );

    rerender(renderDetails("2042-01-01", true));
    home = screen.getByRole("article", { name: "Planned home sale details" });
    expect(
      within(home).getByText("Eligible (derived from Plan)"),
    ).toBeInTheDocument();
    expect(within(home).queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(within(home).getByText("Edit sale details"));
    expect(within(home).getByLabelText("Selling costs (%)")).toHaveValue("");
    fireEvent.change(within(home).getByLabelText("Selling costs (%)"), {
      target: { value: "6" },
    });
    fireEvent.click(
      within(home).getByRole("button", { name: "Save sale details" }),
    );

    await waitFor(() => expect(onUpdatePlannedHome).toHaveBeenCalledTimes(2));
    expect(onUpdatePlannedHome).toHaveBeenLastCalledWith(
      "buy-planned-home",
      expect.objectContaining({
        homeSaleAssumptions: expect.objectContaining({ sellingCostBps: 600 }),
      }),
    );
    expect(onUpdatePlannedHome.mock.calls[1]?.[1].homeSaleAssumptions)
      .not.toHaveProperty("primaryResidenceExclusionEligible");
  });
});
