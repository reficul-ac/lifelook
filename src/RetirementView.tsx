import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  calculateRetirementProjection,
  ageOnDate,
  isTaxableInvestmentAccount,
  normalizeRetirementSettings,
  resolveRetirementAccountOrder,
  retirementWithdrawalClass,
  type Account,
  type FinancialSnapshot,
  type RetirementProjectionResult,
  type RetirementScenario,
  type RetirementSettingsInput,
  type RetirementSettingsRecord,
  type Scenario,
  type WithdrawalClass,
} from "./domain";
import type { Bootstrap, Repository } from "./repository";
import {
  RetirementHomeSaleDetails,
  type HomeSaleSourcePatch,
} from "./RetirementHomeSaleDetails";
import { RetirementProjectionTable } from "./RetirementProjectionTable";

type SaveState = "idle" | "saving" | "saved" | "error";
type SaveValues = Omit<RetirementSettingsInput, "expectedRevision">;
type SettingsDraft = {
  retirementMonth: string;
  withdrawalRate: string;
  horizonYears: string;
  taxableDestinationAccountId: string | null;
  withdrawalAccountOrder: readonly string[];
  selectedScenario: RetirementScenario;
  expenseBuckets: readonly {
    id: string;
    name: string;
    annualAmount: string;
  }[];
};

export interface RetirementViewProps {
  active?: boolean;
  initial?: RetirementSettingsRecord | null;
  repository: Repository;
  bootstrap: Bootstrap;
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  onSettingsChange?: (settings: RetirementSettingsRecord) => void;
  onUpdateCurrentHome?: (
    assetId: string,
    patch: HomeSaleSourcePatch,
  ) => Promise<void>;
  onUpdatePlannedHome?: (
    eventId: string,
    patch: HomeSaleSourcePatch,
  ) => Promise<void>;
  onEditAcquisition?: (
    home: import("./domain").ResolvedRetirementHome,
    invoker: HTMLElement,
  ) => void;
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);

const signedMoney = (cents: number) =>
  `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${money(Math.abs(cents))}`;

const rate = (basisPoints: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(basisPoints / 100)}%`;

const clampBasisPoints = (value: number) =>
  Math.min(10_000, Math.max(1, Number.isFinite(value) ? Math.round(value) : 1));

const validRetirementMonth = (value: string) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const parseWithdrawalRate = (value: string) => {
  if (!value.trim()) return null;
  const percentage = Number(value);
  const basisPoints = Math.round(percentage * 100);
  return Number.isFinite(percentage) &&
    percentage >= 0.01 &&
    percentage <= 100 &&
    Math.abs(percentage * 100 - basisPoints) < 1e-8
    ? clampBasisPoints(basisPoints)
    : null;
};

const parseHorizonYears = (value: string) => {
  if (!/^\d+$/.test(value)) return null;
  const horizonYears = Number(value);
  return Number.isInteger(horizonYears) && horizonYears >= 1 && horizonYears <= 60
    ? horizonYears
    : null;
};

const parseAnnualExpense = (value: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
};

const settingsFromRecord = (
  value: RetirementSettingsRecord | null | undefined,
  accounts: readonly Account[],
) => {
  const normalized = normalizeRetirementSettings(value, accounts);
  return {
    ...normalized,
    withdrawalRateBps: clampBasisPoints(normalized.withdrawalRateBps),
  };
};

const draftFromSettings = (
  settings: ReturnType<typeof settingsFromRecord>,
): SettingsDraft => ({
  retirementMonth: settings.retirementMonth,
  withdrawalRate: String(settings.withdrawalRateBps / 100),
  horizonYears: String(settings.horizonYears),
  taxableDestinationAccountId: settings.taxableDestinationAccountId,
  withdrawalAccountOrder: [...settings.withdrawalAccountOrder],
  selectedScenario: settings.selectedScenario,
  expenseBuckets: settings.expenseBuckets.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    annualAmount: String(bucket.annualAmountCents / 100),
  })),
});

const saveValuesFromDraft = (
  draft: SettingsDraft,
  requiresTaxableDestination: boolean,
): SaveValues | null => {
  const withdrawalRateBps = parseWithdrawalRate(draft.withdrawalRate);
  const horizonYears = parseHorizonYears(draft.horizonYears);
  const expenseBuckets = draft.expenseBuckets.flatMap((bucket) => {
    const annualAmountCents = parseAnnualExpense(bucket.annualAmount);
    return bucket.id.trim() !== "" && bucket.name.trim() !== "" && annualAmountCents !== null
      ? [{ id: bucket.id.trim(), name: bucket.name.trim(), annualAmountCents }]
      : [];
  });
  return validRetirementMonth(draft.retirementMonth) &&
    withdrawalRateBps !== null &&
    horizonYears !== null &&
    (!requiresTaxableDestination || draft.taxableDestinationAccountId !== null) &&
    expenseBuckets.length === draft.expenseBuckets.length &&
    new Set(expenseBuckets.map((bucket) => bucket.id)).size === expenseBuckets.length
    ? {
        retirementMonth: draft.retirementMonth,
        withdrawalRateBps,
        horizonYears,
        taxableDestinationAccountId: draft.taxableDestinationAccountId,
        withdrawalAccountOrder: [...draft.withdrawalAccountOrder],
        selectedScenario: draft.selectedScenario,
        expenseBuckets,
      }
    : null;
};

const recordFingerprint = (value?: RetirementSettingsRecord | null) =>
  value
    ? JSON.stringify([
        value.householdId,
        value.retirementMonth,
        value.withdrawalRateBps,
        value.horizonYears,
        value.taxableDestinationAccountId,
        value.withdrawalAccountOrder,
        value.selectedScenario,
        value.expenseBuckets,
        value.revision,
      ])
    : "null";

const accountsFingerprint = (accounts: readonly Account[]) =>
  JSON.stringify(
    accounts.map((account) => [account.id, account.kind, account.subtype]),
  );

const hasPersistedTaxableDestination = (
  value: RetirementSettingsRecord | null | undefined,
  accounts: readonly Account[],
) =>
  typeof value?.taxableDestinationAccountId === "string" &&
  accounts.some(
    (account) =>
      account.id === value.taxableDestinationAccountId &&
      isTaxableInvestmentAccount(account),
  );

const implicitDestinationFromRecord = (
  value: RetirementSettingsRecord | null | undefined,
  accounts: readonly Account[],
  normalized: ReturnType<typeof settingsFromRecord>,
) =>
  hasPersistedTaxableDestination(value, accounts)
    ? null
    : normalized.taxableDestinationAccountId;

const filterWithdrawalOrder = (
  order: readonly string[],
  accounts: readonly Account[],
) => {
  const knownIds = new Set(accounts.map((account) => account.id));
  const seenIds = new Set<string>();
  return order.filter((accountId) => {
    if (!knownIds.has(accountId) || seenIds.has(accountId)) return false;
    seenIds.add(accountId);
    return true;
  });
};

const localIsoDate = () => {
  const now = new Date();
  return new Date(now.valueOf() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
};

export function RetirementView(props: RetirementViewProps) {
  const {
    active = true,
    initial,
    repository,
    bootstrap,
    snapshot,
    scenario,
    onSettingsChange,
    onUpdateCurrentHome,
    onUpdatePlannedHome,
    onEditAcquisition,
  } = props;
  const initialRecord = initial ?? bootstrap.retirementPlan ?? null;
  const taxableAccounts = bootstrap.accounts.filter(isTaxableInvestmentAccount);
  const requiresTaxableDestination = taxableAccounts.length > 1;
  const currentAccountsFingerprint = accountsFingerprint(bootstrap.accounts);
  const [settings, setSettings] = useState(() =>
    settingsFromRecord(initialRecord, bootstrap.accounts),
  );
  const [draft, setDraft] = useState<SettingsDraft>(() =>
    draftFromSettings(settings),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const revision = useRef(initialRecord?.revision ?? settings.revision);
  const saving = useRef(false);
  const pending = useRef<SaveValues | null>(null);
  const failed = useRef<SaveValues | null>(null);
  const generation = useRef(0);
  const accountGeneration = useRef(0);
  const ownSaveFingerprints = useRef(new Set<string>());
  const seenInitialFingerprint = useRef(recordFingerprint(initial));
  const seenBootstrapFingerprint = useRef(
    recordFingerprint(bootstrap.retirementPlan),
  );
  const seenAccountsFingerprint = useRef(currentAccountsFingerprint);
  const authoritativeFingerprint = useRef(recordFingerprint(initialRecord));
  const authoritativeRecord = useRef(initialRecord);
  const implicitDestinationAccountId = useRef(
    implicitDestinationFromRecord(initialRecord, bootstrap.accounts, settings),
  );
  const mounted = useRef(false);
  const repositoryRef = useRef(repository);
  const onSettingsChangeRef = useRef(onSettingsChange);
  const accountsRef = useRef(bootstrap.accounts);
  const requiresTaxableDestinationRef = useRef(requiresTaxableDestination);
  const settingsRef = useRef(settings);
  const draftRef = useRef(draft);

  useLayoutEffect(() => {
    repositoryRef.current = repository;
    onSettingsChangeRef.current = onSettingsChange;
    accountsRef.current = bootstrap.accounts;
    requiresTaxableDestinationRef.current = requiresTaxableDestination;
    settingsRef.current = settings;
    draftRef.current = draft;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const nextInitialFingerprint = recordFingerprint(initial);
    const nextBootstrapFingerprint = recordFingerprint(bootstrap.retirementPlan);
    const nextAccountsFingerprint = currentAccountsFingerprint;
    const bootstrapChanged =
      nextBootstrapFingerprint !== seenBootstrapFingerprint.current;
    const initialChanged =
      nextInitialFingerprint !== seenInitialFingerprint.current;
    const accountsChanged =
      nextAccountsFingerprint !== seenAccountsFingerprint.current;
    seenBootstrapFingerprint.current = nextBootstrapFingerprint;
    seenInitialFingerprint.current = nextInitialFingerprint;
    seenAccountsFingerprint.current = nextAccountsFingerprint;

    let replacement: RetirementSettingsRecord | null | undefined;
    let replacementFingerprint = authoritativeFingerprint.current;
    let hasReplacement = false;
    if (bootstrapChanged) {
      replacement = bootstrap.retirementPlan;
      replacementFingerprint = nextBootstrapFingerprint;
      hasReplacement = true;
    } else if (!initialChanged) {
      // Account changes are reconciled below without replacing the visible draft.
    } else if (ownSaveFingerprints.current.delete(nextInitialFingerprint)) {
      authoritativeFingerprint.current = nextInitialFingerprint;
      authoritativeRecord.current = initial ?? null;
    } else if (nextInitialFingerprint === authoritativeFingerprint.current) {
      authoritativeRecord.current = initial ?? null;
    } else {
      replacement = initial;
      replacementFingerprint = nextInitialFingerprint;
      hasReplacement = true;
    }

    if (hasReplacement) {
      const nextSettings = settingsFromRecord(replacement, bootstrap.accounts);
      const nextDraft = draftFromSettings(nextSettings);
      generation.current += 1;
      saving.current = false;
      pending.current = null;
      failed.current = null;
      revision.current = replacement?.revision ?? nextSettings.revision;
      settingsRef.current = nextSettings;
      draftRef.current = nextDraft;
      authoritativeFingerprint.current = replacementFingerprint;
      authoritativeRecord.current = replacement ?? null;
      implicitDestinationAccountId.current = implicitDestinationFromRecord(
        replacement,
        bootstrap.accounts,
        nextSettings,
      );
      ownSaveFingerprints.current.clear();
      setSettings(nextSettings);
      setDraft(nextDraft);
      setSaveState("idle");
      return;
    }
    if (!accountsChanged) return;
    accountGeneration.current += 1;

    const normalizedAuthoritative = settingsFromRecord(
      authoritativeRecord.current,
      bootstrap.accounts,
    );
    const taxableAccountIds = new Set(taxableAccounts.map((account) => account.id));
    const currentDraft = draftRef.current;
    const currentWasImplicit =
      currentDraft.taxableDestinationAccountId ===
      implicitDestinationAccountId.current;
    const currentDestinationIsEligible =
      currentDraft.taxableDestinationAccountId !== null &&
      taxableAccountIds.has(currentDraft.taxableDestinationAccountId);
    const taxableDestinationAccountId =
      !currentWasImplicit && currentDestinationIsEligible
        ? currentDraft.taxableDestinationAccountId
        : normalizedAuthoritative.taxableDestinationAccountId;
    implicitDestinationAccountId.current =
      !currentWasImplicit && currentDestinationIsEligible
        ? null
        : implicitDestinationFromRecord(
            authoritativeRecord.current,
            bootstrap.accounts,
            normalizedAuthoritative,
          );
    const withdrawalAccountOrder = filterWithdrawalOrder(
      currentDraft.withdrawalAccountOrder,
      bootstrap.accounts,
    );
    const nextDraft = {
      ...currentDraft,
      taxableDestinationAccountId,
      withdrawalAccountOrder,
    };
    const nextSettings = {
      ...settingsRef.current,
      taxableDestinationAccountId,
      withdrawalAccountOrder,
    };
    const hadFailedSave = failed.current !== null;
    const reconciledSaveValues = saveValuesFromDraft(
      nextDraft,
      requiresTaxableDestination,
    );
    if (saving.current || pending.current !== null) {
      pending.current = reconciledSaveValues;
    }
    if (hadFailedSave) failed.current = reconciledSaveValues;
    settingsRef.current = nextSettings;
    draftRef.current = nextDraft;
    setSettings(nextSettings);
    setDraft(nextDraft);
    if (hadFailedSave) {
      setSaveState(reconciledSaveValues === null ? "idle" : "error");
    }
  }, [
    bootstrap.retirementPlan,
    currentAccountsFingerprint,
    initial,
  ]);

  const queueSave = useCallback((values: SaveValues) => {
    const updateRetirementPlan = repositoryRef.current.updateRetirementPlan;
    if (!updateRetirementPlan) return;
    pending.current = values;
    failed.current = null;
    if (saving.current) return;

    const saveGeneration = generation.current;
    saving.current = true;
    if (mounted.current) setSaveState("saving");
    void (async () => {
      while (generation.current === saveGeneration && pending.current) {
        const next = pending.current;
        const dispatchedAccountGeneration = accountGeneration.current;
        pending.current = null;
        try {
          const saved = await repositoryRef.current.updateRetirementPlan!({
            ...next,
            expectedRevision: revision.current,
          });
          if (generation.current !== saveGeneration) return;
          revision.current = saved.revision;
          if (accountGeneration.current !== dispatchedAccountGeneration) {
            pending.current = saveValuesFromDraft(
              draftRef.current,
              requiresTaxableDestinationRef.current,
            );
            if (pending.current !== null) continue;
            saving.current = false;
            if (mounted.current) setSaveState("idle");
            return;
          }
          authoritativeRecord.current = saved;
          implicitDestinationAccountId.current = implicitDestinationFromRecord(
            saved,
            accountsRef.current,
            settingsFromRecord(saved, accountsRef.current),
          );
          const notifySettingsChange = onSettingsChangeRef.current;
          if (notifySettingsChange) {
            ownSaveFingerprints.current.add(recordFingerprint(saved));
            if (ownSaveFingerprints.current.size > 20) {
              const oldest = ownSaveFingerprints.current.values().next().value;
              if (oldest !== undefined) ownSaveFingerprints.current.delete(oldest);
            }
            notifySettingsChange(saved);
          }
        } catch {
          if (generation.current !== saveGeneration) return;
          if (accountGeneration.current !== dispatchedAccountGeneration) {
            pending.current = saveValuesFromDraft(
              draftRef.current,
              requiresTaxableDestinationRef.current,
            );
            if (pending.current !== null) continue;
            saving.current = false;
            if (mounted.current) setSaveState("idle");
            return;
          }
          failed.current = saveValuesFromDraft(
            draftRef.current,
            requiresTaxableDestinationRef.current,
          );
          pending.current = null;
          saving.current = false;
          if (mounted.current) {
            setSaveState(failed.current === null ? "idle" : "error");
          }
          return;
        }
      }
      if (generation.current !== saveGeneration) return;
      saving.current = false;
      if (mounted.current) {
        setSaveState(
          saveValuesFromDraft(
            draftRef.current,
            requiresTaxableDestinationRef.current,
          )
            ? "saved"
            : "idle",
        );
      }
    })();
  }, []);

  const updateDraft = (next: Partial<SettingsDraft>) => {
    if (Object.prototype.hasOwnProperty.call(next, "taxableDestinationAccountId")) {
      implicitDestinationAccountId.current = null;
    }
    const updated = { ...draftRef.current, ...next };
    draftRef.current = updated;
    setDraft(updated);
    const values = saveValuesFromDraft(updated, requiresTaxableDestination);
    if (values === null) {
      pending.current = null;
      failed.current = null;
      if (mounted.current) setSaveState("idle");
      return;
    }
    const updatedSettings = { ...settingsRef.current, ...values };
    settingsRef.current = updatedSettings;
    setSettings(updatedSettings);
    queueSave(values);
  };

  const calculation = useMemo<
    { result: RetirementProjectionResult; error: null } |
    { result: null; error: string } |
    null
  >(() => {
    if (!active) return null;
    try {
      const asOfDate = localIsoDate();
      const result = calculateRetirementProjection({
        snapshot,
        scenario,
        asOfDate,
        settings,
      });
      return {
        result,
        error: null,
      };
    } catch (error) {
      return {
        result: null,
        error:
          error instanceof Error
            ? error.message
            : "The retirement snapshot could not be calculated.",
      };
    }
  }, [
    active,
    scenario,
    settings.retirementMonth,
    settings.withdrawalRateBps,
    settings.horizonYears,
    settings.taxableDestinationAccountId,
    settings.withdrawalAccountOrder,
    settings.selectedScenario,
    settings.expenseBuckets,
    snapshot,
  ]);

  const retry = () => {
    const values = saveValuesFromDraft(
      draftRef.current,
      requiresTaxableDestination,
    );
    if (values === null) {
      failed.current = null;
      setSaveState("idle");
      return;
    }
    queueSave(values);
  };

  const entityNames = Object.fromEntries(
    [...bootstrap.accounts, ...bootstrap.assets, ...bootstrap.recurring]
      .map((entity) => [entity.id, entity.name]),
  );

  return (
    <div className="content retirement-view">
      <section className="card retirement-snapshot-header">
        <div className="retirement-snapshot-heading">
          <p className="eyebrow">Retirement snapshot</p>
          <h2>{scenario.name}</h2>
          <p>Evaluates the active Plan at the start of retirement.</p>
        </div>
        <label>
          Retirement month
          <input
            aria-label="Retirement month"
            type="month"
            value={draft.retirementMonth}
            onChange={(event) => updateDraft({ retirementMonth: event.target.value })}
          />
        </label>
        <label>
          Withdrawal rate
          <span className="retirement-rate">
            <input
              aria-label="Withdrawal rate"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={draft.withdrawalRate}
              onChange={(event) => updateDraft({ withdrawalRate: event.target.value })}
            />
            <span aria-hidden="true">%</span>
          </span>
        </label>
        <label>
          Years in retirement
          <input
            aria-label="Years in retirement"
            type="number"
            min="1"
            max="60"
            step="1"
            required
            value={draft.horizonYears}
            onChange={(event) => updateDraft({ horizonYears: event.target.value })}
          />
        </label>
        <span className={`save-state ${saveState}`} role="status" aria-live="polite">
          {saveState === "saving" ? (
            "Saving…"
          ) : saveState === "saved" ? (
            "Saved"
          ) : saveState === "error" ? (
            <button type="button" onClick={retry}>Save failed — retry</button>
          ) : (
            ""
          )}
        </span>
      </section>

      <section className="card retirement-settings-extra" aria-label="Retirement settings">
        <div className="retirement-taxable-destination">
          <strong>Taxable destination</strong>
          {taxableAccounts.length === 0 ? (
            <p>Add a taxable brokerage account in Net Worth to model home-sale proceeds.</p>
          ) : taxableAccounts.length === 1 ? (
            <p>{taxableAccounts[0]!.name} is the taxable destination for home-sale proceeds.</p>
          ) : (
            <label>
              <span className="sr-only">Taxable destination</span>
              <select
                aria-label="Taxable destination"
                required
                value={draft.taxableDestinationAccountId ?? ""}
                onChange={(event) => updateDraft({
                  taxableDestinationAccountId: event.target.value || null,
                })}
              >
                <option value="">Choose an account</option>
                {taxableAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <WithdrawalOrderSettings
          draft={draft}
          snapshot={snapshot}
          retirementMonth={settings.retirementMonth}
          firstWithdrawalDate={calculation?.result?.firstWithdrawalDate}
          projectedOrder={calculation?.result?.effectiveWithdrawalOrder}
          onChange={(withdrawalAccountOrder) => updateDraft({ withdrawalAccountOrder })}
        />
      </section>

      <section className="card retirement-expense-settings" aria-label="Retirement expenses">
        <div className="retirement-expense-heading">
          <div>
            <h3>Annual retirement expenses</h3>
            <p>Enter broad non-housing expenses in today’s dollars. They grow with the Plan inflation rate; modeled home costs are added automatically.</p>
          </div>
          <button
            type="button"
            onClick={() => updateDraft({
              expenseBuckets: [...draft.expenseBuckets, {
                id: `expense-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: "",
                annualAmount: "",
              }],
            })}
          >
            Add expense bucket
          </button>
        </div>
        {draft.expenseBuckets.length === 0 ? (
          <p className="retirement-expense-empty">No non-housing retirement expenses added yet.</p>
        ) : (
          <div className="retirement-expense-buckets">
            {draft.expenseBuckets.map((bucket, index) => (
              <div className="retirement-expense-bucket" key={bucket.id}>
                <label>
                  <span>Bucket name</span>
                  <input
                    aria-label={bucket.name.trim() || "Expense bucket name"}
                    value={bucket.name}
                    onChange={(event) => updateDraft({
                      expenseBuckets: draft.expenseBuckets.map((candidate, candidateIndex) =>
                        candidateIndex === index ? { ...candidate, name: event.target.value } : candidate),
                    })}
                  />
                </label>
                <label>
                  <span>Annual amount</span>
                  <span className="input-affix">
                    <i aria-hidden="true">$</i>
                    <input
                      aria-label={`${bucket.name.trim() || "Expense bucket"} annual expense`}
                      inputMode="decimal"
                      value={bucket.annualAmount}
                      onChange={(event) => updateDraft({
                        expenseBuckets: draft.expenseBuckets.map((candidate, candidateIndex) =>
                          candidateIndex === index ? { ...candidate, annualAmount: event.target.value } : candidate),
                      })}
                    />
                  </span>
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${bucket.name.trim() || "expense bucket"}`}
                  onClick={() => updateDraft({
                    expenseBuckets: draft.expenseBuckets.filter((_, candidateIndex) => candidateIndex !== index),
                  })}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {calculation === null ? null : calculation.result === null ? (
        <section className="card retirement-unavailable" role="alert">
          <h3>Retirement snapshot unavailable</h3>
          <p>{calculation.error}</p>
        </section>
      ) : (
        <>
          <section className="retirement-stories" aria-label="Retirement scenarios">
            <RetirementStory
              kind="keep"
              result={calculation.result}
              selected={draft.selectedScenario === "keep-homes"}
              onSelect={() => updateDraft({ selectedScenario: "keep-homes" })}
            />
            <RetirementStory
              kind="sell"
              result={calculation.result}
              selected={draft.selectedScenario === "sell-all-homes"}
              onSelect={() => updateDraft({ selectedScenario: "sell-all-homes" })}
            >
              {onUpdateCurrentHome &&
                onUpdatePlannedHome &&
                calculation.result.resolvedHomeSales &&
                calculation.result.resolvedHomeSales.homes.length > 0 ? (
                  <RetirementHomeSaleDetails
                    homes={calculation.result.resolvedHomeSales.homes}
                    issues={calculation.result.sellHomes.available
                      ? []
                      : calculation.result.sellHomes.issues}
                    scenario={scenario}
                    retirementDate={`${settings.retirementMonth}-01`}
                    onUpdateCurrentHome={onUpdateCurrentHome}
                    onUpdatePlannedHome={onUpdatePlannedHome}
                    onEditAcquisition={onEditAcquisition}
                  />
                ) : null}
            </RetirementStory>
          </section>
          <RetirementProjectionTable
            selectedScenario={draft.selectedScenario}
            projection={draft.selectedScenario === "keep-homes"
              ? calculation.result.keepHomes
              : calculation.result.sellHomes}
            accountNames={entityNames}
          />
        </>
      )}
    </div>
  );
}

const withdrawalClassLabel: Record<WithdrawalClass, string> = {
  taxable: "Taxable",
  cash: "Cash",
  "eligible-pre-tax": "Pre-tax",
  "penalty-pre-tax": "Pre-tax",
  roth: "Roth",
};

const withdrawalExplanation = (
  account: Account,
  withdrawalClass: WithdrawalClass,
) => {
  switch (withdrawalClass) {
    case "cash":
      return "Cash is spendable without selling investments or triggering retirement-distribution tax.";
    case "taxable":
      return "Taxable sales may realize capital gains; they are generally used before retirement accounts to reduce early-withdrawal risk.";
    case "eligible-pre-tax":
      return "Distributions are taxed as ordinary income.";
    case "penalty-pre-tax":
      return "Distributions are taxed as ordinary income; an early-withdrawal penalty may apply because the owner is under age 59½.";
    case "roth":
      return `${account.subtype === "employer-roth" ? "Employer Roth" : "Roth"} qualification requires age 59½ and five tax years; the account is preserved last for potential tax-free growth.`;
  }
};

function WithdrawalOrderSettings({
  draft,
  snapshot,
  retirementMonth,
  firstWithdrawalDate,
  projectedOrder,
  onChange,
}: {
  draft: SettingsDraft;
  snapshot: FinancialSnapshot;
  retirementMonth: string;
  firstWithdrawalDate?: string;
  projectedOrder?: readonly string[];
  onChange: (order: readonly string[]) => void;
}) {
  const withdrawalDate = firstWithdrawalDate ?? `${retirementMonth}-01`;
  const locallyResolvedOrder = resolveRetirementAccountOrder(
    snapshot,
    withdrawalDate,
    draft.withdrawalAccountOrder,
  );
  const projectedIds = new Set(projectedOrder);
  const effectiveOrder = projectedOrder != null &&
    projectedOrder.length === locallyResolvedOrder.length &&
    locallyResolvedOrder.every((accountId) => projectedIds.has(accountId))
    ? projectedOrder
    : locallyResolvedOrder;
  const accounts = effectiveOrder.flatMap((accountId) => {
    const account = snapshot.accounts.find((candidate) => candidate.id === accountId);
    return account == null ? [] : [account];
  });
  const move = (index: number, offset: -1 | 1) => {
    const next = accounts.map((account) => account.id);
    const swapIndex = index + offset;
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
    onChange(next);
  };

  return (
    <details className="retirement-withdrawal-order">
      <summary>Withdrawal order</summary>
      <div role="group" aria-label="Withdrawal order">
        {accounts.length === 0 ? (
          <p>Add an account in Net Worth to configure withdrawal order.</p>
        ) : (
          <ol>
            {accounts.map((account, index) => {
              const owner = snapshot.household.people.find(
                (person) => person.id === account.ownerPersonId,
              );
              const withdrawalClass = retirementWithdrawalClass(
                snapshot,
                account,
                withdrawalDate,
              );
              const age = ageOnDate(owner?.birthDate, withdrawalDate);
              const ageStatus = withdrawalClass === "cash"
                ? "Age not applicable"
                : age === null
                  ? "Age unknown at first annual draw"
                  : `Age ${age} at first annual draw${
                      withdrawalClass === "penalty-pre-tax"
                        ? " — penalty may apply"
                        : ""
                    }`;
              return (
                <li key={account.id}>
                  <div>
                    <strong>{account.name}</strong>
                    <span>
                      {owner?.name ?? "Household"} · {withdrawalClassLabel[withdrawalClass]} · {ageStatus}
                    </span>
                    <span className="retirement-withdrawal-explanation">
                      {withdrawalExplanation(account, withdrawalClass)}
                    </span>
                  </div>
                  <div className="retirement-withdrawal-actions">
                    <button
                      type="button"
                      aria-label={`Move ${account.name} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${account.name} down`}
                      disabled={index === accounts.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      Move down
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <button
          type="button"
          disabled={draft.withdrawalAccountOrder.length === 0}
          onClick={() => onChange([])}
        >
          Use automatic order
        </button>
      </div>
    </details>
  );
}

function RetirementStory({
  kind,
  result,
  selected,
  onSelect,
  children,
}: {
  kind: "keep" | "sell";
  result: RetirementProjectionResult;
  selected: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  const projection = kind === "keep" ? result.keepHomes : result.sellHomes;
  const available = projection.available;
  const keepSummary = result.keepHomes.available ? result.keepHomes.summary : null;
  const sellSummary = result.sellHomes.available ? result.sellHomes.summary : null;
  const firstProjectionYear = projection.available ? projection.years[0] : undefined;
  const privateStockSale = firstProjectionYear?.privateStockSale;
  const headlineNetWorth = !available
    ? "Unavailable"
    : kind === "keep"
      ? result.netWorthCents == null ? "Unavailable" : money(result.netWorthCents)
      : money(sellSummary!.liquidNetWorthCents);
  const headlineIncome = !available
    ? "Unavailable"
    : kind === "keep"
      ? money(keepSummary!.annualPreTaxIncomeCents)
      : money(sellSummary!.annualPreTaxIncomeCents);
  const headlineAfterTaxIncome = !available
    ? "Unavailable"
    : money(firstProjectionYear?.typicalAfterTaxIncomeCents ?? 0);
  const headlineExpenses = !available
    ? "Unavailable"
    : money(firstProjectionYear?.typicalExpenseCents ?? 0);
  const typicalSurplusCents = firstProjectionYear?.typicalSurplusCents ?? 0;
  const headlineSurplus = !available ? "Unavailable" : signedMoney(typicalSurplusCents);
  const scenarioName = kind === "keep" ? "Keep homes" : "Sell all homes";

  return (
    <article className={`card retirement-story retirement-story-${kind}${
      selected ? " retirement-story-selected" : ""
    }`}>
      <button
        type="button"
        className="retirement-scenario-select"
        aria-label={`Select ${scenarioName} scenario`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span>{selected ? "Selected" : "Select"}</span>
      </button>
      <div className="retirement-story-content">
        <div className="retirement-story-heading">
          <p className="eyebrow">{kind === "keep" ? "Keep" : "Sell"}</p>
          <h2>{kind === "keep" ? "If you keep your homes" : "If you sell all homes"}</h2>
        </div>
        <div className="retirement-story-metrics">
          <div>
            <span>{kind === "keep" ? "Net worth at retirement" : "Liquid net worth"}</span>
            <strong>{headlineNetWorth}</strong>
          </div>
          <div>
            <span>Estimated annual pre-tax income</span>
            <strong>{headlineIncome}</strong>
          </div>
          <div>
            <span>Typical annual after-tax income</span>
            <strong>{headlineAfterTaxIncome}</strong>
          </div>
          <div>
            <span>Typical annual expenses</span>
            <strong>{headlineExpenses}</strong>
          </div>
          <div>
            <span>{typicalSurplusCents < 0 ? "Typical annual shortfall" : "Typical annual surplus"}</span>
            <strong className={typicalSurplusCents < 0 ? "retirement-negative-value" : undefined}>{headlineSurplus}</strong>
          </div>
        </div>
        <p className="retirement-story-note">
          {privateStockSale
            ? "Annual income excludes one-time home and private-stock sale taxes; those taxes reduce net worth and sale proceeds."
            : kind === "keep"
              ? "Pre-tax estimate. Rental income is gross revenue."
              : "Only homes are sold. Retirement accounts remain at face value."}
        </p>
      </div>
      {kind === "keep" && !available &&
        (projection.issues.length > 0 || projection.warnings.length > 0) ? (
          <section className="retirement-details-needed" aria-label="Keep homes details needed">
            <h3>Details needed</h3>
            <p>Add or correct the following information to calculate this scenario.</p>
            <ul>
              {projection.issues.map((issue, index) => (
                <li key={`issue-${issue.assetId}-${issue.field}-${index}`}>
                  {issue.message}
                </li>
              ))}
              {projection.warnings.map((warning, index) => (
                <li key={`warning-${warning.code}-${warning.entityId ?? "household"}-${index}`}>
                  {warning.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      <details className="retirement-calculation">
        <summary>View calculation</summary>
        {!available ? (
          <div className="retirement-unavailable">
            <p>This scenario cannot be calculated from the available data.</p>
            {projection.issues.length > 0 ? (
              <ul>
                {projection.issues.map((issue, index) => (
                  <li key={`${issue.assetId}-${issue.field}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : kind === "keep" ? (
          <dl>
            {privateStockSale ? (
              <>
                <CalculationRow label="Vested private stock sold" value={money(privateStockSale.grossProceedsCents)} />
                <CalculationRow label="Taxable stock gain" value={money(privateStockSale.taxableGainCents)} />
                <CalculationRow label="Estimated stock-sale tax" value={`−${money(privateStockSale.estimatedTaxCents)}`} />
                <CalculationRow label="Net stock proceeds" value={money(privateStockSale.netProceedsCents)} />
              </>
            ) : null}
            <CalculationRow label="Non-home net worth" value={money(keepSummary!.nonHomeNetWorthCents)} />
            <CalculationRow label="Withdrawal rate" value={rate(result.withdrawalRateBps)} />
            <CalculationRow label="Withdrawal income" value={money(keepSummary!.withdrawalIncomeCents)} />
            <CalculationRow label="Gross rental income" value={money(keepSummary!.grossRentalIncomeCents)} />
            <CalculationRow label="Annual pre-tax income" value={money(keepSummary!.annualPreTaxIncomeCents)} />
            {firstProjectionYear ? (
              <>
                <CalculationRow label="Typical annual income tax" value={`−${money(firstProjectionYear.typicalYearTaxCents)}`} />
                <CalculationRow label="After-tax income (typical year)" value={money(firstProjectionYear.typicalAfterTaxIncomeCents)} />
                <CalculationRow label="Non-housing expenses" value={`−${money(firstProjectionYear.planExpenseCents)}`} />
                <CalculationRow label="Housing expenses" value={`−${money(firstProjectionYear.housingExpenseCents)}`} />
                <CalculationRow label="Total expenses (typical year)" value={`−${money(firstProjectionYear.typicalExpenseCents)}`} />
                <CalculationRow label="Surplus / shortfall (typical year)" value={signedMoney(firstProjectionYear.typicalSurplusCents)} />
              </>
            ) : null}
          </dl>
        ) : (
          <dl>
            {privateStockSale ? (
              <>
                <CalculationRow label="Vested private stock sold" value={money(privateStockSale.grossProceedsCents)} />
                <CalculationRow label="Taxable stock gain" value={money(privateStockSale.taxableGainCents)} />
                <CalculationRow label="Estimated stock-sale tax" value={`−${money(privateStockSale.estimatedTaxCents)}`} />
                <CalculationRow label="Net stock proceeds" value={money(privateStockSale.netProceedsCents)} />
              </>
            ) : null}
            <CalculationRow label="Gross home equity" value={money(sellSummary!.grossHomeEquityCents)} />
            <CalculationRow label="Selling costs" value={`−${money(sellSummary!.sellingCostsCents)}`} />
            <CalculationRow label="Estimated incremental sale tax" value={`−${money(sellSummary!.incrementalSaleTaxCents)}`} />
            <CalculationRow label="Net home proceeds" value={money(sellSummary!.netHomeProceedsCents)} />
            <CalculationRow label="Liquid net worth" value={money(sellSummary!.liquidNetWorthCents)} />
            {firstProjectionYear ? (
              <>
                <CalculationRow label="Typical annual income tax" value={`−${money(firstProjectionYear.typicalYearTaxCents)}`} />
                <CalculationRow label="After-tax income (typical year)" value={money(firstProjectionYear.typicalAfterTaxIncomeCents)} />
                <CalculationRow label="Non-housing expenses" value={`−${money(firstProjectionYear.planExpenseCents)}`} />
                <CalculationRow label="Housing expenses" value={`−${money(firstProjectionYear.housingExpenseCents)}`} />
                <CalculationRow label="Total expenses (typical year)" value={`−${money(firstProjectionYear.typicalExpenseCents)}`} />
                <CalculationRow label="Surplus / shortfall (typical year)" value={signedMoney(firstProjectionYear.typicalSurplusCents)} />
              </>
            ) : null}
          </dl>
        )}
      </details>
      {children}
    </article>
  );
}

function CalculationRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
