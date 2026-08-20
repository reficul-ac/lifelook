import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildRetirementCutoff,
  calculateRetirementSnapshot,
  defaultRetirementSettings,
  normalizeRetirementSettings,
  type FinancialSnapshot,
  type RetirementSnapshotResult,
  type RetirementSettingsInput,
  type RetirementSettingsRecord,
  type Scenario,
} from "./domain";
import type { Bootstrap, Repository } from "./repository";

type SaveState = "idle" | "saving" | "saved" | "error";
type SaveValues = Omit<RetirementSettingsInput, "expectedRevision">;

export interface RetirementViewProps {
  initial?: RetirementSettingsRecord | null;
  repository: Repository;
  bootstrap: Bootstrap;
  snapshot: FinancialSnapshot;
  scenario: Scenario;
  onSettingsChange?: (settings: RetirementSettingsRecord) => void;
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);

const rate = (basisPoints: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(basisPoints / 100)}%`;

const clampBasisPoints = (value: number) =>
  Math.min(10_000, Math.max(1, Number.isFinite(value) ? Math.round(value) : 1));

const localIsoDate = () => {
  const now = new Date();
  return new Date(now.valueOf() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
};

export function RetirementView(props: RetirementViewProps) {
  const { initial, repository, snapshot, scenario, onSettingsChange } = props;
  const [settings, setSettings] = useState(() => ({
    ...defaultRetirementSettings(),
    ...normalizeRetirementSettings(initial),
  }));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const revision = useRef(initial?.revision ?? settings.revision);
  const saving = useRef(false);
  const pending = useRef<SaveValues | null>(null);
  const failed = useRef<SaveValues | null>(null);
  const mounted = useRef(false);
  const repositoryRef = useRef(repository);
  const onSettingsChangeRef = useRef(onSettingsChange);
  const settingsRef = useRef(settings);
  repositoryRef.current = repository;
  onSettingsChangeRef.current = onSettingsChange;
  settingsRef.current = settings;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const queueSave = useCallback((values: SaveValues) => {
    const updateRetirementPlan = repositoryRef.current.updateRetirementPlan;
    if (!updateRetirementPlan) return;
    pending.current = values;
    failed.current = null;
    if (saving.current) return;

    saving.current = true;
    if (mounted.current) setSaveState("saving");
    void (async () => {
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        try {
          const saved = await repositoryRef.current.updateRetirementPlan!({
            ...next,
            expectedRevision: revision.current,
          });
          revision.current = saved.revision;
          onSettingsChangeRef.current?.(saved);
        } catch {
          failed.current = pending.current ?? next;
          pending.current = null;
          saving.current = false;
          if (mounted.current) setSaveState("error");
          return;
        }
      }
      saving.current = false;
      if (mounted.current) setSaveState("saved");
    })();
  }, []);

  const updateSettings = (next: Partial<SaveValues>) => {
    const updated = { ...settingsRef.current, ...next };
    settingsRef.current = updated;
    setSettings(updated);
    queueSave({
      retirementMonth: updated.retirementMonth,
      withdrawalRateBps: clampBasisPoints(updated.withdrawalRateBps),
    });
  };

  const calculation = useMemo<
    { result: RetirementSnapshotResult; error: null } |
    { result: null; error: string }
  >(() => {
    try {
      const cutoff = buildRetirementCutoff({
        snapshot,
        scenario,
        retirementMonth: settings.retirementMonth,
        asOfDate: localIsoDate(),
      });
      return {
        result: calculateRetirementSnapshot({
          cutoff,
          snapshot,
          scenario,
          withdrawalRateBps: clampBasisPoints(settings.withdrawalRateBps),
        }),
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
  }, [scenario, settings.retirementMonth, settings.withdrawalRateBps, snapshot]);

  const retry = () => queueSave(failed.current ?? {
    retirementMonth: settingsRef.current.retirementMonth,
    withdrawalRateBps: clampBasisPoints(settingsRef.current.withdrawalRateBps),
  });

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
            value={settings.retirementMonth}
            onChange={(event) => updateSettings({ retirementMonth: event.target.value })}
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
              step="0.1"
              value={settings.withdrawalRateBps / 100}
              onChange={(event) => updateSettings({
                withdrawalRateBps: clampBasisPoints(Number(event.target.value) * 100),
              })}
            />
            <span aria-hidden="true">%</span>
          </span>
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

      {calculation.result === null ? (
        <section className="card retirement-unavailable" role="alert">
          <h3>Retirement snapshot unavailable</h3>
          <p>{calculation.error}</p>
        </section>
      ) : (
        <section className="retirement-stories" aria-label="Retirement scenarios">
          <RetirementStory kind="keep" result={calculation.result} />
          <RetirementStory kind="sell" result={calculation.result} />
        </section>
      )}
    </div>
  );
}

function RetirementStory({
  kind,
  result,
}: {
  kind: "keep" | "sell";
  result: RetirementSnapshotResult;
}) {
  const sellingAvailable = result.sellHomes.available;
  const headlineNetWorth = kind === "keep"
    ? money(result.netWorthCents)
    : sellingAvailable
      ? money(result.sellHomes.liquidNetWorthCents)
      : "Unavailable";
  const headlineIncome = kind === "keep"
    ? money(result.keepHomes.annualPreTaxIncomeCents)
    : sellingAvailable
      ? money(result.sellHomes.annualPreTaxIncomeCents)
      : "Unavailable";

  return (
    <article className={`card retirement-story retirement-story-${kind}`}>
      <header>
        <p className="eyebrow">{kind === "keep" ? "Keep" : "Sell"}</p>
        <h2>{kind === "keep" ? "If you keep your homes" : "If you sell all homes"}</h2>
      </header>
      <div className="retirement-story-metrics">
        <div>
          <span>{kind === "keep" ? "Net worth at retirement" : "Liquid net worth"}</span>
          <strong>{headlineNetWorth}</strong>
        </div>
        <div>
          <span>Estimated annual pre-tax income</span>
          <strong>{headlineIncome}</strong>
        </div>
      </div>
      <p className="retirement-story-note">
        {kind === "keep"
          ? "Pre-tax estimate. Rental income is gross revenue."
          : "Only homes are sold. Retirement accounts remain at face value."}
      </p>
      <details className="retirement-calculation">
        <summary>View calculation</summary>
        {kind === "keep" ? (
          <dl>
            <CalculationRow label="Non-home net worth" value={money(result.keepHomes.nonHomeNetWorthCents)} />
            <CalculationRow label="Withdrawal rate" value={rate(result.withdrawalRateBps)} />
            <CalculationRow label="Withdrawal income" value={money(result.keepHomes.withdrawalIncomeCents)} />
            <CalculationRow label="Gross rental income" value={money(result.keepHomes.grossRentalIncomeCents)} />
            <CalculationRow label="Annual pre-tax income" value={money(result.keepHomes.annualPreTaxIncomeCents)} />
          </dl>
        ) : sellingAvailable ? (
          <dl>
            <CalculationRow label="Gross home equity" value={money(result.sellHomes.grossHomeEquityCents)} />
            <CalculationRow label="Selling costs" value={`−${money(result.sellHomes.sellingCostsCents)}`} />
            <CalculationRow label="Estimated incremental sale tax" value={`−${money(result.sellHomes.incrementalSaleTaxCents)}`} />
            <CalculationRow label="Net home proceeds" value={money(result.sellHomes.netHomeProceedsCents)} />
            <CalculationRow label="Liquid net worth" value={money(result.sellHomes.liquidNetWorthCents)} />
          </dl>
        ) : (
          <div className="retirement-unavailable">
            <p>Add the following home details to calculate a sale.</p>
            <ul>
              {result.sellHomes.issues.map((issue, index) => (
                <li key={`${issue.assetId}-${issue.field}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}
      </details>
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
