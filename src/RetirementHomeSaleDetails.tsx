import { type FormEvent, useState } from "react";
import {
  latestOwnedPlannedPurchase,
  type Cents,
  type HomeSaleAssumptions,
  type ResolvedRetirementHome,
  type RetirementMissingData,
  type Scenario,
} from "./domain";
import { parseMoney } from "./money";

export interface HomeSaleSourcePatch {
  purchaseDate: string;
  purchasePriceCents: Cents;
  homeSaleAssumptions: HomeSaleAssumptions;
}

export class HomeSaleReloadError extends Error {
  constructor(readonly retryReload: () => Promise<void>) {
    super("Home sale details were saved, but refreshed data could not be loaded.");
    this.name = "HomeSaleReloadError";
  }
}

export interface RetirementHomeSaleDetailsProps {
  homes: readonly ResolvedRetirementHome[];
  issues: readonly RetirementMissingData[];
  scenario: Scenario;
  retirementDate: string;
  onUpdateCurrentHome: (
    assetId: string,
    patch: HomeSaleSourcePatch,
  ) => Promise<void>;
  onUpdatePlannedHome: (
    eventId: string,
    patch: HomeSaleSourcePatch,
  ) => Promise<void>;
}

type Draft = {
  purchaseDate: string;
  purchasePrice: string;
  sellingCosts: string;
  primaryResidenceExclusionEligible: boolean;
  federalDepreciation: string;
  californiaDepreciation: string;
};

const money = (cents: Cents) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);

const date = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));

const parsePercent = (value: string) => {
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const basisPoints = Math.round(Number(value) * 100);
  return Number.isInteger(basisPoints) && basisPoints >= 0 && basisPoints <= 10_000
    ? basisPoints
    : null;
};

const draftFor = (home: ResolvedRetirementHome): Draft => ({
  purchaseDate: home.purchaseDate ?? "",
  purchasePrice:
    home.taxBasisCents == null ? "" : String(home.taxBasisCents / 100),
  sellingCosts: home.assumptions == null
    ? ""
    : String(home.assumptions.sellingCostBps / 100),
  primaryResidenceExclusionEligible:
    home.assumptions?.primaryResidenceExclusionEligible ?? false,
  federalDepreciation: String(
    (home.assumptions?.accumulatedFederalDepreciationCents ?? 0) / 100,
  ),
  californiaDepreciation: String(
    (home.assumptions?.accumulatedCaliforniaDepreciationCents ?? 0) / 100,
  ),
});

const addUtcYears = (value: Date, years: number) => {
  const result = new Date(value);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
};

const inferredPlannedEligibility = (
  home: ResolvedRetirementHome,
  scenario: Scenario,
  retirementDate: string,
) => {
  if (home.property.source !== "planned" || home.assumptions != null) {
    return undefined;
  }
  const purchase = latestOwnedPlannedPurchase(
    scenario,
    home.property.assetId,
    retirementDate,
  );
  if (purchase?.propertyDetails?.primaryResidence == null) return undefined;
  if (!purchase.propertyDetails.primaryResidence) return false;
  const retirement = new Date(`${retirementDate}T00:00:00Z`);
  const acquired = new Date(`${purchase.date}T00:00:00Z`);
  const lookbackStart = addUtcYears(retirement, -5);
  const residenceStart = acquired > lookbackStart ? acquired : lookbackStart;
  const rentalStart = scenario.events
    .filter((event) =>
      event.type === "property-rental-start" &&
      event.assetId === home.property.assetId &&
      event.date >= purchase.date &&
      event.date < retirementDate,
    )
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) || left.id.localeCompare(right.id),
    )[0];
  const residenceEnd = rentalStart == null
    ? retirement
    : new Date(`${rentalStart.date}T00:00:00Z`);
  return addUtcYears(residenceStart, 2) <= residenceEnd;
};

const homeSourceFingerprint = (
  home: ResolvedRetirementHome,
  scenario: Scenario,
  retirementDate: string,
) => {
  if (home.property.source === "current") {
    return JSON.stringify([
      "current",
      home.property.assetId,
      home.purchaseDate,
      home.taxBasisCents,
      home.assumptions,
    ]);
  }
  const purchase = latestOwnedPlannedPurchase(
    scenario,
    home.property.assetId,
    retirementDate,
  );
  return JSON.stringify([
    "planned",
    purchase?.id,
    purchase?.date ?? home.purchaseDate,
    purchase?.valueCents ?? home.taxBasisCents,
    purchase?.propertyDetails?.homeSaleAssumptions ?? home.assumptions,
    inferredPlannedEligibility(home, scenario, retirementDate),
  ]);
};

export function RetirementHomeSaleDetails({
  homes,
  issues,
  scenario,
  retirementDate,
  onUpdateCurrentHome,
  onUpdatePlannedHome,
}: RetirementHomeSaleDetailsProps) {
  return (
    <section className="card retirement-home-sale-details">
      <h3>Home sale details</h3>
      {homes.map((home) => (
        <HomeDetails
          key={homeSourceFingerprint(home, scenario, retirementDate)}
          home={home}
          issues={issues.filter(
            (issue) => issue.assetId === home.property.assetId,
          )}
          scenario={scenario}
          retirementDate={retirementDate}
          onUpdateCurrentHome={onUpdateCurrentHome}
          onUpdatePlannedHome={onUpdatePlannedHome}
        />
      ))}
    </section>
  );
}

function HomeDetails({
  home,
  issues,
  scenario,
  retirementDate,
  onUpdateCurrentHome,
  onUpdatePlannedHome,
}: {
  home: ResolvedRetirementHome;
  issues: readonly RetirementMissingData[];
  scenario: Scenario;
  retirementDate: string;
  onUpdateCurrentHome: RetirementHomeSaleDetailsProps["onUpdateCurrentHome"];
  onUpdatePlannedHome: RetirementHomeSaleDetailsProps["onUpdatePlannedHome"];
}) {
  const inferredEligibility = inferredPlannedEligibility(
    home,
    scenario,
    retirementDate,
  );
  const [draft, setDraft] = useState(() => {
    const initial = draftFor(home);
    return {
      ...initial,
      primaryResidenceExclusionEligible:
        inferredEligibility ?? initial.primaryResidenceExclusionEligible,
    };
  });
  const [error, setError] = useState("");
  const [retryReload, setRetryReload] = useState<(() => Promise<void>) | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const missing = new Set(issues.map((issue) => issue.field));

  const set = (values: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...values }));

  async function save(event: FormEvent) {
    event.preventDefault();
    const purchasePriceCents = parseMoney(draft.purchasePrice);
    const sellingCostBps = parsePercent(draft.sellingCosts);
    const accumulatedFederalDepreciationCents = parseMoney(
      draft.federalDepreciation,
    );
    const accumulatedCaliforniaDepreciationCents = parseMoney(
      draft.californiaDepreciation,
    );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.purchaseDate)) {
      setRetryReload(null);
      setError("Enter a valid purchase date.");
      return;
    }
    if (purchasePriceCents == null || purchasePriceCents <= 0) {
      setRetryReload(null);
      setError("Enter an exact positive purchase price.");
      return;
    }
    if (sellingCostBps == null) {
      setRetryReload(null);
      setError("Enter selling costs from 0–100 percent.");
      return;
    }
    if (
      accumulatedFederalDepreciationCents == null ||
      accumulatedCaliforniaDepreciationCents == null ||
      accumulatedFederalDepreciationCents < 0 ||
      accumulatedCaliforniaDepreciationCents < 0
    ) {
      setRetryReload(null);
      setError("Enter exact non-negative accumulated depreciation amounts.");
      return;
    }
    const patch: HomeSaleSourcePatch = {
      purchaseDate: draft.purchaseDate,
      purchasePriceCents,
      homeSaleAssumptions: {
        sellingCostBps,
        primaryResidenceExclusionEligible: inferredEligibility ??
          draft.primaryResidenceExclusionEligible,
        accumulatedFederalDepreciationCents,
        accumulatedCaliforniaDepreciationCents,
      },
    };
    setSaving(true);
    setError("");
    setRetryReload(null);
    try {
      if (home.property.source === "current") {
        await onUpdateCurrentHome(home.property.assetId, patch);
      } else {
        const purchase = latestOwnedPlannedPurchase(
          scenario,
          home.property.assetId,
          retirementDate,
        );
        if (purchase == null) throw new Error("Planned home purchase not found");
        await onUpdatePlannedHome(purchase.id, patch);
      }
    } catch (saveError) {
      if (saveError instanceof HomeSaleReloadError) {
        setError(saveError.message);
        setRetryReload(() => saveError.retryReload);
      } else {
        setError("Sale details could not be saved. Retry when ready.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    if (retryReload == null) return;
    setSaving(true);
    try {
      await retryReload();
      setError("");
      setRetryReload(null);
    } catch {
      setError("Home sale details were saved, but refreshed data could not be loaded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article aria-label={`${home.property.name} sale details`}>
      <h4>{home.property.name}</h4>
      <p>{issues.length === 0 ? "Complete" : "Needs details"}</p>
      {inferredEligibility != null && (
        <p>{`${inferredEligibility ? "Eligible" : "Not eligible"} (inferred from Plan)`}</p>
      )}
      <dl>
        {home.purchaseDate && (
          <>
            <dt>Purchase date</dt>
            <dd>{date(home.purchaseDate)}</dd>
          </>
        )}
        {home.taxBasisCents != null && (
          <>
            <dt>Purchase price</dt>
            <dd>{money(home.taxBasisCents)}</dd>
          </>
        )}
        {home.assumptions && (
          <>
            <dt>Selling costs</dt>
            <dd>{home.assumptions.sellingCostBps / 100}%</dd>
            <dt>Primary-home gain exclusion</dt>
            <dd>
              {home.assumptions.primaryResidenceExclusionEligible
                ? "Eligible"
                : "Not eligible"}
            </dd>
            <dt>Federal depreciation claimed</dt>
            <dd>
              {money(
                home.assumptions.accumulatedFederalDepreciationCents,
              )}
            </dd>
            <dt>California depreciation claimed</dt>
            <dd>
              {money(
                home.assumptions.accumulatedCaliforniaDepreciationCents,
              )}
            </dd>
          </>
        )}
        <dt>Plan-derived projected sale value</dt>
        <dd>{money(home.property.valueCents)}</dd>
        <dt>Plan-derived appreciation</dt>
        <dd>
          {home.taxBasisCents == null
            ? "Unavailable"
            : money(home.property.valueCents - home.taxBasisCents)}
        </dd>
      </dl>
      <details>
        <summary>Edit sale details</summary>
        <form onSubmit={save}>
          {missing.has("purchaseDate") && (
            <label>
              Purchase date
              <input
                type="date"
                value={draft.purchaseDate}
                onChange={(event) => set({ purchaseDate: event.target.value })}
              />
            </label>
          )}
          {missing.has("taxBasis") && (
            <label>
              Purchase price
              <input
                inputMode="decimal"
                value={draft.purchasePrice}
                onChange={(event) => set({ purchasePrice: event.target.value })}
              />
            </label>
          )}
          {missing.has("sellingCostBps") && (
            <label>
              Selling costs (%)
              <input
                inputMode="decimal"
                value={draft.sellingCosts}
                onChange={(event) => set({ sellingCosts: event.target.value })}
              />
            </label>
          )}
          {missing.has("primaryResidenceEligibility") &&
            inferredEligibility == null && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.primaryResidenceExclusionEligible}
                  onChange={(event) =>
                    set({
                      primaryResidenceExclusionEligible: event.target.checked,
                    })
                  }
                />{" "}
                Eligible for primary-home gain exclusion
              </label>
            )}
          {missing.has("federalDepreciation") && (
            <label>
              Federal depreciation claimed
              <input
                inputMode="decimal"
                value={draft.federalDepreciation}
                onChange={(event) =>
                  set({ federalDepreciation: event.target.value })
                }
              />
            </label>
          )}
          {missing.has("californiaDepreciation") && (
            <label>
              California depreciation claimed
              <input
                inputMode="decimal"
                value={draft.californiaDepreciation}
                onChange={(event) =>
                  set({ californiaDepreciation: event.target.value })
                }
              />
            </label>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            type={retryReload == null ? "submit" : "button"}
            disabled={saving}
            onClick={retryReload == null ? undefined : reload}
          >
            {saving
              ? "Saving…"
              : retryReload
                ? "Reload failed — retry"
                : error
                  ? "Retry save"
                  : "Save sale details"}
          </button>
        </form>
      </details>
    </article>
  );
}
