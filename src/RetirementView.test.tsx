import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRetirementCutoff,
  calculateRetirementSnapshot,
  type FinancialSnapshot,
  type RetirementCutoff,
  type RetirementSnapshotResult,
  type Scenario,
} from "./domain";
import type { Bootstrap, Repository, RetirementSettingsRecord } from "./repository";
import { RetirementView } from "./RetirementView";

vi.mock("./domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domain")>();
  return {
    ...actual,
    buildRetirementCutoff: vi.fn(),
    calculateRetirementSnapshot: vi.fn(),
  };
});

const activeScenario: Scenario = {
  id: "active",
  name: "Build the ADU",
  assumptions: { inflationBps: 250, thresholdInflationBps: 250 },
  assumptionsInherited: false,
  events: [],
  contributions: [],
  withdrawals: [],
  horizon: { start: "2041-01", months: 240 },
};

const snapshot: FinancialSnapshot = {
  household: {
    id: "household",
    name: "Household",
    state: "CA",
    people: [{ id: "person", name: "Person" }],
  },
  taxProfile: {
    filingStatus: "single",
    state: "CA",
    taxYear: 2026,
    thresholdInflationBps: 250,
  },
  accounts: [],
  recurring: [],
  assets: [],
  liabilities: [],
};

const bootstrap: Bootstrap = {
  onboardingStep: 8,
  onboardingComplete: true,
  household: { id: "household", name: "Household", state: "CA" },
  people: [{ id: "person", householdId: "household", name: "Person" }],
  taxProfile: {
    filingStatus: "single",
    state: "CA",
    taxYear: 2026,
    thresholdInflationBps: 250,
    revision: 1,
  },
  settings: { theme: "system", reducedMotion: false, revision: 1 },
  accounts: [],
  categories: [],
  activity: [],
  recurring: [],
  assets: [],
  liabilities: [],
  scenarios: [],
  retirementPlan: null,
};

const cutoff: RetirementCutoff = {
  retirementMonth: "2042-01",
  balanceMonth: "2041-12",
  accounts: {},
  assets: {},
  liabilities: {},
  properties: [],
  taxLedger: {} as RetirementCutoff["taxLedger"],
};

const availableResult: RetirementSnapshotResult = {
  retirementMonth: "2042-01",
  withdrawalRateBps: 300,
  netWorthCents: 125_000_000,
  keepHomes: {
    homeEquityCents: 75_000_000,
    nonHomeNetWorthCents: 50_000_000,
    withdrawalIncomeCents: 1_500_000,
    grossRentalIncomeCents: 480_000,
    annualPreTaxIncomeCents: 1_980_000,
  },
  sellHomes: {
    available: true,
    grossHomeEquityCents: 75_000_000,
    sellingCostsCents: 4_500_000,
    incrementalSaleTaxCents: 2_500_000,
    netHomeProceedsCents: 68_000_000,
    liquidNetWorthCents: 118_000_000,
    annualPreTaxIncomeCents: 3_540_000,
  },
};

const initial: RetirementSettingsRecord = {
  householdId: "household",
  retirementMonth: "2042-01",
  withdrawalRateBps: 300,
  revision: 1,
};

const repository = (updateRetirementPlan = vi.fn()): Repository => ({
  bootstrap: vi.fn(),
  retryStartup: vi.fn(),
  saveOnboardingStep: vi.fn(),
  completeOnboarding: vi.fn(),
  updateRetirementPlan,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildRetirementCutoff).mockReturnValue(cutoff);
  vi.mocked(calculateRetirementSnapshot).mockReturnValue(availableResult);
});

describe("RetirementView settings and autosave", () => {
  it("defaults to next January and 3% while evaluating only the active Plan", () => {
    const updateRetirementPlan = vi.fn();
    const before = JSON.stringify(activeScenario);

    render(
      <RetirementView
        initial={null}
        repository={repository(updateRetirementPlan)}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );

    const nextJanuary = `${new Date().getUTCFullYear() + 1}-01`;
    expect(screen.getByLabelText("Retirement month")).toHaveValue(nextJanuary);
    expect(screen.getByLabelText("Withdrawal rate")).toHaveValue(3);
    expect(screen.getByRole("heading", { name: "Build the ADU" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(updateRetirementPlan).not.toHaveBeenCalled();
    expect(buildRetirementCutoff).toHaveBeenCalledWith(
      expect.objectContaining({ scenario: activeScenario, retirementMonth: nextJanuary }),
    );
    expect(JSON.stringify(activeScenario)).toBe(before);
  });

  it("does not save on a Strict Mode mount and starts saving on the first edit", async () => {
    let finish: ((record: RetirementSettingsRecord) => void) | undefined;
    const updateRetirementPlan = vi.fn(
      () => new Promise<RetirementSettingsRecord>((resolve) => { finish = resolve; }),
    );

    render(
      <StrictMode>
        <RetirementView
          initial={initial}
          repository={repository(updateRetirementPlan)}
          bootstrap={bootstrap}
          snapshot={snapshot}
          scenario={activeScenario}
        />
      </StrictMode>,
    );
    expect(updateRetirementPlan).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });
    expect(updateRetirementPlan).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    finish?.({ ...initial, retirementMonth: "2042-09", revision: 2 });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("serializes autosaves with the latest revision and reports the saved record", async () => {
    let finishFirst: ((record: RetirementSettingsRecord) => void) | undefined;
    const updateRetirementPlan = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<RetirementSettingsRecord>((resolve) => { finishFirst = resolve; }),
      )
      .mockResolvedValueOnce({
        ...initial,
        retirementMonth: "2042-09",
        withdrawalRateBps: 350,
        revision: 3,
      });
    const onSettingsChange = vi.fn();

    render(
      <RetirementView
        initial={initial}
        repository={repository(updateRetirementPlan)}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });
    expect(await screen.findByText("Saving…")).toBeInTheDocument();
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-09",
      withdrawalRateBps: 300,
      expectedRevision: 1,
    });

    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "3.5" },
    });
    expect(updateRetirementPlan).toHaveBeenCalledTimes(1);
    finishFirst?.({
      ...initial,
      retirementMonth: "2042-09",
      revision: 2,
    });

    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-09",
      withdrawalRateBps: 350,
      expectedRevision: 2,
    });
    expect(buildRetirementCutoff).toHaveBeenLastCalledWith(
      expect.objectContaining({ scenario: activeScenario, retirementMonth: "2042-09" }),
    );
    expect(calculateRetirementSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ scenario: activeScenario, withdrawalRateBps: 350 }),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...initial,
      retirementMonth: "2042-09",
      withdrawalRateBps: 350,
      revision: 3,
    });
  });

  it("clamps persisted basis points and retries a failed save", async () => {
    const updateRetirementPlan = vi
      .fn()
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({ ...initial, withdrawalRateBps: 1, revision: 2 })
      .mockResolvedValueOnce({ ...initial, withdrawalRateBps: 10_000, revision: 3 });

    render(
      <RetirementView
        initial={initial}
        repository={repository(updateRetirementPlan)}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );
    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "0" },
    });

    const retry = await screen.findByRole("button", { name: "Save failed — retry" });
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-01",
      withdrawalRateBps: 1,
      expectedRevision: 1,
    });
    fireEvent.click(retry);
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-01",
      withdrawalRateBps: 1,
      expectedRevision: 1,
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "101" },
    });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(3));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-01",
      withdrawalRateBps: 10_000,
      expectedRevision: 2,
    });
  });
});

describe("RetirementView snapshot stories", () => {
  it("shows the two headline stories and keeps exact calculations collapsed", () => {
    render(
      <RetirementView
        initial={initial}
        repository={repository()}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );

    expect(screen.getByRole("heading", { name: "If you keep your homes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "If you sell all homes" })).toBeInTheDocument();
    expect(screen.getByText("Net worth at retirement")).toBeInTheDocument();
    expect(screen.getAllByText("Estimated annual pre-tax income")).toHaveLength(2);
    const sellStory = screen.getByRole("heading", { name: "If you sell all homes" }).closest("article")!;
    expect(within(sellStory).getAllByText("Liquid net worth")).toHaveLength(2);
    expect(
      screen.getByText("Pre-tax estimate. Rental income is gross revenue."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Only homes are sold/)).toBeInTheDocument();
    expect(screen.getByText(/Retirement accounts remain at face value/)).toBeInTheDocument();

    const details = screen.getAllByText("View calculation").map((summary) =>
      summary.closest("details"),
    );
    expect(details).toHaveLength(2);
    expect(details[0]).not.toHaveAttribute("open");
    expect(details[1]).not.toHaveAttribute("open");

    fireEvent.click(within(details[0]!).getByText("View calculation"));
    expect(within(details[0]!).getByText("Non-home net worth")).toBeInTheDocument();
    expect(within(details[0]!).getByText("Withdrawal rate")).toBeInTheDocument();
    expect(within(details[0]!).getByText("Withdrawal income")).toBeInTheDocument();
    expect(within(details[0]!).getByText("Gross rental income")).toBeInTheDocument();
    expect(within(details[0]!).getByText("Annual pre-tax income")).toBeInTheDocument();

    fireEvent.click(within(details[1]!).getByText("View calculation"));
    expect(within(details[1]!).getByText("Gross home equity")).toBeInTheDocument();
    expect(within(details[1]!).getByText("Selling costs")).toBeInTheDocument();
    expect(within(details[1]!).getByText("Estimated incremental sale tax")).toBeInTheDocument();
    expect(within(details[1]!).getByText("Net home proceeds")).toBeInTheDocument();
    expect(within(details[1]!).getByText("Liquid net worth")).toBeInTheDocument();
  });

  it("keeps the available story visible and lists every structured sale issue", () => {
    vi.mocked(calculateRetirementSnapshot).mockReturnValue({
      ...availableResult,
      sellHomes: {
        available: false,
        issues: [
          {
            assetId: "home",
            assetName: "Oak Street",
            field: "purchaseDate",
            message: "Add a purchase date for Oak Street.",
          },
          {
            assetId: "rental",
            assetName: "Pine Street",
            field: "rentalUse",
            message: "Review rental use for Pine Street; mixed-use sale tax is not supported.",
          },
        ],
      },
    });

    render(
      <RetirementView
        initial={initial}
        repository={repository()}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );

    expect(screen.getByText("$1,250,000")).toBeInTheDocument();
    const keepStory = screen.getByRole("heading", { name: "If you keep your homes" }).closest("article")!;
    expect(within(keepStory).getAllByText("$19,800")).toHaveLength(2);
    const sellStory = screen.getByRole("heading", { name: "If you sell all homes" }).closest("article")!;
    expect(within(sellStory).getAllByText("Unavailable")).toHaveLength(2);
    fireEvent.click(within(sellStory).getByText("View calculation"));
    expect(within(sellStory).getByText("Add a purchase date for Oak Street.")).toBeInTheDocument();
    expect(
      within(sellStory).getByText(
        "Review rental use for Pine Street; mixed-use sale tax is not supported.",
      ),
    ).toBeInTheDocument();
  });

  it("removes prior financial figures when projection calculation fails", () => {
    render(
      <RetirementView
        initial={initial}
        repository={repository()}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );
    expect(screen.getByText("$1,250,000")).toBeInTheDocument();

    vi.mocked(buildRetirementCutoff).mockImplementation(() => {
      throw new RangeError("Missing projection balances for 2042-08");
    });
    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Missing projection balances for 2042-08");
    expect(screen.queryByText(/\$[\d,]+/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Retirement month")).toBeInTheDocument();
  });
});
