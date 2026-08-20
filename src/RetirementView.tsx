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
type SettingsDraft = { retirementMonth: string; withdrawalRate: string };

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
  const [draft, setDraft] = useState<SettingsDraft>(() => ({
    retirementMonth: settings.retirementMonth,
    withdrawalRate: String(settings.withdrawalRateBps / 100),
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
  const draftRef = useRef(draft);
  repositoryRef.current = repository;
  onSettingsChangeRef.current = onSettingsChange;
  settingsRef.current = settings;
  draftRef.current = draft;

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

  const updateDraft = (next: Partial<SettingsDraft>) => {
    const updated = { ...draftRef.current, ...next };
    draftRef.current = updated;
    setDraft(updated);
    const withdrawalRateBps = parseWithdrawalRate(updated.withdrawalRate);
    if (validRetirementMonth(updated.retirementMonth) && withdrawalRateBps !== null) {
      updateSettings({
        retirementMonth: updated.retirementMonth,
        withdrawalRateBps,
      });
    }
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
