import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculatedPropertyTaxBasis,
  calculateInvestmentComparison,
  defaultInvestmentAssumptions,
  effectiveBuildingBasis,
  effectivePropertyTaxBasis,
  validateInvestmentAssumptions,
  type InvestmentAssumptions,
  type InvestmentComparisonRecord,
  type InvestmentTaxContext,
} from "./domain/investment";
import type { Repository } from "./repository";
import { ActionButton, DetailDisclosure } from "./ui";

const cash = (c: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(c / 100);
const compactCash = (c: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(c / 100);
type AssumptionGroup = "General" | "Buy" | "Rent";
type NumericAssumptionKey = Exclude<
  keyof InvestmentAssumptions,
  | "factorRentalTaxes"
  | "propertyTaxBasisOverrideCents"
  | "buildingBasisOverrideCents"
  | "mfsLivedApartAllYear"
  | "rentalType"
  | "shortTermMaterialParticipation"
  | "longTermRealEstateProfessional"
  | "longTermMaterialParticipation"
  | "retirementIncomeMode"
  | "primaryResidence"
  | "aduPlanned"
>;
const fields: {
  key: NumericAssumptionKey;
  label: string;
  kind: "money" | "percent" | "number";
  group: AssumptionGroup;
  advanced?: boolean;
}[] = [
  { key: "homePriceCents", label: "Home price", kind: "money", group: "Buy" },
  {
    key: "homeSquareFeet",
    label: "Home square footage at purchase",
    kind: "number",
    group: "Buy",
  },
  {
    key: "aduSquareFeet",
    label: "ADU square footage",
    kind: "number",
    group: "Buy",
    advanced: true,
  },
  {
    key: "aduBuildYear",
    label: "ADU build year (year of projection)",
    kind: "number",
    group: "Buy",
    advanced: true,
  },
  {
    key: "aduBuildCostCents",
    label: "ADU build cost",
    kind: "money",
    group: "Buy",
    advanced: true,
  },
  {
    key: "aduMonthlyRentCents",
    label: "Added monthly ADU rent",
    kind: "money",
    group: "Buy",
    advanced: true,
  },
  {
    key: "downPaymentBps",
    label: "Down payment",
    kind: "percent",
    group: "Buy",
  },
  {
    key: "mortgageRateBps",
    label: "Mortgage rate",
    kind: "percent",
    group: "Buy",
  },
  {
    key: "mortgageTermYears",
    label: "Mortgage term (years)",
    kind: "number",
    group: "Buy",
  },
  {
    key: "monthlyRentCents",
    label: "Current monthly rent",
    kind: "money",
    group: "Rent",
  },
  {
    key: "stockReturnBps",
    label: "Stock return",
    kind: "percent",
    group: "General",
  },
  {
    key: "homeAppreciationBps",
    label: "Home appreciation",
    kind: "percent",
    group: "Buy",
  },
  {
    key: "horizonYears",
    label: "Projection horizon (years)",
    kind: "number",
    group: "General",
  },
  {
    key: "purchaseCostBps",
    label: "Purchase costs",
    kind: "percent",
    group: "Buy",
    advanced: true,
  },
  {
    key: "sellingCostBps",
    label: "Selling costs",
    kind: "percent",
    group: "Buy",
    advanced: true,
  },
  {
    key: "propertyTaxBps",
    label: "Property tax",
    kind: "percent",
    group: "Buy",
    advanced: true,
  },
  {
    key: "annualInsuranceCents",
    label: "Annual insurance",
    kind: "money",
    group: "Buy",
    advanced: true,
  },
  {
    key: "insuranceGrowthBps",
    label: "Insurance growth",
    kind: "percent",
    group: "Buy",
    advanced: true,
  },
  {
    key: "monthlyHoaCents",
    label: "Monthly HOA",
    kind: "money",
    group: "Buy",
    advanced: true,
  },
  {
    key: "hoaGrowthBps",
    label: "HOA growth",
    kind: "percent",
    group: "Buy",
    advanced: true,
  },
  {
    key: "maintenanceBps",
    label: "Annual maintenance",
    kind: "percent",
    group: "Buy",
    advanced: true,
  },
  {
    key: "monthlyRentalIncomeCents",
    label: "Monthly rental income",
    kind: "money",
    group: "Buy",
    advanced: true,
  },
  {
    key: "rentalIncomeGrowthBps",
    label: "Rental income growth",
    kind: "percent",
    group: "Buy",
    advanced: true,
  },
  {
    key: "rentGrowthBps",
    label: "Rent growth",
    kind: "percent",
    group: "Rent",
    advanced: true,
  },
];
const show = (value: number, kind: string) =>
  kind === "money"
    ? (value / 100).toString()
    : kind === "percent"
      ? (value / 100).toString()
      : value.toString();
const parse = (value: string, kind: string) =>
  kind === "money" || kind === "percent"
    ? Math.round(Number(value) * 100)
    : Number(value);

export function InvestmentView({
  initial,
  repository,
  taxContext,
  onAddToPlan,
  scenarios = [],
  accounts = [],
  householdId = "local",
}: {
  initial?: InvestmentComparisonRecord | null;
  repository: Repository;
  taxContext?: InvestmentTaxContext;
  onAddToPlan?: (
    assumptions: InvestmentAssumptions,
    options: {
      scenarioId: string;
      date: string;
      fundingAccountIds: string[];
      includeAdu: boolean;
    },
  ) => void;
  scenarios?: readonly { id: string; name: string }[];
  accounts?: readonly { id: string; name: string }[];
  householdId?: string;
}) {
  const base = { ...defaultInvestmentAssumptions, ...initial?.assumptions };
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, show(base[f.key], f.kind)])),
  );
  const revision = useRef(initial?.revision ?? 1),
    initialRender = useRef(true),
    [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
      "idle",
    ),
    [scrub, setScrub] = useState<number | null>(null),
    [chartRange, setChartRange] = useState<5 | 10 | 15 | 20 | "max">("max"),
    [retryToken, setRetryToken] = useState(0);
  const [includeAduInRetirement, setIncludeAduInRetirement] = useState(true);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const investmentInvoker = useRef<HTMLElement | null>(null),
    investmentSheet = useRef<HTMLElement>(null);
  const [addOpen, setAddOpen] = useState(false),
    [addScenario, setAddScenario] = useState(scenarios[0]?.id ?? ""),
    [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10)),
    [funding, setFunding] = useState<string[]>(
      accounts[0] ? [accounts[0].id] : [],
    );
  const [taxSettings, setTaxSettings] = useState(() => ({
    factorRentalTaxes: base.factorRentalTaxes,
    mfsLivedApartAllYear: base.mfsLivedApartAllYear,
    propertyTaxBasisOverrideCents: base.propertyTaxBasisOverrideCents,
    buildingBasisOverrideCents: base.buildingBasisOverrideCents,
    rentalType: base.rentalType,
    shortTermMaterialParticipation: base.shortTermMaterialParticipation,
    longTermRealEstateProfessional: base.longTermRealEstateProfessional,
    longTermMaterialParticipation: base.longTermMaterialParticipation,
    fireWithdrawalRateBps: base.fireWithdrawalRateBps,
    retirementIncomeMode: base.retirementIncomeMode,
    annualRetirementIncomeCents: base.annualRetirementIncomeCents,
    primaryResidence: base.primaryResidence,
    aduPlanned: base.aduPlanned,
    rentalUseBps: base.rentalUseBps,
  }));
  const [basisDraft, setBasisDraft] = useState(() => ({
    property: show(effectivePropertyTaxBasis(base), "money"),
    building: show(effectiveBuildingBasis(base), "money"),
  }));
  const assumptions = useMemo(
    () =>
      ({
        ...Object.fromEntries(
          fields.map((f) => [f.key, parse(draft[f.key], f.kind)]),
        ),
        ...taxSettings,
      }) as unknown as InvestmentAssumptions,
    [draft, taxSettings],
  );
  const calculation = useMemo(
    () => calculateInvestmentComparison(assumptions, taxContext),
    [assumptions, taxContext],
  );
  const inputsValid = useMemo(
    () => validateInvestmentAssumptions(assumptions).length === 0,
    [assumptions],
  );
  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    if (!inputsValid || !repository.updateInvestmentComparison) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const saved = await repository.updateInvestmentComparison!({
          assumptions,
          expectedRevision: revision.current,
        });
        revision.current = saved.revision;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [assumptions, inputsValid, repository, retryToken]);
  const retry = () => setRetryToken((n) => n + 1);
  useEffect(() => {
    if (!assumptionsOpen) return;
    investmentSheet.current
      ?.querySelector<HTMLElement>("input,select,button")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setAssumptionsOpen(false);
        setAddOpen(false);
      } else if (e.key === "Tab" && investmentSheet.current) {
        const nodes = [
            ...investmentSheet.current.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])',
            ),
          ],
          first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      investmentInvoker.current?.focus();
    };
  }, [assumptionsOpen]);
  const update = (key: string, value: string) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const reset = () => {
    setDraft(
      Object.fromEntries(
        fields.map((f) => [
          f.key,
          show(defaultInvestmentAssumptions[f.key], f.kind),
        ]),
      ),
    );
    setTaxSettings({
      factorRentalTaxes: false,
      mfsLivedApartAllYear: false,
      propertyTaxBasisOverrideCents: null,
      buildingBasisOverrideCents: null,
      rentalType: "long-term",
      shortTermMaterialParticipation: false,
      longTermRealEstateProfessional: false,
      longTermMaterialParticipation: false,
      fireWithdrawalRateBps: defaultInvestmentAssumptions.fireWithdrawalRateBps,
      retirementIncomeMode: defaultInvestmentAssumptions.retirementIncomeMode,
      annualRetirementIncomeCents:
        defaultInvestmentAssumptions.annualRetirementIncomeCents,
      primaryResidence: false,
      aduPlanned: false,
      rentalUseBps: 0,
    });
    setBasisDraft({
      property: show(
        calculatedPropertyTaxBasis(defaultInvestmentAssumptions),
        "money",
      ),
      building: show(
        effectiveBuildingBasis(defaultInvestmentAssumptions),
        "money",
      ),
    });
    setScrub(null);
    setChartRange("max");
  };
  return (
    <div className="content investment-view">
      <section className="card card-title investment-toolbar">
        <div>
          <p className="eyebrow">Buy or rent</p>
          <h2>Investment comparison</h2>
        </div>
        <div className="investment-actions">
          {onAddToPlan && (
            <ActionButton
              tier="primary"
              type="button"
              onClick={(e) => {
                investmentInvoker.current = e.currentTarget;
                setAddOpen(true);
                setAssumptionsOpen(true);
              }}
            >
              Add to Plan
            </ActionButton>
          )}
          <ActionButton
            type="button"
            onClick={(e) => {
              investmentInvoker.current = e.currentTarget;
              setAddOpen(false);
              setAssumptionsOpen(true);
            }}
          >
            Edit assumptions
          </ActionButton>
        </div>
      </section>
      {!calculation.ok ? (
        <section className="card investment-error" role="alert">
          <h2>Adjust the assumptions to compare</h2>
          {calculation.errors.map((e, i) => (
            <p key={i}>{e.message}</p>
          ))}
        </section>
      ) : (
        <Results
          result={calculation.result}
          horizon={assumptions.horizonYears}
          scrub={scrub}
          setScrub={setScrub}
          range={chartRange}
          setRange={setChartRange}
          assumptions={assumptions}
          householdId={householdId}
        />
      )}
      {assumptionsOpen && (
        <div
          className="modal-backdrop sheet-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setAssumptionsOpen(false);
              setAddOpen(false);
            }
          }}
        >
          <section
            ref={investmentSheet}
            className="card investment-assumptions side-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="investment-assumptions-title"
          >
            <div className="card-title">
              <div>
                <p className="eyebrow">Illustrative defaults</p>
                <h2 id="investment-assumptions-title">
                  {addOpen ? "Add investment to Plan" : "Edit assumptions"}
                </h2>
              </div>
              <div className="investment-actions">
                <span
                  className={`save-state ${saveState}`}
                  role="status"
                  aria-live="polite"
                >
                  {saveState === "saving" ? (
                    "Saving…"
                  ) : saveState === "saved" ? (
                    "Saved"
                  ) : saveState === "error" ? (
                    <ActionButton onClick={retry}>
                      Save failed — retry
                    </ActionButton>
                  ) : (
                    ""
                  )}
                </span>
                <button type="button" onClick={reset}>
                  Reset to defaults
                </button>
                <ActionButton
                  type="button"
                  onClick={() => setAssumptionsOpen(false)}
                >
                  Done
                </ActionButton>
              </div>
            </div>
            {addOpen && (
              <div className="add-investment-setup">
                <label>
                  Scenario
                  <select
                    value={addScenario}
                    onChange={(e) => setAddScenario(e.target.value)}
                  >
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Purchase date
                  <input
                    type="date"
                    value={addDate}
                    onChange={(e) => setAddDate(e.target.value)}
                  />
                </label>
                <fieldset>
                  <legend>Funding accounts (in order)</legend>
                  {accounts.map((a) => (
                    <label className="check-row" key={a.id}>
                      <input
                        type="checkbox"
                        checked={funding.includes(a.id)}
                        onChange={(e) =>
                          setFunding(
                            e.target.checked
                              ? [...funding, a.id]
                              : funding.filter((x) => x !== a.id),
                          )
                        }
                      />
                      {a.name}
                    </label>
                  ))}
                </fieldset>
                {assumptions.aduPlanned && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={includeAduInRetirement}
                      onChange={(e) =>
                        setIncludeAduInRetirement(e.target.checked)
                      }
                    />{" "}
                    Include dated ADU build
                  </label>
                )}
                <button
                  disabled={!addScenario || !addDate || !funding.length}
                  onClick={() => {
                    onAddToPlan?.(assumptions, {
                      scenarioId: addScenario,
                      date: addDate,
                      fundingAccountIds: funding,
                      includeAdu: includeAduInRetirement,
                    });
                    setAddOpen(false);
                  }}
                >
                  Add purchase to Plan
                </button>
              </div>
            )}
            <p className="muted">
              The comparison does not modify your Plan. Tax estimates privately
              use the active scenario at its maximum projection.
            </p>
            <div className="assumption-sections">
              {(["General", "Buy", "Rent"] as const).map((group) => (
                <section key={group}>
                  <h3>{group} assumptions</h3>
                  <div className="investment-fields">
                    {fields
                      .filter((f) => !f.advanced && f.group === group)
                      .map((f) => (
                        <Field
                          key={f.key}
                          field={f}
                          value={draft[f.key]}
                          update={update}
                        />
                      ))}
                  </div>
                </section>
              ))}
            </div>
            <details>
              <summary>Advanced assumptions</summary>
              <div className="advanced-assumption-sections">
                {(["General", "Buy", "Rent"] as const).map((group) => {
                  const grouped = fields.filter(
                    (f) => f.advanced && f.group === group,
                  );
                  return grouped.length ? (
                    <section key={group}>
                      <h3>{group} assumptions</h3>
                      {group === "Buy" && (
                        <>
                          <p className="muted">
                            Gross tenant rent is invested monthly in a Buy-only
                            stock portfolio.
                          </p>
                          <label className="check-row">
                            <input
                              type="checkbox"
                              checked={taxSettings.aduPlanned}
                              onChange={(e) =>
                                setTaxSettings((s) => ({
                                  ...s,
                                  aduPlanned: e.target.checked,
                                }))
                              }
                            />{" "}
                            Plan an ADU
                          </label>
                          <label className="check-row">
                            <input
                              type="checkbox"
                              checked={taxSettings.primaryResidence}
                              onChange={(e) =>
                                setTaxSettings((s) => ({
                                  ...s,
                                  primaryResidence: e.target.checked,
                                  rentalUseBps:
                                    e.target.checked &&
                                    (assumptions.monthlyRentalIncomeCents > 0 ||
                                      (assumptions.aduPlanned &&
                                        assumptions.aduMonthlyRentCents > 0))
                                      ? s.rentalUseBps || 2500
                                      : 0,
                                }))
                              }
                            />{" "}
                            Primary residence
                          </label>
                          {taxSettings.primaryResidence &&
                            (assumptions.monthlyRentalIncomeCents > 0 ||
                              (assumptions.aduPlanned &&
                                assumptions.aduMonthlyRentCents > 0)) && (
                              <label>
                                Rental use percentage
                                <span className="input-affix">
                                  <input
                                    aria-label="Rental use percentage"
                                    type="number"
                                    min="1"
                                    max="99"
                                    value={taxSettings.rentalUseBps / 100}
                                    onChange={(e) =>
                                      setTaxSettings((s) => ({
                                        ...s,
                                        rentalUseBps: Math.round(
                                          Number(e.target.value) * 100,
                                        ),
                                      }))
                                    }
                                  />
                                  <i>%</i>
                                </span>
                                <small>
                                  Shared interest, costs, and building basis are
                                  allocated to rental use; gross tenant rent is
                                  not scaled.
                                </small>
                              </label>
                            )}
                          <label className="check-row">
                            <input
                              type="checkbox"
                              checked={taxSettings.factorRentalTaxes}
                              onChange={(e) =>
                                setTaxSettings((s) => ({
                                  ...s,
                                  factorRentalTaxes: e.target.checked,
                                }))
                              }
                            />{" "}
                            Factor rental taxes, deductions, and depreciation
                          </label>
                          {taxSettings.factorRentalTaxes && (
                            <>
                              <div className="investment-fields">
                                <label>
                                  Rental type
                                  <select
                                    aria-label="Rental type"
                                    value={taxSettings.rentalType}
                                    onChange={(e) =>
                                      setTaxSettings((s) => ({
                                        ...s,
                                        rentalType: e.target.value as
                                          | "long-term"
                                          | "short-term",
                                        shortTermMaterialParticipation:
                                          e.target.value === "short-term" &&
                                          s.shortTermMaterialParticipation,
                                        longTermRealEstateProfessional:
                                          e.target.value === "long-term" &&
                                          s.longTermRealEstateProfessional,
                                        longTermMaterialParticipation:
                                          e.target.value === "long-term" &&
                                          s.longTermMaterialParticipation,
                                      }))
                                    }
                                  >
                                    <option value="long-term">
                                      Long-term rental
                                    </option>
                                    <option value="short-term">
                                      Short-term rental
                                    </option>
                                  </select>
                                </label>
                                <BasisField
                                  label="Property tax basis"
                                  value={basisDraft.property}
                                  calculated={calculatedPropertyTaxBasis(
                                    assumptions,
                                  )}
                                  overridden={
                                    taxSettings.propertyTaxBasisOverrideCents !==
                                    null
                                  }
                                  onChange={(value) => {
                                    setBasisDraft((s) => ({
                                      ...s,
                                      property: value,
                                    }));
                                    const parsed = parse(value, "money");
                                    setTaxSettings((s) => ({
                                      ...s,
                                      propertyTaxBasisOverrideCents:
                                        Number.isSafeInteger(parsed)
                                          ? parsed
                                          : s.propertyTaxBasisOverrideCents,
                                    }));
                                  }}
                                  clear={() =>
                                    setTaxSettings((s) => ({
                                      ...s,
                                      propertyTaxBasisOverrideCents: null,
                                    }))
                                  }
                                />
                                <BasisField
                                  label="Depreciable building basis"
                                  value={basisDraft.building}
                                  calculated={Math.round(
                                    effectivePropertyTaxBasis(assumptions) *
                                      0.8,
                                  )}
                                  overridden={
                                    taxSettings.buildingBasisOverrideCents !==
                                    null
                                  }
                                  onChange={(value) => {
                                    setBasisDraft((s) => ({
                                      ...s,
                                      building: value,
                                    }));
                                    const parsed = parse(value, "money");
                                    setTaxSettings((s) => ({
                                      ...s,
                                      buildingBasisOverrideCents:
                                        Number.isSafeInteger(parsed)
                                          ? parsed
                                          : s.buildingBasisOverrideCents,
                                    }));
                                  }}
                                  clear={() =>
                                    setTaxSettings((s) => ({
                                      ...s,
                                      buildingBasisOverrideCents: null,
                                    }))
                                  }
                                />
                              </div>
                              {taxSettings.rentalType === "short-term" && (
                                <>
                                  <label className="check-row">
                                    <input
                                      type="checkbox"
                                      checked={
                                        taxSettings.shortTermMaterialParticipation
                                      }
                                      onChange={(e) =>
                                        setTaxSettings((s) => ({
                                          ...s,
                                          shortTermMaterialParticipation:
                                            e.target.checked,
                                        }))
                                      }
                                    />{" "}
                                    I expect to materially participate
                                  </label>
                                  <p className="muted">
                                    The estimate treats losses as nonpassive
                                    only when the operation qualifies as a
                                    short-term activity under federal rules and
                                    you materially participate. Verify average
                                    stays, services, and participation records
                                    with a tax professional.
                                  </p>
                                </>
                              )}
                              {taxSettings.rentalType === "long-term" && (
                                <>
                                  <label className="check-row">
                                    <input
                                      type="checkbox"
                                      checked={
                                        taxSettings.longTermRealEstateProfessional
                                      }
                                      onChange={(e) =>
                                        setTaxSettings((s) => ({
                                          ...s,
                                          longTermRealEstateProfessional:
                                            e.target.checked,
                                          longTermMaterialParticipation:
                                            e.target.checked &&
                                            s.longTermMaterialParticipation,
                                        }))
                                      }
                                    />{" "}
                                    One spouse qualifies as a real estate
                                    professional
                                  </label>
                                  {taxSettings.longTermRealEstateProfessional && (
                                    <label className="check-row">
                                      <input
                                        type="checkbox"
                                        checked={
                                          taxSettings.longTermMaterialParticipation
                                        }
                                        onChange={(e) =>
                                          setTaxSettings((s) => ({
                                            ...s,
                                            longTermMaterialParticipation:
                                              e.target.checked,
                                          }))
                                        }
                                      />{" "}
                                      Household materially participates in this
                                      rental
                                    </label>
                                  )}
                                  <p className="muted">
                                    One spouse must independently perform more
                                    than 750 hours—and more than half of that
                                    spouse’s personal-service work—in
                                    real-property trades or businesses. The
                                    household must also materially participate
                                    in this rental. Keep contemporaneous time
                                    records and verify qualification with a tax
                                    professional.
                                  </p>
                                </>
                              )}
                            </>
                          )}
                          {taxSettings.factorRentalTaxes &&
                            taxContext?.filingStatus === "married-separate" && (
                              <label className="check-row">
                                <input
                                  type="checkbox"
                                  checked={taxSettings.mfsLivedApartAllYear}
                                  onChange={(e) =>
                                    setTaxSettings((s) => ({
                                      ...s,
                                      mfsLivedApartAllYear: e.target.checked,
                                    }))
                                  }
                                />{" "}
                                Lived apart from spouse all year
                              </label>
                            )}
                        </>
                      )}
                      <div className="investment-fields">
                        {grouped
                          .filter(
                            (f) =>
                              !f.key.startsWith("adu") ||
                              taxSettings.aduPlanned,
                          )
                          .map((f) => (
                            <Field
                              key={f.key}
                              field={f}
                              value={draft[f.key]}
                              update={update}
                            />
                          ))}
                      </div>
                    </section>
                  ) : null;
                })}
              </div>
            </details>
            <span hidden>Rental income is invested monthly.</span>
          </section>
          {false && (
            <section className="card retirement-settings">
              <p className="eyebrow">Independent annual snapshots</p>
              <h2>FIRE / Retirement Income</h2>
              <div className="investment-fields">
                <label>
                  Income mode
                  <select
                    aria-label="Retirement income mode"
                    value={taxSettings.retirementIncomeMode}
                    onChange={(e) =>
                      setTaxSettings((s) => ({
                        ...s,
                        retirementIncomeMode: e.target.value as
                          | "current"
                          | "desired",
                      }))
                    }
                  >
                    <option value="current">Current retirement income</option>
                    <option value="desired">Desired spending target</option>
                  </select>
                </label>
                <label>
                  {taxSettings.retirementIncomeMode === "desired"
                    ? "Desired after-tax annual income"
                    : "Other annual retirement income"}
                  <span className="input-affix">
                    <i>$</i>
                    <input
                      aria-label={
                        taxSettings.retirementIncomeMode === "desired"
                          ? "Desired after-tax annual income"
                          : "Other annual retirement income"
                      }
                      type="number"
                      min="0"
                      value={taxSettings.annualRetirementIncomeCents / 100}
                      onChange={(e) =>
                        setTaxSettings((s) => ({
                          ...s,
                          annualRetirementIncomeCents: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        }))
                      }
                    />
                  </span>
                </label>
                <label>
                  FIRE withdrawal rate
                  <span className="input-affix">
                    <input
                      aria-label="FIRE withdrawal rate"
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.1"
                      value={taxSettings.fireWithdrawalRateBps / 100}
                      onChange={(e) =>
                        setTaxSettings((s) => ({
                          ...s,
                          fireWithdrawalRateBps: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        }))
                      }
                    />
                    <i>%</i>
                  </span>
                </label>
              </div>
              <p className="muted">
                Amounts and results are shown in today’s dollars. Future tax
                calculations inflate them using Plan inflation. Current income
                is modeled as fully taxable ordinary non-wage income without
                payroll tax.
              </p>
              {taxSettings.retirementIncomeMode === "desired" && (
                <p className="muted">
                  The after-tax target remains the source of truth; its
                  ordinary-income gross equivalent is solved within each path’s
                  tax calculation.
                </p>
              )}
              {/* TODO: Replace manual income with a Retirement tab driven by Plan post-wage income, account types, Social Security/pensions, and multiple properties. */}
            </section>
          )}
        </div>
      )}
      <p className="muted projection-note">
        Deterministic estimate, not tax advice. Tax modeling assumes a
        100%-owned California residential rental, cash method, and direct
        ownership. Short-term nonpassive treatment requires material
        participation; long-term nonpassive treatment requires both
        real-estate-professional status and material participation. Excludes
        QBI, at-risk limits, refinancing, later improvements, 1031 exchanges,
        primary-residence exclusions, entities, municipal taxes, and prior
        Section 1231 history. Stock portfolios remain invested and are not taxed
        on sale.
      </p>
    </div>
  );
}
function BasisField({
  label,
  value,
  calculated,
  overridden,
  onChange,
  clear,
}: {
  label: string;
  value: string;
  calculated: number;
  overridden: boolean;
  onChange: (v: string) => void;
  clear: () => void;
}) {
  return (
    <label>
      {label}
      <span className="input-affix">
        <i>$</i>
        <input
          aria-label={label}
          inputMode="decimal"
          type="number"
          min="0"
          value={overridden ? value : show(calculated, "money")}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      {overridden && (
        <button type="button" className="basis-reset" onClick={clear}>
          Use calculated basis
        </button>
      )}
    </label>
  );
}
function Field({
  field,
  value,
  update,
}: {
  field: (typeof fields)[number];
  value: string;
  update: (k: string, v: string) => void;
}) {
  return (
    <label>
      {field.label}
      <span className="input-affix">
        {field.kind === "money" && <i>$</i>}
        <input
          aria-label={field.label}
          inputMode="decimal"
          type="number"
          min="0"
          step={field.kind === "percent" ? "0.1" : "1"}
          value={value}
          onChange={(e) => update(field.key, e.target.value)}
        />
        {field.kind === "percent" && <i>%</i>}
      </span>
    </label>
  );
}
function Results({
  result,
  horizon,
  scrub,
  setScrub,
  range,
  setRange,
  assumptions,
  householdId,
}: {
  result: Extract<
    ReturnType<typeof calculateInvestmentComparison>,
    { ok: true }
  >["result"];
  horizon: number;
  scrub: number | null;
  setScrub: (n: number | null) => void;
  range: 5 | 10 | 15 | 20 | "max";
  setRange: (n: 5 | 10 | 15 | 20 | "max") => void;
  assumptions: InvestmentAssumptions;
  householdId: string;
}) {
  const end = result.months.at(-1)!,
    equityDiff = end.stockValueCents - end.buyRetainedTotalCents,
    saleDiff = end.stockValueCents - end.buySaleTotalCents;
  const leader = equityDiff >= 0 ? "Renting and investing" : "Buying";
  const timing = (items: typeof result.equityCrossovers) =>
    items[0]
      ? `Year ${items[0].year}, month ${((items[0].month - 1) % 12) + 1}`
      : "No crossover";
  return (
    <>
      <section className="investment-summary">
        <article className="card">
          <p className="eyebrow">At year {horizon}</p>
          <h2>{leader} is ahead</h2>
          <strong>{cash(Math.abs(equityDiff))}</strong>
          <small>versus retained Buy total, including rental investments</small>
        </article>
        <article className="card">
          <p>Versus sold Buy total</p>
          <strong>
            {saleDiff >= 0 ? "+" : "−"}
            {cash(Math.abs(saleDiff))}
          </strong>
          <small>sale proceeds plus rental investments</small>
        </article>
        <article className="card">
          <p>First crossover</p>
          <strong>{timing(result.equityCrossovers)}</strong>
          <small>
            retained home · {timing(result.saleCrossovers)} after sale
          </small>
        </article>
      </section>
      <Chart
        result={result}
        scrub={scrub}
        setScrub={setScrub}
        range={range}
        setRange={setRange}
      />
      <section className="card annual-results">
        <DetailDisclosure
          label="View annual projection"
          householdId={householdId}
          preferenceKey="investment:annual-projection"
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Rent &amp; invest</th>
                  <th>Home value</th>
                  <th>Mortgage</th>
                  <th>Equity</th>
                  <th>After-tax sale proceeds</th>
                  <th>Rental income</th>
                  <th>Rental portfolio</th>
                  <th>Buy retained total</th>
                  <th>Buy sold total</th>
                  <th>Rental-property outlay</th>
                  <th>Tax-adjusted Buy contribution</th>
                </tr>
              </thead>
              <tbody>
                {result.years.map((y) => (
                  <tr key={y.year}>
                    <th>{y.year}</th>
                    {[
                      y.stockValueCents,
                      y.homeValueCents,
                      y.mortgageBalanceCents,
                      y.equityCents,
                      y.saleProceedsCents,
                      y.rentalIncomeCents,
                      y.rentalPortfolioCents,
                      y.buyRetainedTotalCents,
                      y.buySaleTotalCents,
                      y.ownerOutlayCents,
                      y.taxAdjustedBuyContributionCents,
                    ].map((v, i) => (
                      <td key={i}>{cash(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DetailDisclosure
            label="View rental tax ledger (estimated)"
            householdId={householdId}
            preferenceKey="investment:rental-tax-ledger"
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Tax year</th>
                    <th>Gross rent</th>
                    <th>Interest</th>
                    <th>Operating deductions</th>
                    <th>Depreciation</th>
                    <th>Federal allowed</th>
                    <th>CA allowed</th>
                    <th>Federal suspended</th>
                    <th>CA suspended</th>
                    <th>Baseline tax</th>
                    <th>Buy tax</th>
                    <th>Tax savings / (added tax)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.years.map((y) => (
                    <tr key={y.year}>
                      <th>{y.calendarYear}</th>
                      {[
                        y.rentalIncomeCents,
                        y.interestCents,
                        y.deductibleOperatingExpensesCents,
                        y.depreciationCents,
                        y.federalAllowedRentalCents,
                        y.californiaAllowedRentalCents,
                        y.federalPassiveCarryforwardCents,
                        y.californiaPassiveCarryforwardCents,
                        y.baselineTaxCents,
                        y.buyTaxCents,
                        y.netTaxDeltaCents,
                      ].map((v, i) => (
                        <td key={i}>{cash(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              Uses projected tax-rule years {result.taxRuleYears[0]}–
              {result.taxRuleYears.at(-1)}. Expenses here are Schedule E
              deductions, not Schedule A deductions.
            </p>
          </DetailDisclosure>
        </DetailDisclosure>
      </section>
    </>
  );
}
function Chart({
  result,
  scrub,
  setScrub,
  range,
  setRange,
}: {
  result: Extract<
    ReturnType<typeof calculateInvestmentComparison>,
    { ok: true }
  >["result"];
  scrub: number | null;
  setScrub: (n: number | null) => void;
  range: 5 | 10 | 15 | 20 | "max";
  setRange: (n: 5 | 10 | 15 | 20 | "max") => void;
}) {
  const count =
      range === "max"
        ? result.months.length
        : Math.min(result.months.length, range * 12 + 1),
    months = result.months.slice(0, count),
    values = months.flatMap((m) => [
      m.stockValueCents,
      m.buyRetainedTotalCents,
      m.buySaleTotalCents,
    ]),
    min = Math.min(...values, 0),
    max = Math.max(...values, 0),
    span = Math.max(1, max - min);
  const coords = (get: (m: (typeof months)[number]) => number) =>
    months.map((m, i) => ({
      x: months.length === 1 ? 50 : 4 + (i * 92) / (months.length - 1),
      y: 8 + ((max - get(m)) * 76) / span,
      value: get(m),
    }));
  const series = [
      {
        id: "stock",
        name: "Rent & invest",
        color: "#5478d4",
        points: coords((m) => m.stockValueCents),
      },
      {
        id: "equity",
        name: "Buy total — retained",
        color: "#739466",
        points: coords((m) => m.buyRetainedTotalCents),
      },
      {
        id: "sale",
        name: "Buy total — sold",
        color: "#b68159",
        points: coords((m) => m.buySaleTotalCents),
      },
    ],
    path = (points: ReturnType<typeof coords>) =>
      points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  const tickYs = [8, 27, 46, 65, 84],
    valueTicks = tickYs.map((y) => ({
      y,
      value: Math.round(max - ((y - 8) * span) / 76),
    })),
    years = Math.ceil((months.length - 1) / 12),
    step = years > 20 ? 5 : years > 10 ? 2 : 1,
    yearTicks = Array.from({ length: years }, (_, i) => i + 1)
      .filter((year) => year % step === 0 || year === years)
      .map((year) => ({
        label: `Year ${year}`,
        x:
          4 +
          (Math.min(year * 12, months.length - 1) * 92) /
            Math.max(1, months.length - 1),
      }));
  const active = scrub === null ? null : Math.min(scrub, months.length - 1),
    activeMonth = active === null ? null : months[active],
    move = (delta: number) =>
      setScrub(Math.max(0, Math.min(months.length - 1, (active ?? 0) + delta)));
  return (
    <section
      className="investment-chart cash-flow-chart card wide"
      aria-labelledby="investment-chart-title"
    >
      <div className="chart-heading">
        <div>
          <span className="label projected">Projected balances</span>
          <h3 id="investment-chart-title">Rent &amp; invest versus buy</h3>
        </div>
        <div className="chart-ranges" aria-label="Investment projection range">
          {([5, 10, 15, 20, "max"] as const).map((item) => (
            <button
              key={item}
              aria-pressed={range === item}
              disabled={
                item !== "max" &&
                item > Math.ceil((result.months.length - 1) / 12)
              }
              onClick={() => {
                setRange(item);
                setScrub(null);
              }}
            >
              {item === "max" ? "Max" : `${item}Y`}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-y-axis" aria-hidden="true">
        {valueTicks.map((t) => (
          <span key={t.y} style={{ top: `${t.y}%` }}>
            {compactCash(t.value)}
          </span>
        ))}
      </div>
      <div className="chart-x-axis" aria-hidden="true">
        {yearTicks.map((t) => (
          <span key={t.label} style={{ left: `${t.x}%` }}>
            <i />
            {t.label}
          </span>
        ))}
      </div>
      <div className="investment-chart-legend" aria-live="polite">
        {series.map((s) => (
          <div key={s.id}>
            <i style={{ background: s.color }} />
            <span>{s.name}</span>
            <strong>{cash(s.points.at(-1)?.value ?? 0)}</strong>
            <small>Ending projected value</small>
          </div>
        ))}
      </div>
      <div
        className="chart-canvas"
        role="slider"
        tabIndex={0}
        aria-label="Explore projected investment comparison by month"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, months.length - 1)}
        aria-valuenow={active ?? 0}
        aria-valuetext={
          activeMonth
            ? `Year ${Math.ceil(activeMonth.month / 12) || 0}, rent and invest ${cash(activeMonth.stockValueCents)}, retained Buy total ${cash(activeMonth.buyRetainedTotalCents)}, sold Buy total ${cash(activeMonth.buySaleTotalCents)}, rental portfolio ${cash(activeMonth.rentalPortfolioCents)}`
            : "Use left and right arrow keys to explore"
        }
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect(),
            ratio = Math.max(
              0,
              Math.min(
                1,
                ((event.clientX - rect.left) / rect.width - 0.04) / 0.92,
              ),
            );
          setScrub(Math.round(ratio * (months.length - 1)));
        }}
        onPointerLeave={() => setScrub(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          move(event.key === "ArrowRight" ? 1 : -1);
        }}
      >
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label="Line chart comparing the projected stock portfolio, home equity, and hypothetical net sale proceeds"
          preserveAspectRatio="none"
        >
          {tickYs.map((y) => (
            <line key={y} className="chart-grid" x1="4" x2="96" y1={y} y2={y} />
          ))}
          <line
            className="chart-zero"
            x1="4"
            x2="96"
            y1={8 + (max * 76) / span}
            y2={8 + (max * 76) / span}
          />
          {series.map((s) => (
            <path
              key={s.id}
              className={`investment-chart-line ${s.id}`}
              style={{ stroke: s.color }}
              d={path(s.points)}
            />
          ))}
          {[...result.equityCrossovers, ...result.saleCrossovers]
            .filter((c) => c.month < months.length)
            .map((c, i) => (
              <circle
                key={i}
                className="investment-crossover"
                cx={series[0].points[c.month].x}
                cy={series[0].points[c.month].y}
                r=".8"
              >
                <title>Crossover in year {c.year}</title>
              </circle>
            ))}
        </svg>
        {active !== null && activeMonth && (
          <>
            <i
              className="chart-scrub-line"
              style={{ left: `${series[0].points[active].x}%` }}
            />
            {series.map((s) => (
              <i
                key={s.id}
                className="chart-scrub-point"
                style={{
                  left: `${s.points[active].x}%`,
                  top: `${s.points[active].y}%`,
                  borderColor: s.color,
                }}
              />
            ))}
            <output
              className="chart-tooltip cash-scrub-tooltip"
              style={{
                left: `${series[0].points[active].x}%`,
                top: `${Math.min(...series.map((s) => s.points[active].y))}%`,
              }}
            >
              {activeMonth.month === 0
                ? "Current"
                : `Year ${Math.ceil(activeMonth.month / 12)}, month ${((activeMonth.month - 1) % 12) + 1}`}
              {series.map((s) => (
                <strong key={s.id}>
                  <i style={{ background: s.color }} />
                  {s.name}: {cash(s.points[active].value)} projected
                </strong>
              ))}
              <small>
                Buy rental portfolio: {cash(activeMonth.rentalPortfolioCents)}
              </small>
            </output>
          </>
        )}
      </div>
    </section>
  );
}
