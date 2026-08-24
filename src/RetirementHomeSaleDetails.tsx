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
  onEditAcquisition?: (
    home: ResolvedRetirementHome,
    invoker: HTMLElement,
  ) => void;
}

type Draft = {
  sellingCosts: string;
  saleUse: "" | "personal" | "rental";
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
  sellingCosts: home.assumptions == null
    ? ""
    : String(home.assumptions.sellingCostBps / 100),
  saleUse: home.assumptions?.saleUse ?? "",
  primaryResidenceExclusionEligible:
    home.primaryResidenceEligibility.source === "unknown"
      ? false
      : home.primaryResidenceEligibility.eligible,
  federalDepreciation: String(
    (home.assumptions?.accumulatedFederalDepreciationCents ?? 0) / 100,
  ),
  californiaDepreciation: String(
    (home.assumptions?.accumulatedCaliforniaDepreciationCents ?? 0) / 100,
  ),
});

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
      home.primaryResidenceEligibility,
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
    home.primaryResidenceEligibility,
  ]);
};

export function RetirementHomeSaleDetails({
  homes,
  issues,
  scenario,
  retirementDate,
  onUpdateCurrentHome,
  onUpdatePlannedHome,
  onEditAcquisition,
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
          onEditAcquisition={onEditAcquisition}
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
  onEditAcquisition,
}: {
  home: ResolvedRetirementHome;
  issues: readonly RetirementMissingData[];
  scenario: Scenario;
  retirementDate: string;
  onUpdateCurrentHome: RetirementHomeSaleDetailsProps["onUpdateCurrentHome"];
  onUpdatePlannedHome: RetirementHomeSaleDetailsProps["onUpdatePlannedHome"];
  onEditAcquisition: RetirementHomeSaleDetailsProps["onEditAcquisition"];
}) {
  const [draft, setDraft] = useState(() => draftFor(home));
  const [error, setError] = useState("");
  const [retryReload, setRetryReload] = useState<(() => Promise<void>) | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const set = (values: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...values }));

  async function save(event: FormEvent) {
    event.preventDefault();
    const sellingCostBps = parsePercent(draft.sellingCosts);
    const accumulatedFederalDepreciationCents = parseMoney(
      draft.federalDepreciation,
    );
    const accumulatedCaliforniaDepreciationCents = parseMoney(
      draft.californiaDepreciation,
    );
    if (issues.some((issue) => issue.field === "rentalUse") && draft.saleUse === "") {
      setRetryReload(null);
      setError("Choose whether the home sale should be taxed as a personal home or rental property.");
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
      homeSaleAssumptions: {
        sellingCostBps,
        ...(draft.saleUse === "" ? {} : { saleUse: draft.saleUse }),
        ...(home.primaryResidenceEligibility.source === "derived"
          ? {}
          : {
              primaryResidenceExclusionEligible:
                draft.primaryResidenceExclusionEligible,
            }),
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
      {issues.length > 0 ? (
        <ul className="retirement-home-sale-issues" aria-label={`${home.property.name} missing sale details`}>
          {issues.map((issue, index) => (
            <li key={`${issue.field}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
      {home.primaryResidenceEligibility.source === "derived" && (
        <p>{`${home.primaryResidenceEligibility.eligible ? "Eligible" : "Not eligible"} (derived from Plan)`}</p>
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
        <dt>Primary-home gain exclusion</dt>
        <dd>
          {home.primaryResidenceEligibility.source === "unknown"
            ? "Needs confirmation"
            : home.primaryResidenceEligibility.eligible
              ? "Eligible"
              : "Not eligible"}
        </dd>
        <dt>Sale tax treatment</dt>
        <dd>{home.use === "personal" ? "Personal home" : home.use === "rental" ? "Rental property" : "Needs selection"}</dd>
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
          <div className="retirement-acquisition-source">
            <p>
              Acquisition date and purchase basis are maintained in {home.property.source === "current" ? "Net Worth" : "Plan"}.
            </p>
            {onEditAcquisition && (
              <button
                type="button"
                onClick={(event) => onEditAcquisition(home, event.currentTarget)}
              >
                Edit {home.property.name} acquisition in {home.property.source === "current" ? "Net Worth" : "Plan"}
              </button>
            )}
          </div>
          <label>
            Selling costs (%)
            <input
              inputMode="decimal"
              value={draft.sellingCosts}
              onChange={(event) => set({ sellingCosts: event.target.value })}
            />
          </label>
          <label>
            Sale tax treatment
            <select
              value={draft.saleUse}
              onChange={(event) => set({ saleUse: event.target.value as Draft["saleUse"] })}
            >
              <option value="">Choose treatment</option>
              <option value="personal">Personal home</option>
              <option value="rental">Rental property</option>
            </select>
          </label>
          {home.primaryResidenceEligibility.source !== "derived" && (
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
