import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { startTransition, StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRetirementCutoff,
  calculateRetirementProjection,
  type FinancialSnapshot,
  type RetirementCutoff,
  type RetirementProjectionResult,
  type RetirementProjectionYear,
  type RetirementSnapshotResult,
  type Scenario,
} from "./domain";
import type {
  Bootstrap,
  BootstrapAccount,
  Repository,
  RetirementSettingsRecord,
} from "./repository";
import { financialSnapshotFromBootstrap } from "./financialSnapshot";
import { RetirementView } from "./RetirementView";

vi.mock("./domain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domain")>();
  return {
    ...actual,
    buildRetirementCutoff: vi.fn(),
    calculateRetirementProjection: vi.fn(),
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

const availableProjection = {
  retirementMonth: "2042-01",
  firstWithdrawalDate: "2042-12-31",
  withdrawalRateBps: 300,
  netWorthCents: 126_000_000,
  keepHomes: {
    available: true,
    summary: {
      ...availableResult.keepHomes,
      annualPreTaxIncomeCents: 2_050_000,
    },
    years: [],
    warnings: [],
  },
  sellHomes: {
    available: true,
    summary: {
      available: true,
      grossHomeEquityCents: 75_000_000,
      sellingCostsCents: 4_500_000,
      incrementalSaleTaxCents: 2_500_000,
      netHomeProceedsCents: 68_000_000,
      liquidNetWorthCents: 119_000_000,
      annualPreTaxIncomeCents: 3_570_000,
    },
    years: [],
    warnings: [],
  },
  effectiveWithdrawalOrder: [],
  resolvedHomeSales: { homes: [], issues: [], sales: [] },
  warnings: [],
} satisfies RetirementProjectionResult;

const annualProjectionRow = {
  year: 2042,
  ages: [{ personId: "person", name: "Person", age: 62 }],
  startingPortfolioCents: 1_260_000_00,
  withdrawalTargetCents: 37_800_00,
  withdrawalFundedCents: 37_800_00,
  otherPreTaxIncomeCents: 0,
  rentalIncomeCents: 20_500_00,
  estimatedTaxCents: 8_000_00,
  earlyPenaltyCents: 0,
  afterTaxIncomeCents: 50_300_00,
  planExpenseCents: 40_000_00,
  housingExpenseCents: 8_000_00,
  surplusCents: 2_300_00,
  shortfallCents: 0,
  destinationBalanceCents: 2_300_00,
  endingNetWorthCents: 1_270_000_00,
  endingBalances: { accounts: {}, assets: {}, liabilities: {} },
  housing: {
    principalCents: 3_000_00,
    interestCents: 3_000_00,
    propertyTaxCents: 1_000_00,
    insuranceCents: 500_00,
    hoaCents: 300_00,
    maintenanceCents: 200_00,
  },
  withdrawalSources: [],
  warnings: [],
} satisfies RetirementProjectionYear;

const initial: RetirementSettingsRecord = {
  householdId: "household",
  retirementMonth: "2042-01",
  withdrawalRateBps: 300,
  horizonYears: 30,
  taxableDestinationAccountId: null,
  withdrawalAccountOrder: [],
  selectedScenario: "keep-homes",
  revision: 1,
};

const repository = (updateRetirementPlan = vi.fn()): Repository => ({
  bootstrap: vi.fn(),
  retryStartup: vi.fn(),
  saveOnboardingStep: vi.fn(),
  completeOnboarding: vi.fn(),
  updateRetirementPlan,
});

const bootstrapAccount = (
  values: Partial<BootstrapAccount> & Pick<BootstrapAccount, "id" | "name" | "kind">,
): BootstrapAccount => ({
  householdId: "household",
  openingBalanceCents: 100_000,
  balanceCents: 100_000,
  annualReturnBps: 300,
  liquid: true,
  revision: 1,
  ...values,
});

const withAccounts = (accounts: readonly BootstrapAccount[]) => ({
  bootstrap: { ...bootstrap, accounts: [...accounts] },
  snapshot: {
    ...snapshot,
    accounts: accounts.map(({ householdId: _householdId, openingBalanceCents: _opening, revision: _revision, ...account }) => account),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildRetirementCutoff).mockReturnValue(cutoff);
  vi.mocked(calculateRetirementProjection).mockReturnValue(availableProjection);
});

describe("RetirementView settings and autosave", () => {
  // Break caught: omitting new-setting defaults would leave a fresh retirement plan incomplete or silently autosave it on mount.
  it("defaults to next January, 3%, and 30 years without saving on mount", () => {
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
    expect(screen.getByLabelText("Retirement month")).toBeValid();
    expect(screen.getByLabelText("Withdrawal rate")).toHaveValue(3);
    expect(screen.getByLabelText("Withdrawal rate")).toBeValid();
    expect(screen.getByLabelText("Years in retirement")).toHaveValue(30);
    expect(screen.getByLabelText("Years in retirement")).toBeValid();
    expect(screen.getByRole("heading", { name: "Build the ADU" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText(/Add a taxable brokerage account/i)).toBeInTheDocument();
    expect(updateRetirementPlan).not.toHaveBeenCalled();
    expect(calculateRetirementProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: activeScenario,
        settings: expect.objectContaining({ retirementMonth: nextJanuary }),
      }),
    );
    expect(JSON.stringify(activeScenario)).toBe(before);
  });

  // Break caught: normalizing without bootstrap accounts would discard the only valid sale-proceeds destination from every autosave.
  it("auto-selects one taxable account and serializes every setting field", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
    });
    const values = withAccounts([brokerage]);
    const starting = { ...initial, retirementMonth: "2042-09" };
    const updateRetirementPlan = vi.fn().mockResolvedValue({
      ...starting,
      horizonYears: 40,
      taxableDestinationAccountId: "brokerage",
      revision: 2,
    });

    render(
      <RetirementView
        initial={starting}
        repository={repository(updateRetirementPlan)}
        bootstrap={values.bootstrap}
        snapshot={values.snapshot}
        scenario={activeScenario}
      />,
    );

    expect(screen.queryByRole("combobox", { name: "Taxable destination" })).not.toBeInTheDocument();
    expect(screen.getByText(/Brokerage is the taxable destination/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Years in retirement"), {
      target: { value: "40" },
    });

    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(1));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-09",
      withdrawalRateBps: 300,
      horizonYears: 40,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 1,
    });
  });

  // Break caught: treating an ambiguous destination as optional would save proceeds without a user-selected taxable account.
  it("requires an explicit taxable destination when several accounts are eligible", async () => {
    const first = bootstrapAccount({ id: "brokerage", name: "Brokerage", kind: "investment" });
    const second = bootstrapAccount({ id: "joint", name: "Joint investing", kind: "investment" });
    const values = withAccounts([first, second]);
    const updateRetirementPlan = vi.fn().mockResolvedValue({
      ...initial,
      horizonYears: 40,
      taxableDestinationAccountId: "brokerage",
      revision: 2,
    });

    render(
      <RetirementView
        initial={initial}
        repository={repository(updateRetirementPlan)}
        bootstrap={values.bootstrap}
        snapshot={values.snapshot}
        scenario={activeScenario}
      />,
    );

    const destination = screen.getByRole("combobox", { name: "Taxable destination" });
    expect(destination).toHaveValue("");
    expect(destination).toBeInvalid();
    expect(screen.getByRole("option", { name: "Choose an account" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Years in retirement"), {
      target: { value: "40" },
    });
    expect(updateRetirementPlan).not.toHaveBeenCalled();

    fireEvent.change(destination, { target: { value: "brokerage" } });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(1));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-01",
      withdrawalRateBps: 300,
      horizonYears: 40,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 1,
    });
  });

  // Break caught: accepting blank, fractional, zero, or excessive horizons would persist unsupported projection lengths.
  it.each(["", "0", "12.5", "61"])(
    "does not autosave the invalid retirement horizon %j",
    async (value) => {
      const updateRetirementPlan = vi.fn();
      render(
        <RetirementView
          initial={initial}
          repository={repository(updateRetirementPlan)}
          bootstrap={bootstrap}
          snapshot={snapshot}
          scenario={activeScenario}
        />,
      );

      const horizon = screen.getByLabelText("Years in retirement");
      fireEvent.change(horizon, { target: { value } });
      expect(horizon).toBeInvalid();
      await act(async () => Promise.resolve());
      expect(updateRetirementPlan).not.toHaveBeenCalled();
    },
  );

  // Break caught: a partial or opaque withdrawal list would prevent users from understanding age-sensitive tax order or restoring automation.
  it("shows a complete owner-aware withdrawal order, reorders it, and restores automatic order", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
      ownerPersonId: "person",
    });
    const checking = bootstrapAccount({ id: "checking", name: "Checking", kind: "checking" });
    const ira = bootstrapAccount({
      id: "ira",
      name: "Traditional IRA",
      kind: "retirement",
      subtype: "traditional-ira",
      ownerPersonId: "younger",
    });
    const roth = bootstrapAccount({
      id: "roth",
      name: "Roth IRA",
      kind: "retirement",
      subtype: "roth-ira",
      ownerPersonId: "person",
      rothOpeningYear: 2038,
    });
    const values = withAccounts([brokerage, checking, ira, roth]);
    values.bootstrap.people = [
      { id: "person", householdId: "household", name: "Avery", birthDate: "1970-01-01" },
      { id: "younger", householdId: "household", name: "Jordan", birthDate: "2000-01-01" },
    ];
    values.snapshot.household = {
      ...values.snapshot.household,
      people: values.bootstrap.people.map(({ householdId: _householdId, revision: _revision, ...person }) => ({
        ...person,
        birthDate: person.birthDate ?? undefined,
      })),
    };
    const updateRetirementPlan = vi
      .fn()
      .mockImplementation(async (input) => ({
        householdId: "household",
        ...input,
        revision: input.expectedRevision + 1,
      }));

    render(
      <RetirementView
        initial={initial}
        repository={repository(updateRetirementPlan)}
        bootstrap={values.bootstrap}
        snapshot={values.snapshot}
        scenario={activeScenario}
      />,
    );

    fireEvent.click(screen.getByText("Withdrawal order"));
    const order = screen.getByRole("group", { name: "Withdrawal order" });
    expect(within(order).getByText("Brokerage")).toBeInTheDocument();
    expect(within(order).getByText("Checking")).toBeInTheDocument();
    expect(within(order).getByText("Traditional IRA")).toBeInTheDocument();
    expect(within(order).getByText("Roth IRA")).toBeInTheDocument();
    expect(within(order).getByText(/Avery.*Taxable.*Age 72 at first annual draw/)).toBeInTheDocument();
    expect(within(order).getByText(/Household.*Cash.*Age not applicable/)).toBeInTheDocument();
    expect(within(order).getByText(/Jordan.*Pre-tax.*Age 42 at first annual draw.*penalty may apply/)).toBeInTheDocument();
    expect(within(order).getByText(/Taxable sales may realize capital gains/)).toBeInTheDocument();
    expect(within(order).getByText(/ordinary income.*early-withdrawal penalty/i)).toBeInTheDocument();
    expect(within(order).getByText(/five tax years.*preserved last.*tax-free growth/i)).toBeInTheDocument();

    fireEvent.click(within(order).getByRole("button", { name: "Move Brokerage down" }));
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(1));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        withdrawalAccountOrder: ["checking", "brokerage", "ira", "roth"],
        taxableDestinationAccountId: "brokerage",
        expectedRevision: 1,
      }),
    );

    fireEvent.click(within(order).getByRole("button", { name: "Use automatic order" }));
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ withdrawalAccountOrder: [], expectedRevision: 2 }),
    );
  });

  // Production mutations caught: recomputing order and age at the retirement-month
  // start makes the UI disagree with the boundary's period-end withdrawal treatment.
  it("shows the boundary order and owner age at the first annual draw", () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
      subtype: "taxable-brokerage",
    });
    const checking = bootstrapAccount({
      id: "checking",
      name: "Checking",
      kind: "checking",
      subtype: "cash",
    });
    const ira = bootstrapAccount({
      id: "ira",
      name: "Traditional IRA",
      kind: "retirement",
      subtype: "traditional-ira",
      ownerPersonId: "person",
    });
    const values = withAccounts([brokerage, checking, ira]);
    values.bootstrap.people = [{
      id: "person",
      householdId: "household",
      name: "Morgan",
      birthDate: "1971-06-01",
    }];
    values.snapshot.household = {
      ...values.snapshot.household,
      people: [{ id: "person", name: "Morgan", birthDate: "1971-06-01" }],
    };
    vi.mocked(calculateRetirementProjection).mockReturnValue({
      ...availableProjection,
      firstWithdrawalDate: "2031-08-31",
      effectiveWithdrawalOrder: ["brokerage", "ira", "checking"],
    });

    render(
      <RetirementView
        initial={{
          ...initial,
          retirementMonth: "2030-09",
          taxableDestinationAccountId: "brokerage",
        }}
        repository={repository()}
        bootstrap={values.bootstrap}
        snapshot={values.snapshot}
        scenario={activeScenario}
      />,
    );

    fireEvent.click(screen.getByText("Withdrawal order"));
    const order = screen.getByRole("group", { name: "Withdrawal order" });
    expect(within(order).getAllByRole("listitem").map((row) =>
      row.querySelector("strong")?.textContent)).toEqual([
      "Brokerage",
      "Traditional IRA",
      "Checking",
    ]);
    expect(within(order).getByText(/Morgan.*Pre-tax.*Age 60 at first annual draw/))
      .toBeInTheDocument();
    expect(within(order).queryByText(/penalty may apply/)).not.toBeInTheDocument();
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

  it("does not recalculate while inactive and uses the latest Plan on activation", () => {
    const { rerender } = render(
      <RetirementView
        active
        initial={initial}
        repository={repository()}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );
    expect(calculateRetirementProjection).toHaveBeenCalledTimes(1);

    rerender(
      <RetirementView
        active={false}
        initial={initial}
        repository={repository()}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );
    vi.mocked(calculateRetirementProjection).mockClear();
    const latestScenario = { ...activeScenario, name: "Latest active Plan" };
    rerender(
      <RetirementView
        active={false}
        initial={initial}
        repository={repository()}
        bootstrap={bootstrap}
        snapshot={{ ...snapshot, assets: [...snapshot.assets] }}
        scenario={latestScenario}
      />,
    );
    expect(calculateRetirementProjection).not.toHaveBeenCalled();

    rerender(
      <RetirementView
        active
        initial={initial}
        repository={repository()}
        bootstrap={bootstrap}
        snapshot={{ ...snapshot, assets: [...snapshot.assets] }}
        scenario={latestScenario}
      />,
    );
    expect(calculateRetirementProjection).toHaveBeenCalledTimes(1);
    expect(calculateRetirementProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({ scenario: latestScenario }),
    );
  });

  // Break caught: editing the legacy controls would drop normalized migration settings from the persisted plan update.
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
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 1,
    });

    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "3.5" },
    });
    expect(screen.getByLabelText("Withdrawal rate")).toBeValid();
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
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 2,
    });
    expect(calculateRetirementProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scenario: activeScenario,
        settings: expect.objectContaining({
          retirementMonth: "2042-09",
          withdrawalRateBps: 350,
        }),
      }),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...initial,
      retirementMonth: "2042-09",
      withdrawalRateBps: 350,
      revision: 3,
    });
  });

  it("resets to an authoritative replacement and ignores an older save generation", async () => {
    let finishOldSave: ((record: RetirementSettingsRecord) => void) | undefined;
    const restored: RetirementSettingsRecord = {
      householdId: "household",
      retirementMonth: "2050-06",
      withdrawalRateBps: 425,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      revision: 11,
    };
    const updateRetirementPlan = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<RetirementSettingsRecord>((resolve) => { finishOldSave = resolve; }),
      )
      .mockResolvedValueOnce({ ...restored, withdrawalRateBps: 450, revision: 12 });
    const onSettingsChange = vi.fn();
    const view = (
      record: RetirementSettingsRecord,
      value: Bootstrap,
    ) => (
      <RetirementView
        active
        initial={record}
        repository={repository(updateRetirementPlan)}
        bootstrap={value}
        snapshot={snapshot}
        scenario={activeScenario}
        onSettingsChange={onSettingsChange}
      />
    );
    const { rerender } = render(view(initial, bootstrap));
    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });
    expect(updateRetirementPlan).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    rerender(view(restored, { ...bootstrap, retirementPlan: restored }));
    expect(screen.getByLabelText("Retirement month")).toHaveValue("2050-06");
    expect(screen.getByLabelText("Withdrawal rate")).toHaveValue(4.25);
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "4.5" },
    });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2050-06",
      withdrawalRateBps: 450,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 11,
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...restored,
      withdrawalRateBps: 450,
      revision: 12,
    });

    await act(async () => {
      finishOldSave?.({ ...initial, retirementMonth: "2042-09", revision: 2 });
      await Promise.resolve();
    });
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Retirement month")).toHaveValue("2050-06");
    expect(screen.getByLabelText("Withdrawal rate")).toHaveValue(4.5);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("clears a failed save when authoritative settings replace the draft", async () => {
    const restored: RetirementSettingsRecord = {
      householdId: "household",
      retirementMonth: "2050-06",
      withdrawalRateBps: 425,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      revision: 11,
    };
    const updateRetirementPlan = vi
      .fn()
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({ ...restored, retirementMonth: "2051-07", revision: 12 });
    const view = (record: RetirementSettingsRecord, value: Bootstrap) => (
      <RetirementView
        active
        initial={record}
        repository={repository(updateRetirementPlan)}
        bootstrap={value}
        snapshot={snapshot}
        scenario={activeScenario}
      />
    );
    const { rerender } = render(view(initial, bootstrap));
    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });
    expect(
      await screen.findByRole("button", { name: "Save failed — retry" }),
    ).toBeInTheDocument();

    rerender(view(restored, { ...bootstrap, retirementPlan: restored }));
    expect(
      screen.queryByRole("button", { name: "Save failed — retry" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Retirement month")).toHaveValue("2050-06");
    expect(screen.getByLabelText("Withdrawal rate")).toHaveValue(4.25);

    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2051-07" },
    });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2051-07",
      withdrawalRateBps: 425,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 11,
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("persists the valid basis-point boundaries and retries a failed save", async () => {
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
      target: { value: "0.01" },
    });

    const retry = await screen.findByRole("button", { name: "Save failed — retry" });
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-01",
      withdrawalRateBps: 1,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 1,
    });
    fireEvent.click(retry);
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-01",
      withdrawalRateBps: 1,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 1,
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "100" },
    });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(3));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-01",
      withdrawalRateBps: 10_000,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 2,
    });
  });

  it("keeps blank and invalid partial drafts out of calculation and persistence", async () => {
    const updateRetirementPlan = vi.fn().mockResolvedValue({
      ...initial,
      retirementMonth: "2042-09",
      withdrawalRateBps: 350,
      revision: 2,
    });

    render(
      <RetirementView
        initial={initial}
        repository={repository(updateRetirementPlan)}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );
    const initialProjectionCalls = vi.mocked(calculateRetirementProjection).mock.calls.length;

    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "" },
    });
    expect(screen.getByLabelText("Retirement month")).toHaveValue("");
    expect(screen.getByLabelText("Withdrawal rate")).toHaveValue(null);
    expect(updateRetirementPlan).not.toHaveBeenCalled();
    expect(calculateRetirementProjection).toHaveBeenCalledTimes(initialProjectionCalls);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "3.555" },
    });
    expect(screen.getByLabelText("Withdrawal rate")).toBeInvalid();
    expect(updateRetirementPlan).not.toHaveBeenCalled();
    expect(calculateRetirementProjection).toHaveBeenCalledTimes(initialProjectionCalls);

    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });
    expect(updateRetirementPlan).not.toHaveBeenCalled();
    expect(calculateRetirementProjection).toHaveBeenCalledTimes(initialProjectionCalls);
    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "3.5" },
    });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(1));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-09",
      withdrawalRateBps: 350,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 1,
    });
  });

  it("removes retry for an invalid visible draft and saves only once it is complete", async () => {
    const updateRetirementPlan = vi
      .fn()
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({
        ...initial,
        retirementMonth: "2043-03",
        withdrawalRateBps: 350,
        revision: 2,
      });

    render(
      <RetirementView
        active
        initial={initial}
        repository={repository(updateRetirementPlan)}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );
    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });
    expect(
      await screen.findByRole("button", { name: "Save failed — retry" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "" },
    });
    expect(
      screen.queryByRole("button", { name: "Save failed — retry" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2043-03" },
    });
    expect(updateRetirementPlan).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "3.5" },
    });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2043-03",
      withdrawalRateBps: 350,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 1,
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  // Break caught: treating a normalization-derived sole destination as persisted would silently keep it after a second taxable account makes the choice ambiguous.
  it("reconciles an implicit sole destination to unresolved without discarding an invalid draft", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
    });
    const joint = bootstrapAccount({
      id: "joint",
      name: "Joint investing",
      kind: "investment",
    });
    const updateRetirementPlan = vi.fn();
    const view = (accounts: readonly BootstrapAccount[]) => {
      const values = withAccounts(accounts);
      return (
        <RetirementView
          initial={initial}
          repository={repository(updateRetirementPlan)}
          bootstrap={values.bootstrap}
          snapshot={values.snapshot}
          scenario={activeScenario}
        />
      );
    };
    const { rerender } = render(view([brokerage]));
    expect(screen.getByText(/Brokerage is the taxable destination/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Withdrawal rate"), {
      target: { value: "" },
    });

    rerender(view([brokerage, joint]));

    const destination = screen.getByRole("combobox", { name: "Taxable destination" });
    await waitFor(() => expect(destination).toHaveValue(""));
    expect(destination).toBeInvalid();
    expect(screen.getByLabelText("Withdrawal rate")).toHaveValue(null);
    expect(updateRetirementPlan).not.toHaveBeenCalled();
    expect(calculateRetirementProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ taxableDestinationAccountId: null }),
      }),
    );
  });

  // Break caught: deriving every sole destination as implicit would erase a user's persisted destination when another eligible account appears.
  it("keeps an explicitly persisted sole destination when accounts become multiple", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
    });
    const joint = bootstrapAccount({
      id: "joint",
      name: "Joint investing",
      kind: "investment",
    });
    const updateRetirementPlan = vi.fn();
    const persisted = { ...initial, taxableDestinationAccountId: "brokerage" };
    const view = (accounts: readonly BootstrapAccount[]) => {
      const values = withAccounts(accounts);
      return (
        <RetirementView
          initial={persisted}
          repository={repository(updateRetirementPlan)}
          bootstrap={values.bootstrap}
          snapshot={values.snapshot}
          scenario={activeScenario}
        />
      );
    };
    const { rerender } = render(view([brokerage]));

    rerender(view([brokerage, joint]));

    const destination = screen.getByRole("combobox", { name: "Taxable destination" });
    await waitFor(() => expect(destination).toHaveValue("brokerage"));
    expect(destination).toBeValid();
    expect(updateRetirementPlan).not.toHaveBeenCalled();
  });

  // Break caught: ignoring account changes would leave a newly unambiguous sole destination null in the next completed autosave.
  it("auto-selects a destination when multiple accounts become one and preserves a partial draft", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
    });
    const joint = bootstrapAccount({
      id: "joint",
      name: "Joint investing",
      kind: "investment",
    });
    const updateRetirementPlan = vi.fn().mockResolvedValue({
      ...initial,
      horizonYears: 40,
      taxableDestinationAccountId: "brokerage",
      revision: 2,
    });
    const view = (accounts: readonly BootstrapAccount[]) => {
      const values = withAccounts(accounts);
      return (
        <RetirementView
          initial={initial}
          repository={repository(updateRetirementPlan)}
          bootstrap={values.bootstrap}
          snapshot={values.snapshot}
          scenario={activeScenario}
        />
      );
    };
    const { rerender } = render(view([brokerage, joint]));
    fireEvent.change(screen.getByLabelText("Years in retirement"), {
      target: { value: "12.5" },
    });

    rerender(view([brokerage]));

    await waitFor(() => {
      expect(screen.getByText(/Brokerage is the taxable destination/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Years in retirement")).toHaveValue(12.5);
    expect(updateRetirementPlan).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Years in retirement"), {
      target: { value: "40" },
    });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(1));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        horizonYears: 40,
        taxableDestinationAccountId: "brokerage",
        expectedRevision: 1,
      }),
    );
  });

  // Break caught: retaining a deleted explicit destination in projection state would model proceeds against an account the user can no longer select.
  it("makes a deleted selected destination unresolved among remaining accounts without a stale save", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
    });
    const joint = bootstrapAccount({
      id: "joint",
      name: "Joint investing",
      kind: "investment",
    });
    const trust = bootstrapAccount({
      id: "trust",
      name: "Trust investing",
      kind: "investment",
    });
    const persisted = { ...initial, taxableDestinationAccountId: "brokerage" };
    const updateRetirementPlan = vi.fn().mockResolvedValue({
      ...persisted,
      taxableDestinationAccountId: "joint",
      revision: 2,
    });
    const view = (accounts: readonly BootstrapAccount[]) => {
      const values = withAccounts(accounts);
      return (
        <RetirementView
          initial={persisted}
          repository={repository(updateRetirementPlan)}
          bootstrap={values.bootstrap}
          snapshot={values.snapshot}
          scenario={activeScenario}
        />
      );
    };
    const { rerender } = render(view([brokerage, joint, trust]));

    rerender(view([joint, trust]));

    const destination = screen.getByRole("combobox", { name: "Taxable destination" });
    await waitFor(() => expect(destination).toHaveValue(""));
    expect(destination).toBeInvalid();
    expect(updateRetirementPlan).not.toHaveBeenCalled();
    expect(calculateRetirementProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ taxableDestinationAccountId: null }),
      }),
    );
    fireEvent.change(destination, { target: { value: "joint" } });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(1));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taxableDestinationAccountId: "joint",
        expectedRevision: 1,
      }),
    );
  });

  // Break caught: rebuilding a failed retry from an unreconciled draft would resend deleted, duplicate, or unknown withdrawal account IDs.
  it("reconciles withdrawal IDs after account replacement while preserving a failed unrelated edit", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
    });
    const checking = bootstrapAccount({ id: "checking", name: "Checking", kind: "checking" });
    const ira = bootstrapAccount({
      id: "ira",
      name: "Traditional IRA",
      kind: "retirement",
      subtype: "traditional-ira",
    });
    const roth = bootstrapAccount({
      id: "roth",
      name: "Roth IRA",
      kind: "retirement",
      subtype: "roth-ira",
    });
    const persisted = {
      ...initial,
      withdrawalAccountOrder: ["ira", "ira", "missing", "brokerage"],
    };
    const updateRetirementPlan = vi
      .fn()
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({
        ...persisted,
        retirementMonth: "2042-09",
        withdrawalAccountOrder: ["brokerage"],
        revision: 2,
      });
    const view = (accounts: readonly BootstrapAccount[]) => {
      const values = withAccounts(accounts);
      return (
        <RetirementView
          initial={persisted}
          repository={repository(updateRetirementPlan)}
          bootstrap={values.bootstrap}
          snapshot={values.snapshot}
          scenario={activeScenario}
        />
      );
    };
    const { rerender } = render(view([brokerage, checking, ira]));
    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });
    expect(
      await screen.findByRole("button", { name: "Save failed — retry" }),
    ).toBeInTheDocument();

    rerender(view([brokerage, checking, roth]));

    fireEvent.click(screen.getByText("Withdrawal order"));
    const order = screen.getByRole("group", { name: "Withdrawal order" });
    await waitFor(() => expect(within(order).queryByText("Traditional IRA")).not.toBeInTheDocument());
    expect(within(order).getByText("Brokerage")).toBeInTheDocument();
    expect(within(order).getByText("Checking")).toBeInTheDocument();
    expect(within(order).getByText("Roth IRA")).toBeInTheDocument();
    expect(screen.getByLabelText("Retirement month")).toHaveValue("2042-09");
    fireEvent.click(screen.getByRole("button", { name: "Save failed — retry" }));
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        retirementMonth: "2042-09",
        taxableDestinationAccountId: "brokerage",
        withdrawalAccountOrder: ["brokerage"],
        expectedRevision: 1,
      }),
    );
  });

  // Break caught: adopting a save dispatched before an account deletion would echo stale IDs and skip the revision-correct reconciliation save.
  it("ignores a stale in-flight account payload and saves the reconciled draft at its returned revision", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
    });
    const ira = bootstrapAccount({
      id: "ira",
      name: "Traditional IRA",
      kind: "retirement",
      subtype: "traditional-ira",
    });
    const joint = bootstrapAccount({
      id: "joint",
      name: "Joint investing",
      kind: "investment",
    });
    const checking = bootstrapAccount({ id: "checking", name: "Checking", kind: "checking" });
    const persisted = {
      ...initial,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: ["ira", "brokerage"],
    };
    let finishStaleSave: ((record: RetirementSettingsRecord) => void) | undefined;
    const updateRetirementPlan = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<RetirementSettingsRecord>((resolve) => {
          finishStaleSave = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...persisted,
        retirementMonth: "2042-09",
        taxableDestinationAccountId: "joint",
        withdrawalAccountOrder: [],
        revision: 3,
      });
    const onSettingsChange = vi.fn();
    const view = (accounts: readonly BootstrapAccount[]) => {
      const values = withAccounts(accounts);
      return (
        <RetirementView
          initial={persisted}
          repository={repository(updateRetirementPlan)}
          bootstrap={values.bootstrap}
          snapshot={values.snapshot}
          scenario={activeScenario}
          onSettingsChange={onSettingsChange}
        />
      );
    };
    const { rerender } = render(view([brokerage, ira]));
    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });
    expect(updateRetirementPlan).toHaveBeenCalledTimes(1);
    expect(updateRetirementPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taxableDestinationAccountId: "brokerage",
        withdrawalAccountOrder: ["ira", "brokerage"],
        expectedRevision: 1,
      }),
    );

    rerender(view([joint, checking]));
    expect(screen.getByText(/Joint investing is the taxable destination/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Retirement month")).toHaveValue("2042-09");
    expect(onSettingsChange).not.toHaveBeenCalled();

    await act(async () => {
      finishStaleSave?.({
        ...persisted,
        retirementMonth: "2042-09",
        revision: 2,
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-09",
      withdrawalRateBps: 300,
      horizonYears: 30,
      taxableDestinationAccountId: "joint",
      withdrawalAccountOrder: [],
      selectedScenario: "keep-homes",
      expectedRevision: 2,
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...persisted,
      retirementMonth: "2042-09",
      taxableDestinationAccountId: "joint",
      withdrawalAccountOrder: [],
      revision: 3,
    });
    expect(calculateRetirementProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          retirementMonth: "2042-09",
          taxableDestinationAccountId: "joint",
          withdrawalAccountOrder: [],
        }),
      }),
    );
  });

  // Break caught: checking account generation only in a passive effect would emit a stale save resolved after the deletion commit but before that effect.
  it("rejects a deferred save resolved by a sibling layout effect in the account-deletion commit", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
    });
    const ira = bootstrapAccount({
      id: "ira",
      name: "Traditional IRA",
      kind: "retirement",
      subtype: "traditional-ira",
    });
    const joint = bootstrapAccount({
      id: "joint",
      name: "Joint investing",
      kind: "investment",
    });
    const checking = bootstrapAccount({ id: "checking", name: "Checking", kind: "checking" });
    const persisted = {
      ...initial,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: ["ira", "brokerage"],
    };
    let finishStaleSave: ((record: RetirementSettingsRecord) => void) | undefined;
    const updateRetirementPlan = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<RetirementSettingsRecord>((resolve) => {
          finishStaleSave = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...persisted,
        retirementMonth: "2042-09",
        taxableDestinationAccountId: "joint",
        withdrawalAccountOrder: [],
        revision: 3,
      });
    const onSettingsChange = vi.fn();
    const view = (accounts: readonly BootstrapAccount[]) => {
      const values = withAccounts(accounts);
      return (
        <RetirementView
          initial={persisted}
          repository={repository(updateRetirementPlan)}
          bootstrap={values.bootstrap}
          snapshot={values.snapshot}
          scenario={activeScenario}
          onSettingsChange={onSettingsChange}
        />
      );
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    let finishSaveResolution: (() => void) | undefined;
    const saveResolvedInLayout = new Promise<void>((resolve) => {
      finishSaveResolution = resolve;
    });
    let resolvedInLayout = false;
    function ResolveSaveInLayoutEffect() {
      useLayoutEffect(() => {
        if (resolvedInLayout) return;
        resolvedInLayout = true;
        finishStaleSave?.({
          ...persisted,
          retirementMonth: "2042-09",
          revision: 2,
        });
        const yieldStart = performance.now();
        while (performance.now() - yieldStart < 20) {
          // Force React's scheduler to yield before it flushes passive effects.
        }
        finishSaveResolution?.();
      }, []);
      return null;
    }
    function AccountRaceView({
      accounts,
      resolveSave = false,
    }: {
      accounts: readonly BootstrapAccount[];
      resolveSave?: boolean;
    }) {
      return (
        <>
          {view(accounts)}
          {resolveSave ? <ResolveSaveInLayoutEffect /> : null}
        </>
      );
    }

    try {
      await act(async () => {
        root.render(<AccountRaceView accounts={[brokerage, ira]} />);
      });
      fireEvent.change(within(container).getByLabelText("Retirement month"), {
        target: { value: "2042-09" },
      });
      expect(updateRetirementPlan).toHaveBeenCalledTimes(1);

      actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
      startTransition(() => {
        root.render(
          <AccountRaceView accounts={[joint, checking]} resolveSave />,
        );
      });
      await saveResolvedInLayout;
      await Promise.resolve();
      expect(resolvedInLayout).toBe(true);
      expect(onSettingsChange).not.toHaveBeenCalledWith({
        ...persisted,
        retirementMonth: "2042-09",
        revision: 2,
      });

      actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
      expect(updateRetirementPlan).toHaveBeenLastCalledWith({
        retirementMonth: "2042-09",
        withdrawalRateBps: 300,
        horizonYears: 30,
        taxableDestinationAccountId: "joint",
        withdrawalAccountOrder: [],
        selectedScenario: "keep-homes",
        expectedRevision: 2,
      });
      expect(await within(container).findByText("Saved")).toBeInTheDocument();
      expect(onSettingsChange).toHaveBeenCalledTimes(1);
      expect(onSettingsChange).toHaveBeenCalledWith({
        ...persisted,
        retirementMonth: "2042-09",
        taxableDestinationAccountId: "joint",
        withdrawalAccountOrder: [],
        revision: 3,
      });
      expect(within(container).getByLabelText("Retirement month")).toHaveValue("2042-09");
    } finally {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
      await act(async () => root.unmount());
      container.remove();
    }
  });

  // Break caught: a suspended account render must not poison committed save validity or leave the autosave loop waiting after React abandons it.
  it("completes a save and later edits after abandoning a suspended account render", async () => {
    const brokerage = bootstrapAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "investment",
    });
    const ira = bootstrapAccount({
      id: "ira",
      name: "Traditional IRA",
      kind: "retirement",
      subtype: "traditional-ira",
    });
    const joint = bootstrapAccount({
      id: "joint",
      name: "Joint investing",
      kind: "investment",
    });
    const checking = bootstrapAccount({ id: "checking", name: "Checking", kind: "checking" });
    const persisted = {
      ...initial,
      taxableDestinationAccountId: "brokerage",
      withdrawalAccountOrder: ["ira", "brokerage"],
    };
    let finishFirstSave: ((record: RetirementSettingsRecord) => void) | undefined;
    const updateRetirementPlan = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<RetirementSettingsRecord>((resolve) => {
          finishFirstSave = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...persisted,
        retirementMonth: "2042-09",
        withdrawalRateBps: 350,
        revision: 3,
      });
    const onSettingsChange = vi.fn();
    const view = (accounts: readonly BootstrapAccount[]) => {
      const values = withAccounts(accounts);
      return (
        <RetirementView
          initial={persisted}
          repository={repository(updateRetirementPlan)}
          bootstrap={values.bootstrap}
          snapshot={values.snapshot}
          scenario={activeScenario}
          onSettingsChange={onSettingsChange}
        />
      );
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    let finishSuspendedRender: (() => void) | undefined;
    const suspendedRenderStarted = new Promise<void>((resolve) => {
      finishSuspendedRender = resolve;
    });
    const suspendedForever = new Promise<void>(() => undefined);
    let resolvedDuringRender = false;
    function ResolveSaveAndSuspend(): null {
      if (!resolvedDuringRender) {
        resolvedDuringRender = true;
        finishFirstSave?.({
          ...persisted,
          retirementMonth: "2042-09",
          revision: 2,
        });
        finishSuspendedRender?.();
      }
      throw suspendedForever;
    }
    function AccountRaceView({
      accounts,
      suspend = false,
    }: {
      accounts: readonly BootstrapAccount[];
      suspend?: boolean;
    }) {
      return (
        <>
          {view(accounts)}
          {suspend ? <ResolveSaveAndSuspend /> : null}
        </>
      );
    }

    try {
      await act(async () => {
        root.render(<AccountRaceView accounts={[brokerage, ira]} />);
      });
      fireEvent.change(within(container).getByLabelText("Retirement month"), {
        target: { value: "2042-09" },
      });
      expect(updateRetirementPlan).toHaveBeenCalledTimes(1);

      actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
      startTransition(() => {
        root.render(
          <AccountRaceView accounts={[joint, checking]} suspend />,
        );
      });
      await suspendedRenderStarted;
      await Promise.resolve();

      actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
      await act(async () => {
        root.render(<AccountRaceView accounts={[brokerage, ira]} />);
        await Promise.resolve();
      });

      await waitFor(() => expect(onSettingsChange).toHaveBeenCalledTimes(1));
      expect(onSettingsChange).toHaveBeenLastCalledWith({
        ...persisted,
        retirementMonth: "2042-09",
        revision: 2,
      });
      expect(await within(container).findByText("Saved")).toBeInTheDocument();

      fireEvent.change(within(container).getByLabelText("Withdrawal rate"), {
        target: { value: "3.5" },
      });
      await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
      expect(updateRetirementPlan).toHaveBeenLastCalledWith({
        retirementMonth: "2042-09",
        withdrawalRateBps: 350,
        horizonYears: 30,
        taxableDestinationAccountId: "brokerage",
        withdrawalAccountOrder: ["ira", "brokerage"],
        selectedScenario: "keep-homes",
        expectedRevision: 2,
      });
      await waitFor(() => expect(onSettingsChange).toHaveBeenCalledTimes(2));
    } finally {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

describe("RetirementView snapshot stories", () => {
  // Break caught: rendering summaries and annual rows from separate calculators lets the first-year income disagree and leaves Sell selection on Keep data.
  it("reconciles real Keep and Sell headlines with their first annual rows", async () => {
    const actualDomain = await vi.importActual<typeof import("./domain")>("./domain");
    vi.mocked(calculateRetirementProjection).mockImplementation(
      actualDomain.calculateRetirementProjection,
    );
    const taxable = bootstrapAccount({
      id: "taxable",
      name: "Taxable brokerage",
      kind: "investment",
      openingBalanceCents: 100_000_000,
      balanceCents: 100_000_000,
      annualReturnBps: 0,
      subtype: "taxable-brokerage",
      taxableCostBasisCents: 100_000_000,
    });
    const home = {
      id: "home",
      householdId: "household",
      name: "Home",
      valueCents: 50_000_000,
      annualGrowthBps: 0,
      housingCosts: {
        propertyTaxRateBps: 0,
        insuranceMonthlyCents: 0,
        insuranceAnnualGrowthBps: 0,
        hoaMonthlyCents: 0,
        hoaAnnualGrowthBps: 0,
      },
      purchasePriceCents: 40_000_000,
      purchaseDate: "2020-01-01",
      homeSaleAssumptions: {
        sellingCostBps: 0,
        primaryResidenceExclusionEligible: true,
        accumulatedFederalDepreciationCents: 0,
        accumulatedCaliforniaDepreciationCents: 0,
      },
      revision: 1,
    };
    const realBootstrap: Bootstrap = {
      ...bootstrap,
      people: [{
        id: "person",
        householdId: "household",
        name: "Person",
        birthDate: "1980-06-15",
      }],
      taxProfile: {
        ...bootstrap.taxProfile!,
        taxUnit: {
          id: "single",
          filingStatus: "single",
          memberPersonIds: ["person"],
        },
      },
      accounts: [taxable],
      assets: [home],
    };
    const realSnapshot = financialSnapshotFromBootstrap(realBootstrap);
    const realScenario: Scenario = {
      ...activeScenario,
      events: [{
        id: "rent-home",
        date: "2027-01-01",
        type: "property-rental-start",
        assetId: "home",
        name: "Rent Home",
        monthlyRentalIncomeCents: 1_000_00,
        rentalIncomeGrowthBps: 0,
        rentalUseBps: 10_000,
        rentalTaxModelingEnabled: true,
        rentalType: "long-term",
        longTermRealEstateProfessional: true,
        longTermMaterialParticipation: true,
        propertyTaxBasisCents: 40_000_000,
        buildingBasisCents: 30_000_000,
      }],
      horizon: { start: "2026-01", months: 12 },
    };
    const realSettings: RetirementSettingsRecord = {
      ...initial,
      retirementMonth: "2042-01",
      horizonYears: 1,
      taxableDestinationAccountId: "taxable",
    };
    const updateRetirementPlan = vi.fn(async (input) => ({
      householdId: "household",
      retirementMonth: input.retirementMonth,
      withdrawalRateBps: input.withdrawalRateBps,
      horizonYears: input.horizonYears,
      taxableDestinationAccountId: input.taxableDestinationAccountId,
      withdrawalAccountOrder: input.withdrawalAccountOrder,
      selectedScenario: input.selectedScenario,
      revision: input.expectedRevision + 1,
    }));

    render(
      <RetirementView
        initial={realSettings}
        repository={repository(updateRetirementPlan)}
        bootstrap={{
          ...realBootstrap,
          retirementPlan: realSettings,
        }}
        snapshot={realSnapshot}
        scenario={realScenario}
      />,
    );

    const keepStory = screen.getByRole("heading", {
      name: "If you keep your homes",
    }).closest("article")!;
    expect(within(
      within(keepStory).getByText("Estimated annual pre-tax income").parentElement!,
    ).getByText("$47,400")).toBeInTheDocument();
    expect(screen.getByRole("table", {
      name: "Keep homes annual projection",
    })).toBeInTheDocument();
    expect(screen.getByLabelText("Pre-tax withdrawal: $35,400")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View 2042 year details" }));
    expect(screen.getByLabelText("Rental income: $12,000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: "Select Sell all homes scenario",
    }));

    const sellStory = screen.getByRole("heading", {
      name: "If you sell all homes",
    }).closest("article")!;
    expect(within(
      within(sellStory).getByText("Estimated annual pre-tax income").parentElement!,
    ).getByText("$49,048")).toBeInTheDocument();
    expect(screen.getByRole("table", {
      name: "Sell all homes annual projection",
    })).toBeInTheDocument();
    expect(screen.getByLabelText(/Pre-tax withdrawal: \$49,0/)).toBeInTheDocument();
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledWith(
      expect.objectContaining({ selectedScenario: "sell-all-homes" }),
    ));
  });

  // Break caught: replacing the full-card semantic button or nesting disclosures inside it would make card whitespace and keyboard selection inaccessible.
  it("uses full-card sibling selection buttons with pressed and selected states", async () => {
    const updateRetirementPlan = vi
      .fn()
      .mockImplementation(async (input) => ({
        householdId: "household",
        ...input,
        revision: input.expectedRevision + 1,
      }));
    render(
      <RetirementView
        initial={initial}
        repository={repository(updateRetirementPlan)}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );

    const keepButton = screen.getByRole("button", { name: "Select Keep homes scenario" });
    const sellButton = screen.getByRole("button", { name: "Select Sell all homes scenario" });
    const keepStory = keepButton.closest("article")!;
    const sellStory = sellButton.closest("article")!;
    expect(keepButton).toHaveAttribute("aria-pressed", "true");
    expect(sellButton).toHaveAttribute("aria-pressed", "false");
    expect(keepStory).toHaveClass("retirement-story-selected");
    expect(sellStory).not.toHaveClass("retirement-story-selected");
    expect(keepButton).toHaveClass("retirement-scenario-select");
    expect(keepButton.querySelector("details")).toBeNull();
    expect(keepStory.querySelector("details")).toBeInTheDocument();

    fireEvent.click(sellButton);
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(1));
    expect(sellButton).toHaveAttribute("aria-pressed", "true");
    expect(sellStory).toHaveClass("retirement-story-selected");
    expect(updateRetirementPlan).toHaveBeenLastCalledWith({
      retirementMonth: "2042-01",
      withdrawalRateBps: 300,
      horizonYears: 30,
      taxableDestinationAccountId: null,
      withdrawalAccountOrder: [],
      selectedScenario: "sell-all-homes",
      expectedRevision: 1,
    });

    keepButton.focus();
    fireEvent.keyDown(keepButton, { key: "Enter", code: "Enter" });
    fireEvent.click(keepButton, { detail: 0 });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(2));
    expect(keepButton).toHaveFocus();
    expect(keepButton).toHaveAttribute("aria-pressed", "true");
    expect(updateRetirementPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedScenario: "keep-homes",
        expectedRevision: 2,
      }),
    );

    sellButton.focus();
    fireEvent.keyDown(sellButton, { key: " ", code: "Space" });
    fireEvent.keyUp(sellButton, { key: " ", code: "Space" });
    fireEvent.click(sellButton, { detail: 0 });
    await waitFor(() => expect(updateRetirementPlan).toHaveBeenCalledTimes(3));
    expect(sellButton).toHaveFocus();
    expect(sellButton).toHaveAttribute("aria-pressed", "true");
    expect(updateRetirementPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedScenario: "sell-all-homes",
        expectedRevision: 3,
      }),
    );
  });

  // Break caught: reading legacy snapshot values or ignoring an authoritative selected scenario would show stale figures and selection after reload.
  it("restores Sell selection and shows both headline values only from the domain projection", () => {
    const restored = { ...initial, selectedScenario: "sell-all-homes" as const, revision: 7 };
    const { rerender } = render(
      <RetirementView
        initial={initial}
        repository={repository()}
        bootstrap={bootstrap}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );

    rerender(
      <RetirementView
        initial={restored}
        repository={repository()}
        bootstrap={{ ...bootstrap, retirementPlan: restored }}
        snapshot={snapshot}
        scenario={activeScenario}
      />,
    );

    expect(screen.getByRole("button", { name: "Select Sell all homes scenario" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("$1,260,000")).toBeInTheDocument();
    expect(screen.getAllByText("$1,190,000")).toHaveLength(2);
    expect(screen.getAllByText("$20,500")).toHaveLength(2);
    expect(screen.getByText("$35,700")).toBeInTheDocument();
    expect(screen.queryByText("$1,250,000")).not.toBeInTheDocument();
    expect(screen.queryByText("$1,180,000")).not.toBeInTheDocument();
    expect(calculateRetirementProjection).toHaveBeenLastCalledWith({
      snapshot,
      scenario: activeScenario,
      asOfDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      settings: expect.objectContaining({
        selectedScenario: "sell-all-homes",
        horizonYears: 30,
      }),
    });
  });

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
    expect(sellStory.querySelector("header")).toBeNull();
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
    vi.mocked(calculateRetirementProjection).mockReturnValue({
      ...availableProjection,
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
        warnings: [],
        years: [],
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

    expect(screen.getByText("$1,260,000")).toBeInTheDocument();
    const keepStory = screen.getByRole("heading", { name: "If you keep your homes" }).closest("article")!;
    expect(within(keepStory).getAllByText("$20,500")).toHaveLength(2);
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

  it("renders no financial headlines or rows when the selected calculation is unavailable", () => {
    const warning = {
      code: "missing-destination" as const,
      message: "Choose a taxable destination account before calculating retirement.",
    };
    vi.mocked(calculateRetirementProjection).mockReturnValue({
      ...availableProjection,
      netWorthCents: null,
      keepHomes: {
        available: false,
        issues: [],
        warnings: [warning],
        years: [],
      },
      sellHomes: {
        available: false,
        issues: [],
        warnings: [warning],
        years: [],
      },
      warnings: [warning],
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

    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.queryByText(/\$[\d,]+/)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Projection warnings" }))
      .toHaveTextContent("Choose a taxable destination account");
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
    expect(screen.getByText("$1,260,000")).toBeInTheDocument();

    vi.mocked(calculateRetirementProjection).mockImplementation(() => {
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

  // Production mutation caught: always passing Keep data to the annual table makes unavailable Sell appear funded and hides its per-home issues.
  it("shows unavailable Sell issues in the annual table region while Keep remains selectable and populated", () => {
    vi.mocked(calculateRetirementProjection).mockReturnValue({
      ...availableProjection,
      keepHomes: { ...availableProjection.keepHomes, years: [annualProjectionRow] },
      sellHomes: {
        available: false,
        issues: [{
          assetId: "oak",
          assetName: "Oak Street",
          field: "purchaseDate",
          message: "Add a purchase date for Oak Street.",
        }],
        warnings: [],
        years: [],
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

    expect(screen.getByRole("table", { name: "Keep homes annual projection" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /2042.*Person.*62/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Sell all homes scenario" }));
    expect(screen.getByRole("region", { name: "Sell all homes annual projection" })).toHaveTextContent("Add a purchase date for Oak Street.");
    fireEvent.click(screen.getByRole("button", { name: "Select Keep homes scenario" }));
    expect(screen.getByRole("table", { name: "Keep homes annual projection" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /2042.*Person.*62/ })).toBeInTheDocument();
  });

  // Production mutation caught: retaining a prior projection after calculateRetirementProjection throws presents stale annual rows beside an error alert.
  it("clears prior annual rows when a new projection throws and shows a page-level alert", () => {
    vi.mocked(calculateRetirementProjection).mockReturnValue({
      ...availableProjection,
      keepHomes: { ...availableProjection.keepHomes, years: [annualProjectionRow] },
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
    expect(screen.getByRole("row", { name: /2042.*Person.*62/ })).toBeInTheDocument();

    vi.mocked(calculateRetirementProjection).mockImplementation(() => {
      throw new RangeError("Missing projection balances for 2042-08");
    });
    fireEvent.change(screen.getByLabelText("Retirement month"), {
      target: { value: "2042-09" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Missing projection balances for 2042-08");
    expect(screen.queryByRole("row", { name: /2042.*Person.*62/ })).not.toBeInTheDocument();
  });

  // Production mutation caught: passing account labels alone exposes recurring and asset IDs in annual warning context.
  it("uses recurring and asset names for selected-projection warning entities", () => {
    const pineRental = {
      id: "rental-asset",
      householdId: "household",
      name: "Pine rental",
      valueCents: 700_000_00,
      annualGrowthBps: 300,
      revision: 1,
    };
    const consultingIncome = {
      id: "recurring-consulting",
      householdId: "household",
      categoryId: "income",
      name: "Consulting income",
      amountCents: 5_000_00,
      kind: "income" as const,
      frequency: "monthly" as const,
      startDate: "2040-01-01",
      annualGrowthBps: 0,
      taxTreatment: "none" as const,
      revision: 1,
    };
    const namedBootstrap: Bootstrap = {
      ...bootstrap,
      assets: [pineRental],
      recurring: [consultingIncome],
    };
    const namedSnapshot: FinancialSnapshot = {
      ...snapshot,
      assets: [pineRental],
      recurring: [consultingIncome],
    };
    vi.mocked(calculateRetirementProjection).mockReturnValue({
      ...availableProjection,
      keepHomes: {
        ...availableProjection.keepHomes,
        years: [{
          ...annualProjectionRow,
          warnings: [
            {
              code: "activity-ended",
              year: 2042,
              entityId: "recurring-consulting",
              message: "Consulting income ends on 2042-06-30.",
            },
            {
              code: "unsupported-rental-tax",
              year: 2042,
              entityId: "rental-asset",
              message: "Rental tax treatment is unavailable for Pine rental.",
            },
          ],
        }],
      },
    });

    render(
      <RetirementView
        initial={initial}
        repository={repository()}
        bootstrap={namedBootstrap}
        snapshot={namedSnapshot}
        scenario={activeScenario}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View 2042 year details" }));
    const warnings = within(screen.getByRole("region", { name: "Warnings for 2042" })).getAllByRole("listitem");
    expect(warnings[0]).toHaveTextContent("Year 2042 · Consulting income");
    expect(warnings[1]).toHaveTextContent("Year 2042 · Pine rental");
    expect(warnings[0]).not.toHaveTextContent("recurring-consulting");
    expect(warnings[1]).not.toHaveTextContent("rental-asset");
  });
});
