import {
  FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Command,
  Landmark,
  LayoutDashboard,
  Moon,
  MoreHorizontal,
  PiggyBank,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  TrendingUp,
  Umbrella,
  WalletCards,
} from "lucide-react";
import {
  effectiveContributionBps,
  californiaAssessedValue,
  ProjectionEngine,
  projectedSharePrice,
  valueForUnits,
  vestedAssetValue,
  vestedUnitsAt,
  type FinancialSnapshot,
  type Scenario,
} from "./domain";

import {
  tauriRepository,
  type Bootstrap,
  type BootstrapInput,
  type BootstrapAccount,
  type BootstrapPerson,
  type Repository,
  type StartupError,
  type Theme,
  type ActivityPosting,
  type AccountKind,
  type CsvInspection,
  type CsvMapping,
  type CsvPreview,
  type Asset,
  type Liability,
  type RecurringEntry,
  type RecurringInput,
  type AssetInput,
  type LiabilityInput,
  type TaxProfile,
  type ScenarioRecord,
  type WorkspaceInfo,
  emptySettings,
} from "./repository";
import { ScenarioPlanningDialog } from "./ScenarioPlanningDialog";
import { InvestmentView } from "./InvestmentView";
import { RetirementView } from "./RetirementView";
import {
  defaultRetirementPlan,
  type RetirementSettingsRecord,
} from "./domain";
import {
  buildSearchIndex,
  GlobalSearch,
  type SearchResult,
} from "./GlobalSearch";
import {
  ActionButton,
  AnchoredMenu,
  DetailDisclosure,
  InfoPopover,
  OverflowMenu,
} from "./ui";

const units = (micros: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(
    micros / 1_000_000,
  );
const equityVestedValue = (asset: Pick<Asset, "equityHolding">, date: string) =>
  asset.equityHolding?.grants.reduce(
    (sum, grant) =>
      sum +
      valueForUnits(
        vestedUnitsAt(grant, date),
        projectedSharePrice(asset.equityHolding!, date),
      ),
    0,
  ) ?? 0;
const currentAssetValue = (
  asset: Pick<Asset, "valueCents" | "privateStock" | "equityHolding">,
  date: string,
) =>
  asset.equityHolding
    ? equityVestedValue(asset, date)
    : vestedAssetValue(asset, date);
const nextVest = (grant: import("./domain").RsuGrant, date: string) =>
  grant.vestEvents.find((event) => event.date > date);

type View =
  | "Overview"
  | "Activity"
  | "Plan"
  | "Investment"
  | "Retirement"
  | "Net Worth"
  | "Settings";
const localIsoDate = () => {
  const now = new Date(),
    offset = now.getTimezoneOffset() * 60000;
  return new Date(now.valueOf() - offset).toISOString().slice(0, 10);
};
const nav: [View, typeof LayoutDashboard, string][] = [
  ["Overview", LayoutDashboard, "Overview"],
  ["Plan", PiggyBank, "Planning"],
  ["Investment", TrendingUp, "Planning"],
  ["Retirement", Umbrella, "Planning"],
  ["Activity", Activity, "Records"],
  ["Net Worth", Landmark, "Records"],
  ["Settings", Settings, "Settings"],
];
const money = (cents: number, compact = false) => {
  const showMillionDecimals = compact && Math.abs(cents) >= 100_000_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showMillionDecimals ? 2 : compact ? 0 : 2,
    maximumFractionDigits: compact ? (showMillionDecimals ? 2 : 0) : 2,
    notation: compact ? "compact" : "standard",
  }).format(cents / 100);
};

const baseline: Scenario = {
  id: "base",
  name: "Baseline",
  assumptions: { inflationBps: 250, thresholdInflationBps: 250 },
  assumptionsInherited: true,
  events: [],
  defaultContributionAccountId: "savings",
  contributions: [],
  withdrawals: [],
  horizon: { start: "2025-01", months: 120 },
};
const normalizeBootstrap = (value: BootstrapInput): Bootstrap => ({
  ...value,
  settings: value.settings ?? emptySettings,
  taxProfile: value.taxProfile ?? null,
  activity: value.activity ?? [],
  recurring: (value.recurring ?? []).map((entry) => ({
    ...entry,
    frequency: entry.frequency ?? "monthly",
    incomeType: entry.incomeType ?? "ordinary",
    taxTreatment: entry.taxTreatment ?? "none",
  })),
  assets: value.assets ?? [],
  liabilities: value.liabilities ?? [],
  scenarios: (value.scenarios ?? []).map((scenario) => ({
    ...scenario,
    defaultContributionAccountId:
      scenario.defaultContributionAccountId ??
      value.accounts.find(
        (account) =>
          account.liquid &&
          (account.kind === "checking" || account.kind === "savings"),
      )?.id ??
      null,
    withdrawals: scenario.withdrawals ?? [],
    contributions: (scenario.contributions ?? []).map((rule) => ({
      ...rule,
      percentBps: rule.percentBps ?? undefined,
      monthlyAmountCents: rule.monthlyAmountCents ?? undefined,
      targetBalanceCents: rule.targetBalanceCents ?? undefined,
      overflowDestinationType: rule.overflowDestinationType ?? undefined,
      overflowDestinationId: rule.overflowDestinationId ?? undefined,
    })),
  })),
  retirementPlan: value.retirementPlan ?? null,
  accounts: value.accounts.map((a) => ({
    ...a,
    balanceCents: "balanceCents" in a ? a.balanceCents : a.openingBalanceCents,
  })),
});

export function App({
  repository = tauriRepository,
}: {
  repository?: Repository;
}) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState<StartupError | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    repository
      .bootstrap()
      .then((value) => setBootstrap(normalizeBootstrap(value)))
      .catch((error) => setLoadError(normalizeStartupError(error)));
  }, [repository]);
  async function retryStartup() {
    if (retrying || !loadError?.retryable) return;
    setRetrying(true);
    try {
      const value = await repository.retryStartup();
      setBootstrap(normalizeBootstrap(value));
      setLoadError(null);
    } catch (error) {
      setLoadError(normalizeStartupError(error));
    } finally {
      setRetrying(false);
    }
  }
  if (loadError)
    return (
      <main className="standalone">
        <section className="card">
          <h1>LifeLook couldn’t open your data</h1>
          <p role="alert">{loadError.message}</p>
          <p>
            {startupGuidance[loadError.code] ?? startupGuidance.startup_failed}
          </p>
          {loadError.profilePath && (
            <p>
              <strong>Local profile:</strong>{" "}
              <code>{loadError.profilePath}</code>
            </p>
          )}
          <p>
            Your existing profile has not been deleted, renamed, replaced, or
            changed by this recovery screen.
          </p>
          {loadError.retryable && (
            <button disabled={retrying} onClick={retryStartup}>
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
          <p className="muted">
            You can safely close this window and try again later.
          </p>
        </section>
      </main>
    );
  if (!bootstrap)
    return (
      <main className="standalone">
        <p role="status">Opening your local workspace…</p>
      </main>
    );
  if (!bootstrap.onboardingComplete)
    return (
      <Onboarding
        initial={bootstrap}
        repository={repository}
        onComplete={() =>
          repository
            .bootstrap()
            .then((value) => setBootstrap(normalizeBootstrap(value)))
        }
      />
    );
  return (
    <Workspace
      bootstrap={bootstrap}
      repository={repository}
      onRefresh={() =>
        repository
          .bootstrap()
          .then((value) => setBootstrap(normalizeBootstrap(value)))
      }
      onRestore={(value) => setBootstrap(normalizeBootstrap(value))}
    />
  );
}

const startupGuidance: Record<string, string> = {
  corrupt:
    "The profile appears damaged. Restore access to a known-good copy or contact support before retrying.",
  unwritable:
    "Check the profile and folder permissions, free disk space if needed, then retry.",
  incompatible:
    "Open this profile with the newer LifeLook version that created it.",
  startup_failed: "Resolve the reported local profile problem, then retry.",
};
function normalizeStartupError(error: unknown): StartupError {
  if (error && typeof error === "object") {
    const value = error as Partial<StartupError>;
    return {
      code: value.code ?? "startup_failed",
      message: value.message ?? "Could not open the local database",
      profilePath: value.profilePath,
      retryable: value.retryable ?? true,
    };
  }
  return {
    code: "startup_failed",
    message:
      typeof error === "string" ? error : "Could not open the local database",
    retryable: true,
  };
}

function Workspace({
  bootstrap,
  repository,
  onRefresh,
  onRestore,
}: {
  bootstrap: Bootstrap;
  repository: Repository;
  onRefresh: () => Promise<void>;
  onRestore: (value: BootstrapInput) => void;
}) {
  const [view, setView] = useState<View>("Overview");
  const [settings, setSettings] = useState(bootstrap.settings);
  useEffect(() => setSettings(bootstrap.settings), [bootstrap.settings]);
  const systemDark = () =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches;
  const [osDark, setOsDark] = useState(systemDark);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setOsDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (settings.theme !== "system" || !repository.systemThemeDark) return;
    let active = true;
    const refresh = () =>
      repository
        .systemThemeDark?.()
        .then((value) => {
          if (active && value !== null && value !== undefined) setOsDark(value);
        })
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [settings.theme, repository]);
  const dark =
    settings.theme === "dark" || (settings.theme === "system" && osDark);
  async function toggleTheme() {
    const previous = settings,
      next = {
        ...settings,
        theme: dark ? ("light" as const) : ("dark" as const),
      };
    setSettings(next);
    if (!repository.updateSettings) return;
    try {
      setSettings(
        await repository.updateSettings({
          theme: next.theme,
          reducedMotion: next.reducedMotion,
          expectedRevision: previous.revision,
        }),
      );
    } catch {
      setSettings(previous);
    }
  }
  const [expanded, setExpanded] = useState<number | null>(null);
  const [planSeries, setPlanSeries] = useState("net-worth");
  const [planRange, setPlanRange] = useState<5 | 10 | 15 | 20 | "max">(10);
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    bootstrap.scenarios[0]?.id ?? "",
  );
  const [excludedPlannedProperties,setExcludedPlannedProperties]=useState<Record<string,string[]>>({});
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [searchInvoker, setSearchInvoker] = useState<HTMLElement | null>(null);
  const [focusTarget, setFocusTarget] = useState<{
    kind: string;
    id: string;
  } | null>(null);
  const searchIndex = useMemo(() => buildSearchIndex(bootstrap), [bootstrap]);
  const searchButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
  const profileMenu = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(
    null,
  );
  const [profileResult, setProfileResult] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  useEffect(() => {
    if (!profileOpen) return;
    setProfileResult("");
    setWorkspaceInfo(null);
    repository
      .workspaceInfo?.()
      .then(setWorkspaceInfo)
      .catch((error) =>
        setProfileResult(
          errorMessage(error, "Could not read workspace information."),
        ),
      );
    requestAnimationFrame(() =>
      profileMenu.current?.querySelector<HTMLElement>("button")?.focus(),
    );
    const dismiss = (event: MouseEvent) => {
      if (
        !profileMenu.current?.contains(event.target as Node) &&
        !profileButton.current?.contains(event.target as Node)
      ) {
        setProfileOpen(false);
        profileButton.current?.focus();
      }
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
        profileButton.current?.focus();
      }
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [profileOpen, repository]);
  async function backupFromProfile() {
    setProfileResult("");
    setProfileBusy(true);
    try {
      const destination = await repository.selectBackupDestination?.();
      if (!destination) return;
      await repository.backupDatabase?.(destination);
      setProfileResult("Backup created successfully.");
    } catch (error) {
      setProfileResult(errorMessage(error, "Could not create the backup."));
    } finally {
      setProfileBusy(false);
    }
  }
  function profileMenuKey(event: React.KeyboardEvent) {
    const items = [
      ...(profileMenu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? []),
    ];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  }
  const openDialog = (state: DialogState, invoker?: HTMLElement | null) =>
    setDialog({
      ...state,
      invoker: invoker ?? (document.activeElement as HTMLElement),
    });
  const closeDialog = () => setDialog(null);
  useLayoutEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!dialog && !searchInvoker)
          setSearchInvoker(document.activeElement as HTMLElement);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dialog, searchInvoker]);
  useEffect(() => {
    if (!focusTarget) return;
    requestAnimationFrame(() => {
      const target = [
        ...document.querySelectorAll<HTMLElement>(
          "[data-search-kind][data-search-id]",
        ),
      ].find(
        (x) =>
          x.dataset.searchKind === focusTarget.kind &&
          x.dataset.searchId === focusTarget.id,
      );
      if (target) {
        target.scrollIntoView?.({ block: "center" });
        target.focus();
        setFocusTarget(null);
      }
    });
  }, [view, focusTarget, selectedScenarioId]);
  function activateSearch(result: SearchResult) {
    setSearchInvoker(null);
    if (result.kind === "Scenario") setSelectedScenarioId(result.id);
    setFocusTarget({ kind: result.kind, id: result.id });
    setView(result.view);
  }
  const snapshot = useMemo<FinancialSnapshot>(
    () => ({
      household: {
        id: bootstrap.household?.id ?? "local",
        name: bootstrap.household?.name ?? "Household",
        state: "CA",
        people: bootstrap.people.map((p) => ({
          id: p.id,
          name: p.name,
          birthDate: p.birthDate ?? undefined,
        })),
      },
      taxProfile: bootstrap.taxProfile!,
      accounts: bootstrap.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        balanceCents: a.balanceCents,
        annualReturnBps: a.annualReturnBps,
        liquid: a.liquid,
      })),
      recurring: bootstrap.recurring.map((r) => ({
        ...r,
        accountId: r.accountId ?? undefined,
        endDate: r.endDate ?? undefined,
        taxTreatment: r.taxTreatment ?? "none",
        incomeType: r.incomeType ?? "ordinary",
        kind:
          bootstrap.categories.find((c) => c.id === r.categoryId)?.kind ===
          "income"
            ? "income"
            : "expense",
      })),
      assets: bootstrap.assets,
      liabilities: bootstrap.liabilities.map((liability) => ({
        ...liability,
        mortgage: liability.mortgage
          ? {
              ...liability.mortgage,
              paymentOverrideCents:
                liability.mortgage.paymentOverrideCents ?? undefined,
            }
          : undefined,
      })),
      actuals: bootstrap.activity.map((posting) => ({
        date: posting.occurredOn,
        kind: posting.kind,
        amountCents: posting.amountCents,
      })),
    }),
    [bootstrap],
  );
  const scenarios = useMemo(
    () =>
      bootstrap.scenarios.map(
        (record): Scenario => ({
          id: record.id,
          name: record.name,
          assumptions: {
            inflationBps: record.assumptions.inflationBps ?? 250,
            thresholdInflationBps:
              record.assumptions.thresholdInflationBps ?? 250,
          },
          assumptionsInherited: false,
          events: record.events,
          defaultContributionAccountId:
            record.defaultContributionAccountId ?? undefined,
          contributions: record.contributions,
          withdrawals: record.withdrawals ?? [],
          horizon: {
            start: new Date().toISOString().slice(0, 7),
            months: record.horizonMonths,
          },
        }),
      ),
    [bootstrap.scenarios],
  );
  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId) ??
    scenarios[0] ?? {
      ...baseline,
      defaultContributionAccountId: snapshot.accounts.find(
        (account) =>
          account.liquid &&
          (account.kind === "checking" || account.kind === "savings"),
      )?.id,
    };
  const excludedPropertyIds=new Set(excludedPlannedProperties[selectedScenario.id]??[]);
  const excludedLiabilityIds=new Set(selectedScenario.events.flatMap(event=>event.type==="asset-purchase"&&excludedPropertyIds.has(event.assetId)&&event.financing?[event.financing.liabilityId]:[]));
  const projectedScenario:Scenario={...selectedScenario,events:selectedScenario.events.filter(event=>{
    if(event.type==="asset-purchase")return !excludedPropertyIds.has(event.assetId);
    if("assetId" in event&&excludedPropertyIds.has(event.assetId))return false;
    if("liabilityId" in event&&excludedLiabilityIds.has(event.liabilityId))return false;
    if(event.type==="asset-sale"&&event.payoff&&excludedLiabilityIds.has(event.payoff.liabilityId))return false;
    return true;
  })};
  const projections = useMemo(
    () =>
      bootstrap.taxProfile
        ? ProjectionEngine.calculate(
            snapshot,
            {
              ...projectedScenario,
              horizon: {
                ...selectedScenario.horizon,
                months:
                  planRange === "max"
                    ? projectedScenario.horizon.months
                    : planRange * 12,
              },
            },
            localIsoDate(),
          )
        : null,
    [snapshot, bootstrap.taxProfile, projectedScenario, planRange],
  );
  const investmentTaxContext = useMemo(() => {
    if (!bootstrap.taxProfile?.taxUnit) return undefined;
    try {
      const annual = ProjectionEngine.calculate(
        snapshot,
        {
          ...projectedScenario,
          horizon: { ...projectedScenario.horizon, months: 480 },
        },
        localIsoDate(),
      );
      const years = annual.flatMap((row) =>
        row.taxLedger
          ? [
              {
                year: row.year,
                federalTaxableCents: row.taxLedger.federalTaxableCents,
                californiaTaxableCents: row.taxLedger.californiaTaxableCents,
                federalTaxCents: row.taxLedger.federalCents,
                californiaTaxCents: row.taxLedger.californiaCents,
                modifiedAgiCents: Math.max(0, row.taxLedger.grossIncomeCents),
              },
            ]
          : [],
      );
      const now = new Date(),
        startMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return years.length
        ? {
            filingStatus: bootstrap.taxProfile.filingStatus,
            thresholdInflationBps:
              projectedScenario.assumptions.thresholdInflationBps,
            startMonth,
            years,
          }
        : undefined;
    } catch {
      return undefined;
    }
  }, [snapshot, bootstrap.taxProfile, projectedScenario]);
  const projectedPositiveMonths =
      projections?.[0]?.months.filter((month) => month.surplusCents > 0) ?? [],
    projectedMonthlySurplusCents = projectedPositiveMonths.length
      ? projectedPositiveMonths.reduce(
          (sum, month) => sum + month.surplusCents,
          0,
        ) / projectedPositiveMonths.length
      : 0;
  const retirementProjections = useMemo(
    () =>
      bootstrap.taxProfile
        ? ProjectionEngine.calculate(snapshot, projectedScenario, localIsoDate())
        : [],
    [snapshot, bootstrap.taxProfile, projectedScenario],
  );
  const [retirementSettings, setRetirementSettings] =
    useState<RetirementSettingsRecord | null>(bootstrap.retirementPlan ?? null);
  useEffect(
    () => setRetirementSettings(bootstrap.retirementPlan ?? null),
    [bootstrap.retirementPlan],
  );
  const legacyRetirementPlan = retirementSettings
    ? {
        ...defaultRetirementPlan(
          Number(retirementSettings.retirementMonth.slice(0, 4)),
        ),
        householdId: retirementSettings.householdId,
        withdrawalRateBps: retirementSettings.withdrawalRateBps,
        revision: retirementSettings.revision,
      }
    : null;
  return (
    <div
      className={dark ? "app dark" : "app"}
      data-reduced-motion={settings.reducedMotion || undefined}
    >
      <aside>
        <div className="brand">
          <span className="brandmark">
            <Sparkles size={17} />
          </span>
          <span>LifeLook</span>
        </div>
        <nav aria-label="Primary navigation">
          {nav.map(([name, Icon, group], index) => (
            <div className="nav-item" key={name} data-group={group}>
              {(index === 0 || nav[index - 1][2] !== group) && (
                <span className="nav-group">{group}</span>
              )}
              <button
                className={view === name ? "active" : ""}
                aria-label={name}
                title={name}
                aria-current={view === name ? "page" : undefined}
                onClick={() => setView(name)}
              >
                <Icon size={18} />
                <span>{name}</span>
                {name === "Activity" && bootstrap.activity.length > 0 && (
                  <i>
                    {new Set(bootstrap.activity.map((x) => x.entryId)).size}
                  </i>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="aside-bottom">
          <button
            ref={profileButton}
            className="profile"
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen((open) => !open)}
          >
            <span>
              {bootstrap.people[0]?.name.slice(0, 2).toUpperCase() || "LL"}
            </span>
            <div>
              <strong>{bootstrap.people[0]?.name || "Local household"}</strong>
              <small>Local workspace</small>
            </div>
            <MoreHorizontal size={17} />
          </button>
          {profileOpen && (
            <div
              className="profile-menu card"
              role="menu"
              aria-label="Workspace"
              ref={profileMenu}
              onKeyDown={profileMenuKey}
            >
              <strong>
                {workspaceInfo?.householdName ??
                  bootstrap.household?.name ??
                  "Local household"}
              </strong>
              <small>Local workspace</small>
              <code>
                {workspaceInfo?.profilePath ?? "Loading profile path…"}
              </code>
              <button
                role="menuitem"
                onClick={() => {
                  setProfileOpen(false);
                  setView("Settings");
                }}
              >
                Open Settings
              </button>
              <button
                role="menuitem"
                disabled={profileBusy}
                onClick={backupFromProfile}
              >
                {profileBusy ? "Creating backup…" : "Create Backup"}
              </button>
              {profileResult && (
                <p
                  role={
                    profileResult.includes("successfully") ? "status" : "alert"
                  }
                  aria-live="polite"
                >
                  {profileResult}
                </p>
              )}
            </div>
          )}
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">{snapshot.household.name}</p>
            <h1>{view}</h1>
          </div>
          <div className="header-actions">
            <button
              ref={searchButton}
              className="icon"
              aria-label="Search workspace"
              title="Search workspace"
              onClick={() => setSearchInvoker(searchButton.current)}
            >
              <Search size={18} />
            </button>
            <button
              className="icon"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <AnchoredMenu
              primary
              label="Add"
              icon={<Plus size={17} />}
              items={[
                {
                  label: "Income",
                  group: "Transactions",
                  onSelect: (el) =>
                    openDialog({ type: "transaction", kind: "income" }, el),
                },
                {
                  label: "Expense",
                  group: "Transactions",
                  onSelect: (el) =>
                    openDialog({ type: "transaction", kind: "expense" }, el),
                },
                {
                  label: "Transfer",
                  group: "Transactions",
                  onSelect: (el) => openDialog({ type: "transfer" }, el),
                },
                {
                  label: "Account",
                  group: "Holdings",
                  onSelect: (el) => openDialog({ type: "account" }, el),
                },
                {
                  label: "Asset",
                  group: "Holdings",
                  onSelect: (el) => openDialog({ type: "asset" }, el),
                },
                {
                  label: "Debt",
                  group: "Holdings",
                  onSelect: (el) => openDialog({ type: "liability" }, el),
                },
              ]}
            />
          </div>
        </header>
        {view === "Overview" && (
          <Overview
            bootstrap={bootstrap}
            projections={projections}
            navigate={setView}
            onAdd={(kind, el) =>
              openDialog(
                kind === "transfer"
                  ? { type: "transfer" }
                  : { type: "transaction", kind },
                el,
              )
            }
          />
        )}
        {view === "Activity" && (
          <ActivityView
            activity={bootstrap.activity}
            accounts={bootstrap.accounts}
            repository={repository}
            revealEntryId={
              focusTarget?.kind === "Activity" ? focusTarget.id : null
            }
            preferenceKey={`lifelook:ui:v1:${bootstrap.household?.id ?? "local"}:activity-breakdown`}
            onAdd={(kind, el) =>
              openDialog(
                kind === "transfer"
                  ? { type: "transfer" }
                  : { type: "transaction", kind },
                el,
              )
            }
            onImport={(el) => openDialog({ type: "import" }, el)}
            onEdit={(entry, el) =>
              openDialog(
                {
                  type:
                    entry[0].kind === "transfer" ? "transfer" : "transaction",
                  entry,
                },
                el,
              )
            }
            onDelete={(entry, el) =>
              openDialog(
                {
                  type: entry[0].kind === "transfer" ? "transfer" : "transaction",
                  entry,
                  requestDelete: true,
                },
                el,
              )
            }
          />
        )}
        {view === "Plan" && projections && (
          <PlanView
            projections={projections}
            scenarios={scenarios}
            selectedScenarioId={selectedScenario.id}
            onSelectScenario={setSelectedScenarioId}
            excludedPropertyIds={excludedPropertyIds}
            onToggleProperty={(assetId,included)=>setExcludedPlannedProperties(current=>({...current,[selectedScenario.id]:included?(current[selectedScenario.id]??[]).filter(id=>id!==assetId):[...new Set([...(current[selectedScenario.id]??[]),assetId])]}))}
            snapshot={snapshot}
            expanded={expanded}
            setExpanded={setExpanded}
            recurring={bootstrap.recurring}
            categories={bootstrap.categories}
            accounts={bootstrap.accounts}
            onAddRecurring={(kind, el) =>
              openDialog({ type: "recurring", kind }, el)
            }
            onEditRecurring={(recurring, el) =>
              openDialog({ type: "recurring", recurring }, el)
            }
            onAddScenario={(el) =>
              openDialog(
                {
                  type: "scenario-create",
                  scenario: bootstrap.scenarios.find(
                    (s) => s.id === selectedScenario.id,
                  ),
                },
                el,
              )
            }
            onEditScenario={(el) =>
              openDialog(
                {
                  type: "scenario-edit",
                  scenario: bootstrap.scenarios.find(
                    (s) => s.id === selectedScenario.id,
                  ),
                },
                el,
              )
            }
            onPlanScenario={(el, focusedEntry) =>
              openDialog(
                {
                  type: "scenario-plan",
                  scenario: bootstrap.scenarios.find(
                    (s) => s.id === selectedScenario.id,
                  ),
                  focusedEntry,
                },
                el,
              )
            }
            onEditPlannedProperty={(eventId,el)=>openDialog({type:"scenario-plan",scenario:bootstrap.scenarios.find(s=>s.id===selectedScenario.id),focusedEventId:eventId},el)}
            onPlanCurrentHome={(kind,el)=>openDialog({type:"scenario-plan",scenario:bootstrap.scenarios.find(s=>s.id===selectedScenario.id),focusedEventType:kind},el)}
            selectedSeries={planSeries}
            onSelectSeries={setPlanSeries}
            range={planRange}
            onRange={setPlanRange}
            preferenceKey={`lifelook:ui:v1:${bootstrap.household?.id ?? "local"}:plan`}
          />
        )}
        {view === "Plan" && !projections && (
          <div className="content">
            <section className="card">
              <h2>Complete your tax profile</h2>
              <p>
                Projected plan values are hidden until a filing status and
                supported tax year are saved.
              </p>
              <button onClick={() => setView("Settings")}>Open Settings</button>
            </section>
          </div>
        )}
        <div hidden={view !== "Investment"}>
          <InvestmentView
            initial={bootstrap.investmentComparison}
            repository={repository}
            taxContext={investmentTaxContext}
            scenarios={scenarios}
            accounts={bootstrap.accounts}
            householdId={bootstrap.household?.id ?? "local"}
            onAddToPlan={async (assumptions, options) => {
              const record = bootstrap.scenarios.find(
                (s) => s.id === options.scenarioId,
              );
              if (!record || !repository.updateScenario) return;
              const assetId = `investment-${Date.now()}`,
                principal = Math.round(
                  assumptions.homePriceCents *
                    (1 - assumptions.downPaymentBps / 10000),
                ),
                monthlyRate = assumptions.mortgageRateBps / 10000 / 12,
                months = assumptions.mortgageTermYears * 12,
                payment = Math.round(
                  monthlyRate
                    ? (principal *
                        monthlyRate *
                        Math.pow(1 + monthlyRate, months)) /
                        (Math.pow(1 + monthlyRate, months) - 1)
                    : principal / months,
                ),
                fundingSources = options.fundingAccountIds.map((accountId) => ({
                  accountId,
                }));
              const purchase: import("./domain").ScenarioEvent = {
                id: `buy-${assetId}`,
                date: options.date,
                type: "asset-purchase",
                assetId,
                name: "Investment home",
                valueCents: assumptions.homePriceCents,
                annualGrowthBps: assumptions.homeAppreciationBps,
                fundingAccountId: options.fundingAccountIds[0],
                fundingSources,
                downPaymentCents: Math.round(
                  (assumptions.homePriceCents * assumptions.downPaymentBps) /
                    10000,
                ),
                costsCents: Math.round(
                  (assumptions.homePriceCents * assumptions.purchaseCostBps) /
                    10000,
                ),
                monthlyRentalIncomeCents: assumptions.monthlyRentalIncomeCents,
                rentalIncomeGrowthBps: assumptions.rentalIncomeGrowthBps,
                maintenanceBps: assumptions.maintenanceBps,
                housingCosts: {
                  propertyTaxRateBps: assumptions.propertyTaxBps,
                  insuranceMonthlyCents: Math.round(
                    assumptions.annualInsuranceCents / 12,
                  ),
                  insuranceAnnualGrowthBps: assumptions.insuranceGrowthBps,
                  hoaMonthlyCents: assumptions.monthlyHoaCents,
                  hoaAnnualGrowthBps: assumptions.hoaGrowthBps,
                },
                financing: {
                  liabilityId: `loan-${assetId}`,
                  name: "Investment mortgage",
                  principalCents: principal,
                  annualRateBps: assumptions.mortgageRateBps,
                  minimumPaymentCents: payment,
                  termMonths: months,
                },
                propertyDetails: {
                  mortgageTermMonths: months,
                  maintenanceBps: assumptions.maintenanceBps,
                  monthlyRentalIncomeCents: assumptions.monthlyRentalIncomeCents,
                  rentalIncomeGrowthBps: assumptions.rentalIncomeGrowthBps,
                  primaryResidence: assumptions.primaryResidence,
                  rentalUseBps: assumptions.rentalUseBps,
                  rentalTaxModelingEnabled: assumptions.factorRentalTaxes,
                  rentalType: assumptions.rentalType,
                  propertyTaxBasisCents: assumptions.propertyTaxBasisOverrideCents,
                  buildingBasisCents: assumptions.buildingBasisOverrideCents,
                  mfsLivedApartAllYear: assumptions.mfsLivedApartAllYear,
                  shortTermMaterialParticipation: assumptions.shortTermMaterialParticipation,
                  longTermRealEstateProfessional: assumptions.longTermRealEstateProfessional,
                  longTermMaterialParticipation: assumptions.longTermMaterialParticipation,
                  adu: { planned: options.includeAdu && assumptions.aduPlanned, costCents: assumptions.aduBuildCostCents, homeSquareFeet: assumptions.homeSquareFeet, squareFeet: assumptions.aduSquareFeet, monthlyRentalIncomeCents: assumptions.aduMonthlyRentCents, rentalIncomeGrowthBps: assumptions.rentalIncomeGrowthBps },
                },
              };
              const events = [...record.events, purchase];
              if (options.includeAdu && assumptions.aduPlanned) {
                const date = new Date(`${options.date}T00:00:00Z`);
                date.setUTCFullYear(
                  date.getUTCFullYear() +
                    Math.max(0, assumptions.aduBuildYear - 1),
                );
                events.push({
                  id: `adu-${assetId}`,
                  date: date.toISOString().slice(0, 10),
                  type: "adu-build",
                  assetId,
                  name: "Build ADU",
                  costCents: assumptions.aduBuildCostCents,
                  homeSquareFeet: assumptions.homeSquareFeet,
                  aduSquareFeet: assumptions.aduSquareFeet,
                  monthlyRentalIncomeCents: assumptions.aduMonthlyRentCents,
                  rentalIncomeGrowthBps: assumptions.rentalIncomeGrowthBps,
                  fundingAccountId: options.fundingAccountIds[0],
                  fundingSources,
                });
              }
              await repository.updateScenario({
                id: record.id,
                name: record.name,
                assumptions: record.assumptions,
                horizonMonths: record.horizonMonths,
                events,
                defaultContributionAccountId:
                  record.defaultContributionAccountId,
                contributions: record.contributions,
                withdrawals: record.withdrawals,
                expectedRevision: record.revision,
              });
              await onRefresh();
              setSelectedScenarioId(record.id);
              setView("Plan");
            }}
          />
        </div>
        {view === "Retirement" && (
          <RetirementView
            initial={legacyRetirementPlan}
            repository={repository}
            bootstrap={bootstrap}
            snapshot={snapshot}
            scenarios={[projectedScenario]}
            projections={retirementProjections}
            onPlanChange={(plan) =>
              setRetirementSettings((settings) => ({
                householdId: settings?.householdId ?? bootstrap.household?.id ?? "",
                retirementMonth: `${plan.retirementYear}-01`,
                withdrawalRateBps: plan.withdrawalRateBps,
                revision: plan.revision,
              }))
            }
          />
        )}
        {view === "Net Worth" && (
          <NetWorth
            snapshot={snapshot}
            accounts={bootstrap.accounts}
            assets={bootstrap.assets}
            liabilities={bootstrap.liabilities}
            onAdd={(el) => openDialog({ type: "account" }, el)}
            onEdit={(account, el) =>
              openDialog({ type: "account", account }, el)
            }
            onDelete={(account, el) =>
              openDialog({ type: "account", account, requestDelete: true }, el)
            }
            onReconcile={(account, el) =>
              openDialog({ type: "reconcile", account }, el)
            }
            onAddAsset={(el) => openDialog({ type: "asset" }, el)}
            onAddLiability={(el) => openDialog({ type: "liability" }, el)}
            onEditAsset={(asset, el) =>
              openDialog(
                {
                  type: "asset",
                  asset,
                  linkedLiability: bootstrap.liabilities.find(
                    (liability) => liability.mortgage?.assetId === asset.id,
                  ),
                },
                el,
              )
            }
            onDeleteAsset={(asset, el) =>
              openDialog(
                {
                  type: "asset",
                  asset,
                  linkedLiability: bootstrap.liabilities.find(
                    (liability) => liability.mortgage?.assetId === asset.id,
                  ),
                  requestDelete: true,
                },
                el,
              )
            }
            onEditLiability={(liability, el) =>
              openDialog({ type: "liability", liability }, el)
            }
            onDeleteLiability={(liability, el) =>
              openDialog(
                { type: "liability", liability, requestDelete: true },
                el,
              )
            }
          />
        )}
        {view === "Settings" && (
          <SettingsView
            settings={settings}
            setSettings={setSettings}
            bootstrap={bootstrap}
            repository={repository}
            onSaved={onRefresh}
            onRestore={onRestore}
          />
        )}
      </main>
      {searchInvoker && (
        <GlobalSearch
          index={searchIndex}
          invoker={searchInvoker}
          onClose={() => setSearchInvoker(null)}
          onActivate={activateSearch}
        />
      )}
      {dialog?.type === "recurring" ? (
        <RecurringDialog
          state={dialog}
          bootstrap={bootstrap}
          repository={repository}
          close={closeDialog}
          refresh={onRefresh}
        />
      ) : dialog?.type === "scenario-create" ||
        dialog?.type === "scenario-edit" ? (
        <ScenarioDialog
          state={dialog}
          scenarios={bootstrap.scenarios}
          repository={repository}
          close={closeDialog}
          refresh={onRefresh}
          select={setSelectedScenarioId}
        />
      ) : dialog?.type === "scenario-plan" && dialog.scenario ? (
        <ScenarioPlanningDialog
          record={dialog.scenario}
          bootstrap={bootstrap}
          projectedMonthlySurplusCents={projectedMonthlySurplusCents}
          repository={repository}
          close={closeDialog}
          refresh={onRefresh}
          focusedEntry={dialog.focusedEntry}
          focusedEventId={dialog.focusedEventId}
          focusedEventType={dialog.focusedEventType}
        />
      ) : dialog?.type === "import" ? (
        <CsvImportWizard
          bootstrap={bootstrap}
          repository={repository}
          close={closeDialog}
          refresh={onRefresh}
          invoker={dialog.invoker}
        />
      ) : dialog?.type === "asset" || dialog?.type === "liability" ? (
        <FinancialRecordDialog
          state={dialog}
          repository={repository}
          close={closeDialog}
          refresh={onRefresh}
        />
      ) : (
        dialog && (
          <EntryDialog
            key={`${dialog.type}-${dialog.kind ?? ""}-${dialog.entry?.[0]?.entryId ?? dialog.account?.id ?? "new"}`}
            state={dialog}
            bootstrap={bootstrap}
            repository={repository}
            close={closeDialog}
            refresh={onRefresh}
            open={(state) => setDialog({ ...state, invoker: dialog.invoker })}
          />
        )
      )}
    </div>
  );
}

type DialogState = {
  type:
    | "chooser"
    | "transaction"
    | "transfer"
    | "account"
    | "reconcile"
    | "import"
    | "asset"
    | "liability"
    | "recurring"
    | "scenario-create"
    | "scenario-edit"
    | "scenario-plan";
  kind?: "income" | "expense";
  entry?: ActivityPosting[];
  account?: BootstrapAccount;
  asset?: Asset;
  liability?: Liability;
  linkedLiability?: Liability;
  requestDelete?: boolean;
  recurring?: RecurringEntry;
  scenario?: ScenarioRecord;
  focusedEntry?: "event" | "contribution";
  focusedEventId?: string;
  focusedEventType?: import("./domain").ScenarioEvent["type"];
  invoker?: HTMLElement | null;
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function EntryDialog({
  state,
  bootstrap,
  repository,
  close,
  refresh,
  open,
}: {
  state: DialogState;
  bootstrap: Bootstrap;
  repository: Repository;
  close: () => void;
  refresh: () => void;
  open: (s: DialogState) => void;
}) {
  const modal = useRef<HTMLElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null),
    noticeRef = useRef<HTMLDivElement>(null),
    confirmRef = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false),
    [blockers, setBlockers] = useState<string[]>([]);
  const entry = state.entry?.[0],
    isTransfer = state.type === "transfer",
    isAccount = state.type === "account",
    isReconcile = state.type === "reconcile";
  const transferRows = state.entry ?? [];
  const debit = transferRows.find((x) => x.amountCents < 0),
    credit = transferRows.find((x) => x.amountCents > 0);
  const [kind, setKind] = useState<"income" | "expense">(
    state.kind ?? (entry?.kind === "income" ? "income" : "expense"),
  );
  const [date, setDate] = useState(entry?.occurredOn ?? today()),
    [amount, setAmount] = useState(
      entry ? String(Math.abs(entry.amountCents) / 100) : "",
    ),
    [accountId, setAccountId] = useState(
      entry?.accountId ?? bootstrap.accounts[0]?.id ?? "",
    ),
    [categoryId, setCategoryId] = useState(entry?.categoryId ?? ""),
    [description, setDescription] = useState(entry?.description ?? ""),
    [note, setNote] = useState(entry?.note ?? "");
  const [from, setFrom] = useState(
      debit?.accountId ?? bootstrap.accounts[0]?.id ?? "",
    ),
    [to, setTo] = useState(
      credit?.accountId ?? bootstrap.accounts[1]?.id ?? "",
    );
  const [name, setName] = useState(state.account?.name ?? ""),
    [accountKind, setAccountKind] = useState<AccountKind>(
      state.account?.kind ?? "checking",
    ),
    [balance, setBalance] = useState(
      state.account ? String(Math.abs(state.account.balanceCents) / 100) : "",
    ),
    [annualReturn, setAnnualReturn] = useState(
      String((state.account?.annualReturnBps ?? 0) / 100),
    ),[ownerPersonId,setOwnerPersonId]=useState(state.account?.ownerPersonId??""),[accountSubtype,setAccountSubtype]=useState(state.account?.subtype??(state.account?.kind==="retirement"?"traditional-ira":state.account?.kind==="investment"?"taxable-brokerage":"cash")),[taxableBasis,setTaxableBasis]=useState(state.account?.taxableCostBasisCents==null?"":String(state.account.taxableCostBasisCents/100)),[rothBasis,setRothBasis]=useState(state.account?.rothContributionBasisCents==null?"":String(state.account.rothContributionBasisCents/100)),[rothOpeningYear,setRothOpeningYear]=useState(state.account?.rothOpeningYear==null?"":String(state.account.rothOpeningYear));
  const categories = bootstrap.categories.filter((c) => c.kind === kind);
  useEffect(() => {
    if (!categories.some((c) => c.id === categoryId))
      setCategoryId(categories[0]?.id ?? "");
  }, [kind, bootstrap.categories]);
  useEffect(() => {
    const node = modal.current;
    const initial = node?.querySelector<HTMLElement>(
      "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])",
    );
    initial?.focus();
    return () => state.invoker?.focus();
  }, []);
  useEffect(() => {
    if (error) queueMicrotask(() => errorRef.current?.focus());
  }, [error]);
  useEffect(() => {
    if (blockers.length) queueMicrotask(() => noticeRef.current?.focus());
  }, [blockers]);
  useEffect(() => {
    if (confirmDelete) queueMicrotask(() => confirmRef.current?.focus());
  }, [confirmDelete]);
  function keyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      close();
    }
    if (e.key === "Tab" && modal.current) {
      const f = [
        ...modal.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])",
        ),
      ];
      if (!f.length) return;
      const first = f[0],
        last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const cents = parseMoney(amount);
    if (
      (state.type === "transaction" || isTransfer) &&
      (cents === undefined || cents <= 0)
    ) {
      setError(
        "Enter a positive USD amount with no more than two decimal places.",
      );
      return;
    }
    if (!isAccount && !isReconcile && !date) {
      setError("Choose a valid date.");
      return;
    }
    if (isTransfer && from === to) {
      setError("Choose two different accounts for a transfer.");
      return;
    }
    if (state.type === "transaction" && !description.trim()) {
      setError("Description is required.");
      return;
    }
    setBusy(true);
    try {
      if (state.type === "transaction") {
        const input = {
          id: entry?.entryId ?? crypto.randomUUID(),
          occurredOn: date,
          accountId,
          categoryId,
          amountCents: cents!,
          description: description.trim(),
          note: note.trim() || null,
        };
        if (entry)
          await repository.updateTransaction?.({
            ...input,
            expectedRevision: entry.revision,
          });
        else await repository.createTransaction?.(input);
      } else if (state.type === "transfer") {
        const input = {
          id: entry?.entryId ?? crypto.randomUUID(),
          occurredOn: date,
          fromAccountId: from,
          toAccountId: to,
          amountCents: cents!,
        };
        if (entry)
          await repository.updateTransfer?.({
            ...input,
            expectedRevision: entry.revision,
          });
        else await repository.createTransfer?.(input);
      } else if (state.type === "account") {
        if (!name.trim()) throw { message: "Account name is required." };
        const annualReturnBps = parsePercent(annualReturn);
        if (
          annualReturnBps === undefined ||
          annualReturnBps < -10_000 ||
          annualReturnBps > 100_000
        )
          throw {
            message: "Enter an annual return between -100% and 1,000%.",
          };
        if (state.account)
          await repository.updateAccount?.({
            id: state.account.id,
            name: name.trim(),
            kind: accountKind,
            annualReturnBps,
            ownerPersonId:ownerPersonId||null,subtype:accountSubtype as import("./domain/types").AccountSubtype,taxableCostBasisCents:taxableBasis?parseMoney(taxableBasis):null,rothContributionBasisCents:rothBasis?parseMoney(rothBasis):null,rothOpeningYear:rothOpeningYear?+rothOpeningYear:null,
            expectedRevision: state.account.revision,
          });
        else {
          const opening = parseMoney(balance);
          if (opening === undefined)
            throw { message: "Enter an exact USD opening balance." };
          await repository.createAccount?.({
            id: crypto.randomUUID(),
            name: name.trim(),
            kind: accountKind,
            openingBalanceCents:
              accountKind === "credit" ? Math.abs(opening) : opening,
            annualReturnBps,
            ownerPersonId:ownerPersonId||null,subtype:accountSubtype as import("./domain/types").AccountSubtype,taxableCostBasisCents:taxableBasis?parseMoney(taxableBasis):null,rothContributionBasisCents:rothBasis?parseMoney(rothBasis):null,rothOpeningYear:rothOpeningYear?+rothOpeningYear:null,
          });
        }
      } else if (state.type === "reconcile") {
        const target = parseMoney(balance);
        if (target === undefined)
          throw { message: "Enter an exact USD current balance." };
        await repository.reconcileAccount?.({
          id: state.account!.id,
          occurredOn: date,
          targetBalanceCents:
            state.account!.kind === "credit" ? -Math.abs(target) : target,
          expectedBalanceCents: state.account!.balanceCents,
        });
      }
      await Promise.resolve(refresh());
      close();
    } catch (x) {
      setError(errorMessage(x, "Could not save your changes."));
    } finally {
      setBusy(false);
    }
  }
  async function beginDelete() {
    setError("");
    setBlockers([]);
    if (isAccount) {
      setBusy(true);
      try {
        const impact = await repository.accountDeletionImpact?.(
          state.account!.id,
        );
        if (impact) setBlockers(impact.blockers);
        setConfirmDelete(true);
      } catch (x) {
        setError(errorMessage(x, "Could not check this account."));
      } finally {
        setBusy(false);
      }
    } else setConfirmDelete(true);
  }
  useEffect(() => {
    if (state.requestDelete) void beginDelete();
  }, []);
  async function remove() {
    setBusy(true);
    setError("");
    try {
      if (isAccount)
        await repository.deleteAccount?.({
          id: state.account!.id,
          expectedRevision: state.account!.revision,
        });
      else
        await repository.deleteTransaction?.({
          id: entry!.entryId,
          expectedRevision: entry!.revision,
        });
      await Promise.resolve(refresh());
      close();
    } catch (x) {
      setError(errorMessage(x, "Could not delete this record."));
    } finally {
      setBusy(false);
    }
  }
  if (state.type === "chooser")
    return (
      <div
        className="modal-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <section
          ref={modal}
          className="card modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-title"
          onKeyDown={keyDown}
        >
          <h2 id="add-title">What would you like to add?</h2>
          <div className="add-choices">
            <button
              onClick={() => open({ type: "transaction", kind: "income" })}
            >
              Income
            </button>
            <button
              onClick={() => open({ type: "transaction", kind: "expense" })}
            >
              Expense
            </button>
            <button onClick={() => open({ type: "transfer" })}>Transfer</button>
            <button onClick={() => open({ type: "account" })}>Account</button>
            <button onClick={() => open({ type: "asset" })}>Asset</button>
            <button onClick={() => open({ type: "liability" })}>Debt</button>
          </div>
          <div className="actions">
            <button onClick={close}>Cancel</button>
          </div>
        </section>
      </div>
    );
  const title = isTransfer
    ? entry
      ? "Edit transfer"
      : "Add transfer"
    : isAccount
      ? state.account
        ? "Edit account"
        : "Add account"
      : isReconcile
        ? `Reconcile ${state.account?.name}`
        : entry
          ? "Edit transaction"
          : `Add ${kind}`;
  return (
    <div className="modal-backdrop">
      <section
        ref={modal}
        className="card modal entry-modal"
        role={confirmDelete ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="entry-title"
        onKeyDown={keyDown}
      >
        <h2
          id="entry-title"
          ref={confirmRef}
          tabIndex={confirmDelete ? -1 : undefined}
        >
          {confirmDelete
            ? `Delete ${isAccount ? "account" : "transaction"}?`
            : title}
        </h2>
        {entry?.origin === "import" && !confirmDelete && (
          <p className="muted">
            Imported transactions are read-only for editing, but you can delete
            this transaction individually. Its import-batch audit record will
            remain.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        {blockers.length > 0 && (
          <div tabIndex={-1} ref={noticeRef}>
            <p>Deleting this account will also:</p>
            <ul>
              {blockers.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        {confirmDelete ? (
          <>
            <p>
              This permanently removes{" "}
              {isAccount
                ? state.account?.name
                : entry?.description || "this entry"}
              .{" "}
              {isAccount
                ? "The related records listed above will be removed or disconnected."
                : "Financial history is never cascaded."}
            </p>
            <div className="actions">
              <button disabled={busy} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="danger" disabled={busy} onClick={remove}>
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={entry?.origin === "import"}>
              {state.type === "transaction" && (
                <>
                  <label>
                    Type
                    <select
                      value={kind}
                      onChange={(e) =>
                        setKind(e.target.value as "income" | "expense")
                      }
                    >
                      <option value="income">Income</option>
                      <option value="expense">Expense</option>
                    </select>
                  </label>
                  <label>
                    Date
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Amount (USD)
                    <input
                      inputMode="decimal"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label>
                    Account
                    <select
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      {bootstrap.accounts.map((a) => (
                        <option value={a.id} key={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select
                      value={categoryId}
                      required
                      onChange={(e) => setCategoryId(e.target.value)}
                    >
                      {categories.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Description
                    <input
                      required
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                  <label>
                    Note <span className="optional">optional</span>
                    <textarea
                      value={note ?? ""}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                </>
              )}
              {isTransfer && (
                <>
                  <label>
                    Date
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Amount (USD)
                    <input
                      inputMode="decimal"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label>
                    From account
                    <select
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    >
                      {bootstrap.accounts.map((a) => (
                        <option value={a.id} key={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    To account
                    <select value={to} onChange={(e) => setTo(e.target.value)}>
                      {bootstrap.accounts.map((a) => (
                        <option value={a.id} key={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {isAccount && (
                <>
                  <label>
                    Account name
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Account type
                    <select
                      value={accountKind}
                      onChange={(e) =>
                        setAccountKind(e.target.value as AccountKind)
                      }
                    >
                      {accountKinds.map((k) => (
                        <option value={k.value} key={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!state.account && (
                    <label>
                      {accountKind === "credit"
                        ? "Amount owed (USD)"
                        : "Opening balance (USD)"}
                      <input
                        inputMode="decimal"
                        required
                        value={balance}
                        onChange={(e) => setBalance(e.target.value)}
                      />
                    </label>
                  )}
                  <label>
                    Annual return (%)
                    <input
                      inputMode="decimal"
                      required
                      value={annualReturn}
                      onChange={(e) => setAnnualReturn(e.target.value)}
                    />
                  </label>
                  <label>Owner<select value={ownerPersonId} onChange={e=>setOwnerPersonId(e.target.value)}><option value="">Select owner</option>{bootstrap.people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                  <label>Tax subtype<select value={accountSubtype} onChange={e=>setAccountSubtype(e.target.value as typeof accountSubtype)}><option value="cash">Cash</option><option value="taxable-brokerage">Taxable brokerage</option><option value="traditional-ira">Traditional IRA</option><option value="employer-pre-tax">Employer pre-tax</option><option value="roth-ira">Roth IRA</option><option value="employer-roth">Employer Roth</option></select></label>
                  {accountSubtype==="taxable-brokerage"&&<label>Taxable cost basis (USD)<input inputMode="decimal" value={taxableBasis} onChange={e=>setTaxableBasis(e.target.value)}/></label>}
                  {(accountSubtype==="roth-ira"||accountSubtype==="employer-roth")&&<><label>Roth contribution basis (USD)<input inputMode="decimal" value={rothBasis} onChange={e=>setRothBasis(e.target.value)}/></label><label>Roth opening year<input type="number" min="1900" max="2500" value={rothOpeningYear} onChange={e=>setRothOpeningYear(e.target.value)}/></label></>}
                </>
              )}
              {isReconcile && (
                <>
                  <p className="muted">
                    Current recorded balance:{" "}
                    {money(
                      state.account!.kind === "credit"
                        ? -state.account!.balanceCents
                        : state.account!.balanceCents,
                    )}
                  </p>
                  <label>
                    Date
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label>
                    {state.account!.kind === "credit"
                      ? "Target amount owed (USD)"
                      : "Target current balance (USD)"}
                    <input
                      inputMode="decimal"
                      required
                      value={balance}
                      onChange={(e) => setBalance(e.target.value)}
                    />
                  </label>
                </>
              )}
            </fieldset>
            <div className="actions">
              {(entry?.canDelete || (isAccount && state.account)) && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={beginDelete}
                >
                  Delete
                </button>
              )}
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              {entry?.origin !== "import" && (
                <button className="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function FinancialRecordDialog({
  state,
  repository,
  close,
  refresh,
}: {
  state: DialogState;
  repository: Repository;
  close: () => void;
  refresh: () => void;
}) {
  const modal = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isAsset = state.type === "asset";
  const record = isAsset ? state.asset : state.liability;
  const liability = state.liability;
  const linkedMortgage =
    state.linkedLiability ??
    (!isAsset && liability?.mortgage?.assetId ? liability : undefined);
  const existingAssetIsHome = Boolean(
    state.asset &&
      (state.asset.purchasePriceCents != null ||
        state.asset.purchaseDate != null ||
        state.asset.homeSaleAssumptions != null ||
        linkedMortgage ||
        (state.asset.housingCosts &&
          (state.asset.housingCosts.propertyTaxRateBps !== 0 ||
            state.asset.housingCosts.insuranceMonthlyCents !== 0 ||
            state.asset.housingCosts.hoaMonthlyCents !== 0))),
  );
  const [name, setName] = useState(record?.name ?? "");
  const [value, setValue] = useState("0");
  useEffect(() => {
    const cents = isAsset ? state.asset?.valueCents : liability?.balanceCents;
    if (cents != null) setValue(String(cents / 100));
  }, []);
  const [rate, setRate] = useState(
    String(
      ((isAsset ? state.asset?.annualGrowthBps : liability?.annualRateBps) ??
        0) / 100,
    ),
  );
  const [advancedGrowth, setAdvancedGrowth] = useState(
    Boolean(isAsset && state.asset?.appreciationCurve),
  );
  const [growthStartYear, setGrowthStartYear] = useState(
    String(
      state.asset?.appreciationCurve?.startYear ?? new Date().getFullYear(),
    ),
  );
  const [growthStartRate, setGrowthStartRate] = useState(
    String(
      (state.asset?.appreciationCurve?.startRateBps ??
        state.asset?.annualGrowthBps ??
        0) / 100,
    ),
  );
  const [growthEndYear, setGrowthEndYear] = useState(
    String(
      state.asset?.appreciationCurve?.endYear ?? new Date().getFullYear() + 10,
    ),
  );
  const [growthEndRate, setGrowthEndRate] = useState(
    String(
      (state.asset?.appreciationCurve?.endRateBps ??
        state.asset?.annualGrowthBps ??
        0) / 100,
    ),
  );
  const [home, setHome] = useState(
    existingAssetIsHome,
  );
  const [privateStock, setPrivateStock] = useState(
    Boolean(state.asset?.privateStock),
  );
  const equityHolding = state.asset?.equityHolding ?? null;
  const [vestedPercent, setVestedPercent] = useState(
    String((state.asset?.privateStock?.vestedBps ?? 2500) / 100),
  );
  const [vestingStartDate, setVestingStartDate] = useState(
    state.asset?.privateStock?.vestingStartDate ?? today(),
  );
  const [remainingVestingYears, setRemainingVestingYears] = useState(
    String((state.asset?.privateStock?.remainingVestingQuarters ?? 16) / 4),
  );
  const [taxOnVest, setTaxOnVest] = useState(
    state.asset?.privateStock?.taxOnVest ?? false,
  );
  const [purchasePrice, setPurchasePrice] = useState(
    state.asset?.purchasePriceCents == null
      ? state.asset
        ? ""
        : "0"
      : String(state.asset.purchasePriceCents / 100),
  );
  const [financed, setFinanced] = useState(true);
  const [purchaseDate, setPurchaseDate] = useState(
    state.asset?.purchaseDate ?? (state.asset ? "" : today()),
  );
  const [sellingCosts, setSellingCosts] = useState(
    state.asset?.homeSaleAssumptions
      ? String(state.asset.homeSaleAssumptions.sellingCostBps / 100)
      : state.asset
        ? ""
        : "6",
  );
  const [primaryResidenceExclusionEligible, setPrimaryResidenceExclusionEligible] =
    useState(
      state.asset?.homeSaleAssumptions
        ?.primaryResidenceExclusionEligible ?? false,
    );
  const [federalDepreciation, setFederalDepreciation] = useState(
    String(
      (state.asset?.homeSaleAssumptions
        ?.accumulatedFederalDepreciationCents ?? 0) / 100,
    ),
  );
  const [californiaDepreciation, setCaliforniaDepreciation] = useState(
    String(
      (state.asset?.homeSaleAssumptions
        ?.accumulatedCaliforniaDepreciationCents ?? 0) / 100,
    ),
  );
  const [downPayment, setDownPayment] = useState("20");
  const [loanRate, setLoanRate] = useState("6.5");
  const [propertyTax, setPropertyTax] = useState("1.25");
  const [insuranceAnnual, setInsuranceAnnual] = useState("0");
  const [minimumPayment, setMinimumPayment] = useState(
    String((liability?.minimumPaymentCents ?? 0) / 100),
  );
  const [mortgage, setMortgage] = useState(Boolean(liability?.mortgage));
  const [principal, setPrincipal] = useState(
    String((liability?.mortgage?.originalPrincipalCents ?? 0) / 100),
  );
  const [term, setTerm] = useState(
    String(liability?.mortgage?.termMonths ?? 360),
  );
  const [startDate, setStartDate] = useState(
    liability?.mortgage?.startDate ?? today(),
  );
  const [overridePayment, setOverridePayment] = useState(
    liability?.mortgage?.paymentOverrideCents != null,
  );
  const [paymentOverride, setPaymentOverride] = useState(
    String((liability?.mortgage?.paymentOverrideCents ?? 0) / 100),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(
    Boolean(state.requestDelete),
  );
  useEffect(() => {
    modal.current?.querySelector<HTMLElement>("button,input,select")?.focus();
    return () => state.invoker?.focus();
  }, []);
  useEffect(() => {
    if (error) queueMicrotask(() => errorRef.current?.focus());
  }, [error]);
  useEffect(() => {
    if (confirmDelete) queueMicrotask(() => headingRef.current?.focus());
  }, [confirmDelete]);
  const principalCents = parseMoney(principal);
  const rateBps = parsePercent(rate);
  const termMonths = /^\d+$/.test(term) ? Number(term) : undefined;
  const calculatedPayment =
    principalCents && rateBps != null && termMonths && termMonths <= 480
      ? mortgagePayment(principalCents, rateBps, termMonths)
      : undefined;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const cents = parseMoney(value);
    const bps = parsePercent(rate);
    let appreciationCurve = null;
    if (isAsset && advancedGrowth) {
      const startYear = Number(growthStartYear),
        endYear = Number(growthEndYear);
      const startRateBps = parsePercent(growthStartRate),
        endRateBps = parsePercent(growthEndRate);
      if (
        !Number.isInteger(startYear) ||
        !Number.isInteger(endYear) ||
        endYear <= startYear ||
        startYear < 1900 ||
        endYear > 2500 ||
        startRateBps == null ||
        endRateBps == null ||
        startRateBps < -10000 ||
        endRateBps < -10000 ||
        startRateBps > 100000 ||
        endRateBps > 100000
      )
        return setError(
          "Enter valid appreciation years and rates; the ending year must be after the starting year.",
        );
      appreciationCurve = { startYear, startRateBps, endYear, endRateBps };
    }
    let privateStockTerms = null;
    if (isAsset && privateStock) {
      const vestedBps = parsePercent(vestedPercent),
        years = Number(remainingVestingYears),
        remainingVestingQuarters = Math.round(years * 4);
      if (
        vestedBps == null ||
        vestedBps < 0 ||
        vestedBps > 10000 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(vestingStartDate) ||
        !Number.isFinite(years) ||
        years <= 0 ||
        remainingVestingQuarters < 1 ||
        Math.abs(years * 4 - remainingVestingQuarters) > 1e-9
      )
        return setError(
          "Enter a vested percentage from 0–100 and a remaining vesting term in quarter-year increments.",
        );
      privateStockTerms = {
        vestedBps,
        vestingStartDate,
        remainingVestingQuarters,
        taxOnVest,
      };
    }
    if (!name.trim())
      return setError(`${isAsset ? "Asset" : "Debt"} name is required.`);
    if (cents == null || cents < 0)
      return setError("Enter an exact non-negative USD value.");
    if (bps == null || bps < (isAsset ? -10_000 : 0) || bps > 100_000)
      return setError(
        `Enter an annual ${isAsset ? "growth" : "interest"} rate within the supported range.`,
      );
    let homeSaleAssumptions:
      | import("./domain/types").HomeSaleAssumptions
      | undefined;
    if (isAsset && home) {
      const sellingCostBps = sellingCosts.trim()
          ? parsePercent(sellingCosts)
          : undefined,
        accumulatedFederalDepreciationCents = parseMoney(federalDepreciation),
        accumulatedCaliforniaDepreciationCents = parseMoney(
          californiaDepreciation,
        );
      if (
        accumulatedFederalDepreciationCents == null ||
        accumulatedCaliforniaDepreciationCents == null ||
        accumulatedFederalDepreciationCents < 0 ||
        accumulatedCaliforniaDepreciationCents < 0
      )
        return setError(
          "Enter exact non-negative accumulated depreciation amounts.",
        );
      if (
        sellingCosts.trim() &&
        (sellingCostBps == null || sellingCostBps < 0 || sellingCostBps > 10_000)
      )
        return setError("Enter selling costs from 0–100 percent.");
      if (
        state.asset?.rentalTaxBasisCents != null &&
        accumulatedCaliforniaDepreciationCents >
          state.asset.rentalTaxBasisCents
      )
        return setError(
          "California depreciation cannot exceed the home's tax basis.",
        );
      if (sellingCostBps != null)
        homeSaleAssumptions = {
          sellingCostBps,
          primaryResidenceExclusionEligible,
          accumulatedFederalDepreciationCents,
          accumulatedCaliforniaDepreciationCents,
        };
    }
    setBusy(true);
    try {
      if (isAsset) {
        if (!state.asset && home) {
          const purchasePriceCents = parseMoney(purchasePrice);
          const downPaymentBps = parsePercent(downPayment);
          const propertyTaxRateBps = parsePercent(propertyTax);
          const insuranceAnnualCents = parseMoney(insuranceAnnual);
          const loanRateBps = parsePercent(loanRate);
          const months = /^\d+$/.test(term) ? Number(term) : 0;
          if (!purchasePriceCents || purchasePriceCents < 0)
            throw { message: "Enter the original home purchase price." };
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) ||
            purchaseDate > today()
          )
            throw {
              message: "Enter a purchase date that is not in the future.",
            };
          if (
            propertyTaxRateBps == null ||
            propertyTaxRateBps < 0 ||
            insuranceAnnualCents == null ||
            insuranceAnnualCents < 0
          )
            throw {
              message: "Enter valid property tax and annual insurance amounts.",
            };
          if (
            financed &&
            (downPaymentBps == null ||
              downPaymentBps < 0 ||
              downPaymentBps > 10000 ||
              loanRateBps == null ||
              loanRateBps < 0 ||
              months < 1 ||
              months > 480)
          )
            throw {
              message:
                "Enter valid down payment, interest rate, and a term from 1 to 480 months.",
            };
          await repository.createHome?.({
            assetId: crypto.randomUUID(),
            liabilityId: financed ? crypto.randomUUID() : null,
            name: name.trim(),
            purchasePriceCents,
            currentValueCents: cents,
            annualGrowthBps: bps,
            appreciationCurve,
            purchaseDate,
            homeSaleAssumptions,
            propertyTaxRateBps,
            insuranceAnnualCents,
            financed,
            downPaymentBps: financed ? downPaymentBps : undefined,
            termMonths: financed ? months : undefined,
            annualRateBps: financed ? loanRateBps : undefined,
            asOfDate: today(),
          });
          await Promise.resolve(refresh());
          close();
          return;
        }
        const acquisitionData: Pick<
          AssetInput,
          "purchasePriceCents" | "purchaseDate"
        > = {};
        if (home && state.asset) {
          if (state.asset.purchasePriceCents == null) {
            const purchasePriceCents = parseMoney(purchasePrice);
            if (!purchasePriceCents || purchasePriceCents < 0)
              throw { message: "Enter the home's tax basis." };
            acquisitionData.purchasePriceCents = purchasePriceCents;
          }
          if (state.asset.purchaseDate == null) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate))
              throw { message: "Enter the home's purchase date." };
            acquisitionData.purchaseDate = purchaseDate;
          }
        }
        const input = {
          id: state.asset?.id ?? crypto.randomUUID(),
          name: name.trim(),
          valueCents: cents,
          annualGrowthBps: bps,
          appreciationCurve,
          privateStock: privateStockTerms,
          equityHolding,
          housingCosts: state.asset?.housingCosts,
          taxableCostBasisCents: state.asset?.taxableCostBasisCents,
          rentalTaxBasisCents: state.asset?.rentalTaxBasisCents,
          rentalBuildingBasisCents: state.asset?.rentalBuildingBasisCents,
          ...acquisitionData,
          ...(home ? { homeSaleAssumptions } : {}),
        };
        if (state.asset)
          await repository.updateAsset?.({
            ...input,
            expectedRevision: state.asset.revision,
          });
        else await repository.createAsset?.(input);
      } else {
        let payment = parseMoney(minimumPayment);
        let mortgageTerms = null;
        if (mortgage) {
          const original = parseMoney(principal);
          const months = /^\d+$/.test(term) ? Number(term) : 0;
          const custom = overridePayment ? parseMoney(paymentOverride) : null;
          if (
            !original ||
            original < cents ||
            months < 1 ||
            months > 480 ||
            !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
          )
            throw {
              message:
                "Enter valid mortgage principal, start date, and a term from 1 to 480 months.",
            };
          if (overridePayment && (!custom || custom <= 0))
            throw { message: "Enter a positive custom monthly payment." };
          payment = custom ?? mortgagePayment(original, bps, months);
          mortgageTerms = {
            originalPrincipalCents: original,
            termMonths: months,
            startDate,
            paymentOverrideCents: custom,
          };
        }
        if (payment == null || (cents > 0 && payment <= 0))
          throw {
            message: "Enter a positive monthly payment for a nonzero debt.",
          };
        const input = {
          id: liability?.id ?? crypto.randomUUID(),
          name: name.trim(),
          balanceCents: cents,
          annualRateBps: bps,
          minimumPaymentCents: payment,
          mortgage: mortgageTerms,
        };
        if (liability)
          await repository.updateLiability?.({
            ...input,
            expectedRevision: liability.revision,
          });
        else await repository.createLiability?.(input);
      }
      await Promise.resolve(refresh());
      close();
    } catch (x) {
      setError(errorMessage(x, "Could not save your changes."));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      if (isAsset)
        await repository.deleteAsset?.({
          id: state.asset!.id,
          expectedRevision: state.asset!.revision,
        });
      else
        await repository.deleteLiability?.({
          id: liability!.id,
          expectedRevision: liability!.revision,
        });
      await Promise.resolve(refresh());
      close();
    } catch (x) {
      setError(errorMessage(x, "Could not delete this record."));
    } finally {
      setBusy(false);
    }
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && !busy) close();
  }
  const noun = isAsset ? "asset" : "debt";
  return (
    <div className="modal-backdrop">
      <section
        ref={modal}
        className="card entry-modal side-sheet"
        role={confirmDelete ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="financial-record-title"
        onKeyDown={keyDown}
      >
        <h2
          id="financial-record-title"
          ref={headingRef}
          tabIndex={confirmDelete ? -1 : undefined}
        >
          {confirmDelete
            ? `Delete ${noun}?`
            : `${record ? "Edit" : "Add"} ${noun}`}
        </h2>
        {error && (
          <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        {confirmDelete ? (
          <>
            <p>
              This permanently removes {record?.name}.
              {isAsset && linkedMortgage
                ? ` Its linked mortgage, ${linkedMortgage.name}, will also be permanently removed.`
                : linkedMortgage
                  ? " The linked home will remain in Net Worth."
                  : " Existing account and activity history is unaffected."}
            </p>
            <div className="actions">
              <button disabled={busy} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="danger" disabled={busy} onClick={remove}>
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <label>
                {isAsset ? "Asset name" : "Debt name"}
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                {isAsset && home
                  ? "Current home value (USD)"
                  : isAsset
                    ? "Current value (USD)"
                    : "Current balance (USD)"}
                <input
                  required
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              {isAsset && !state.asset && (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={home}
                      onChange={(e) => {
                        setHome(e.target.checked);
                        if (e.target.checked) setPrivateStock(false);
                      }}
                    />{" "}
                    This asset is a home
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={privateStock}
                      onChange={(e) => {
                        setPrivateStock(e.target.checked);
                        if (e.target.checked) setHome(false);
                      }}
                    />{" "}
                    This asset is private stock
                  </label>
                </>
              )}
              {isAsset && state.asset && !home && !equityHolding && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={privateStock}
                    onChange={(e) => setPrivateStock(e.target.checked)}
                  />{" "}
                  This asset is private stock
                </label>
              )}
              {isAsset && equityHolding && (
                <section aria-label="RSU grant details">
                  <p>
                    <strong>Company equity holding</strong> ·{" "}
                    {equityHolding.grants.length} separate RSU grants ·{" "}
                    {units(
                      equityHolding.grants.reduce(
                        (sum, grant) => sum + grant.unitsMicros,
                        0,
                      ),
                    )}{" "}
                    total units
                  </p>
                  <p className="muted">
                    Share price {money(equityHolding.priceCents)} as of{" "}
                    {equityHolding.priceDate}. Grant dates and vest schedules
                    are tracked separately below.
                  </p>
                  {equityHolding.grants.map((grant) => {
                    const upcoming = nextVest(grant, localIsoDate()),
                      vested = vestedUnitsAt(grant, localIsoDate());
                    return (
                      <details key={grant.id} open>
                        <summary>
                          {grant.id === "original"
                            ? "Original grant"
                            : grant.id === "promotion"
                              ? "Promotion grant"
                              : grant.id}{" "}
                          · {units(grant.unitsMicros)} units
                        </summary>
                        <p>
                          Granted {grant.grantDate} at{" "}
                          {money(grant.grantPriceCents)} · {units(vested)}{" "}
                          vested · {units(grant.unitsMicros - vested)} unvested
                          {upcoming
                            ? ` · next vest ${units(upcoming.unitsMicros)} on ${upcoming.date}`
                            : " · fully vested"}
                        </p>
                        <div className="sheet-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Vest date</th>
                                <th>Units</th>
                                <th>Status</th>
                                <th>FMV</th>
                              </tr>
                            </thead>
                            <tbody>
                              {grant.vestEvents.map((event) => (
                                <tr key={event.id}>
                                  <td>{event.date}</td>
                                  <td>{units(event.unitsMicros)}</td>
                                  <td>
                                    {event.date <= localIsoDate()
                                      ? "Vested"
                                      : "Scheduled"}
                                  </td>
                                  <td>
                                    {event.actualFmvCents
                                      ? money(event.actualFmvCents)
                                      : "Projected"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    );
                  })}
                </section>
              )}
              {isAsset && privateStock && (
                <>
                  <p className="muted">
                    The full company value appreciates, but only vested value
                    counts toward Net Worth.
                  </p>
                  <label>
                    Currently vested (%)
                    <input
                      required
                      inputMode="decimal"
                      value={vestedPercent}
                      onChange={(e) => setVestedPercent(e.target.value)}
                    />
                  </label>
                  <label>
                    Remaining vesting starts
                    <input
                      required
                      type="date"
                      value={vestingStartDate}
                      onChange={(e) => setVestingStartDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Remaining vesting period (years)
                    <input
                      required
                      type="number"
                      min="0.25"
                      max="100"
                      step="0.25"
                      value={remainingVestingYears}
                      onChange={(e) => setRemainingVestingYears(e.target.value)}
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={taxOnVest}
                      onChange={(e) => setTaxOnVest(e.target.checked)}
                    />{" "}
                    Sell vested shares to cover ordinary-income tax
                  </label>
                  <p className="muted">
                    The unvested portion vests evenly every quarter over this
                    period.
                  </p>
                </>
              )}
              {isAsset && home && !state.asset && (
                <>
                  <label>
                    Original purchase price (USD)
                    <input
                      required
                      inputMode="decimal"
                      value={purchasePrice}
                      onChange={(e) => setPurchasePrice(e.target.value)}
                    />
                  </label>
                  <label>
                    Purchase date
                    <input
                      required
                      type="date"
                      max={today()}
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                    />
                  </label>
                  <label>
                    Property tax (%)
                    <input
                      required
                      inputMode="decimal"
                      value={propertyTax}
                      onChange={(e) => setPropertyTax(e.target.value)}
                    />
                  </label>
                  <label>
                    Homeowners insurance per year (USD)
                    <input
                      required
                      inputMode="decimal"
                      value={insuranceAnnual}
                      onChange={(e) => setInsuranceAnnual(e.target.value)}
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={financed}
                      onChange={(e) => setFinanced(e.target.checked)}
                    />{" "}
                    Financed with a mortgage
                  </label>
                  {financed && (
                    <>
                      <label>
                        Down payment (%)
                        <input
                          required
                          inputMode="decimal"
                          value={downPayment}
                          onChange={(e) => setDownPayment(e.target.value)}
                        />
                      </label>
                      <label>
                        Mortgage interest rate (%)
                        <input
                          required
                          inputMode="decimal"
                          value={loanRate}
                          onChange={(e) => setLoanRate(e.target.value)}
                        />
                      </label>
                      <label>
                        Loan term (months)
                        <input
                          required
                          inputMode="numeric"
                          value={term}
                          onChange={(e) => setTerm(e.target.value)}
                        />
                      </label>
                      <p className="muted">
                        LifeLook calculates the original principal, standard
                        monthly payment, and current mortgage balance from these
                        terms.
                      </p>
                    </>
                  )}
                </>
              )}
              {isAsset && home && (
                <details>
                  <summary>Sale and tax details</summary>
                  <fieldset>
                    {state.asset && state.asset.purchaseDate == null && (
                      <label>
                        Purchase date
                        <input
                          required
                          type="date"
                          max={today()}
                          value={purchaseDate}
                          onChange={(e) => setPurchaseDate(e.target.value)}
                        />
                      </label>
                    )}
                    {state.asset && state.asset.purchasePriceCents == null && (
                      <label>
                        Tax basis
                        <input
                          required
                          inputMode="decimal"
                          value={purchasePrice}
                          onChange={(e) => setPurchasePrice(e.target.value)}
                        />
                      </label>
                    )}
                    <label>
                      Selling costs (%)
                      <input
                        inputMode="decimal"
                        value={sellingCosts}
                        onChange={(e) => setSellingCosts(e.target.value)}
                      />
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={primaryResidenceExclusionEligible}
                        onChange={(e) =>
                          setPrimaryResidenceExclusionEligible(e.target.checked)
                        }
                      />{" "}
                      Eligible for primary-home gain exclusion
                    </label>
                    <label>
                      Federal depreciation claimed
                      <input
                        required
                        inputMode="decimal"
                        value={federalDepreciation}
                        onChange={(e) => setFederalDepreciation(e.target.value)}
                      />
                    </label>
                    <label>
                      California depreciation claimed
                      <input
                        required
                        inputMode="decimal"
                        value={californiaDepreciation}
                        onChange={(e) =>
                          setCaliforniaDepreciation(e.target.value)
                        }
                      />
                    </label>
                  </fieldset>
                </details>
              )}
              {(!isAsset || !advancedGrowth) && (
                <label>
                  {isAsset ? "Annual growth (%)" : "Annual interest rate (%)"}
                  <input
                    required
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                </label>
              )}
              {isAsset && (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={advancedGrowth}
                      onChange={(e) => setAdvancedGrowth(e.target.checked)}
                    />{" "}
                    Use an appreciation curve
                  </label>
                  {advancedGrowth && (
                    <>
                      <p className="muted">
                        The rate changes linearly each year, then remains at the
                        ending rate.
                      </p>
                      <label>
                        Starting year
                        <input
                          required
                          inputMode="numeric"
                          value={growthStartYear}
                          onChange={(e) => setGrowthStartYear(e.target.value)}
                        />
                      </label>
                      <label>
                        Starting appreciation (%)
                        <input
                          required
                          inputMode="decimal"
                          value={growthStartRate}
                          onChange={(e) => setGrowthStartRate(e.target.value)}
                        />
                      </label>
                      <label>
                        Ending year
                        <input
                          required
                          inputMode="numeric"
                          value={growthEndYear}
                          onChange={(e) => setGrowthEndYear(e.target.value)}
                        />
                      </label>
                      <label>
                        Ending appreciation (%)
                        <input
                          required
                          inputMode="decimal"
                          value={growthEndRate}
                          onChange={(e) => setGrowthEndRate(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                </>
              )}
              {!isAsset && (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={mortgage}
                      onChange={(e) => setMortgage(e.target.checked)}
                    />{" "}
                    Include mortgage details
                  </label>
                  {mortgage ? (
                    <>
                      <p className="muted">
                        Calculated payments include principal and interest only,
                        not taxes, insurance, or escrow.
                      </p>
                      <label>
                        Original principal (USD)
                        <input
                          required
                          inputMode="decimal"
                          value={principal}
                          onChange={(e) => setPrincipal(e.target.value)}
                        />
                      </label>
                      <label>
                        Mortgage start date
                        <input
                          required
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                        />
                      </label>
                      <label>
                        Original term (months)
                        <input
                          required
                          inputMode="numeric"
                          value={term}
                          onChange={(e) => setTerm(e.target.value)}
                        />
                      </label>
                      {!overridePayment && calculatedPayment != null && (
                        <p role="status">
                          Calculated principal and interest:{" "}
                          <strong>{money(calculatedPayment)}</strong> per month.
                        </p>
                      )}
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={overridePayment}
                          onChange={(e) => setOverridePayment(e.target.checked)}
                        />{" "}
                        Use custom monthly payment
                      </label>
                      {overridePayment && (
                        <label>
                          Custom monthly payment (USD)
                          <input
                            required
                            inputMode="decimal"
                            value={paymentOverride}
                            onChange={(e) => setPaymentOverride(e.target.value)}
                          />
                        </label>
                      )}
                    </>
                  ) : (
                    <label>
                      Minimum monthly payment (USD)
                      <input
                        required
                        inputMode="decimal"
                        value={minimumPayment}
                        onChange={(e) => setMinimumPayment(e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
            </fieldset>
            <div className="actions">
              {record && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </button>
              )}
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function Onboarding({
  initial,
  repository,
  onComplete,
}: {
  initial: Bootstrap;
  repository: Repository;
  onComplete: () => void;
}) {
  const householdId = useRef(initial.household?.id ?? crypto.randomUUID());
  const [step, setStep] = useState(
    Math.min(8, Math.max(1, initial.onboardingStep + 1)),
  );
  const [name, setName] = useState(initial.household?.name ?? "");
  const [people, setPeople] = useState<BootstrapPerson[]>(
    initial.people.length
      ? initial.people.map((p) => ({
          ...p,
          birthDate: displayBirthDate(p.birthDate),
        }))
      : [newPerson(householdId.current)],
  );
  const [accounts, setAccounts] = useState<AccountDraft[]>(
    initial.accounts.length
      ? initial.accounts.map((a) => ({
          ...a,
          balance: String(a.openingBalanceCents / 100),
        }))
      : [newAccount(householdId.current)],
  );
  const [filingStatus, setFilingStatus] = useState(
    initial.taxProfile?.filingStatus ?? "",
  );
  const [jointMembers, setJointMembers] = useState<[string, string]>(() => {
    const saved = initial.taxProfile?.taxUnit?.memberPersonIds ?? [];
    return [
      saved[0] ?? initial.people[0]?.id ?? "",
      saved[1] ?? initial.people[1]?.id ?? "",
    ];
  });
  const categoryId = (kind: "income" | "expense") =>
    initial.categories.find((c) => c.kind === kind)?.id ??
    `${kind}-other-${householdId.current}`;
  const [income, setIncome] = useState<RecurringDraft[]>(() =>
    initial.recurring
      .filter(
        (r) =>
          initial.categories.find((c) => c.id === r.categoryId)?.kind ===
          "income",
      )
      .map(toRecurringDraft),
  );
  const [expenses, setExpenses] = useState<RecurringDraft[]>(() =>
    initial.recurring
      .filter(
        (r) =>
          initial.categories.find((c) => c.id === r.categoryId)?.kind ===
          "expense",
      )
      .map(toRecurringDraft),
  );
  const [assets, setAssets] = useState<AssetDraft[]>(() =>
    initial.assets.map((a) => ({
      id: a.id,
      name: a.name,
      value: String(a.valueCents / 100),
      rate: String(a.annualGrowthBps / 100),
    })),
  );
  const [debts, setDebts] = useState<DebtDraft[]>(() =>
    initial.liabilities.map(toDebtDraft),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (step === 1) {
      const invalid = people.findIndex((p) => !p.name.trim());
      const invalidDate = people.findIndex(
        (p) => parseBirthDate(p.birthDate) === undefined,
      );
      if (!name.trim() || invalid >= 0 || invalidDate >= 0) {
        setError(
          !name.trim()
            ? "Household name is required."
            : invalid >= 0
              ? `Person ${invalid + 1}: name is required.`
              : `Person ${invalidDate + 1}: enter a valid birth date as MM/DD/YYYY.`,
        );
        return;
      }
    }
    if (step === 2) {
      if (!filingStatus) {
        setError("Select a filing status before continuing.");
        return;
      }
      if (
        filingStatus === "married-joint" &&
        (!jointMembers[0] ||
          !jointMembers[1] ||
          jointMembers[0] === jointMembers[1])
      ) {
        setError(
          "Married filing jointly requires two distinct household people.",
        );
        return;
      }
    }
    if (step === 3) {
      const invalid = accounts.findIndex(
        (a) => !a.kind || !a.name.trim() || !validMoney(a.balance),
      );
      if (invalid >= 0) {
        setError(
          `Account ${invalid + 1}: type, name, and a valid USD opening balance are required.`,
        );
        return;
      }
    }
    let payload: import("./repository").OnboardingStepPayload = {};
    if (step === 4 || step === 5) {
      const kind = step === 4 ? "income" : "expense",
        drafts = step === 4 ? income : expenses;
      const converted = drafts.map((d, i) => validateRecurringDraft(d, i));
      const failure = converted.find((x) => typeof x === "string");
      if (failure) {
        setError(failure as string);
        return;
      }
      payload = { recurring: { kind, items: converted as RecurringInput[] } };
    }
    if (step === 6) {
      const converted = assets.map((d, i) => validateAssetDraft(d, i));
      const failure = converted.find((x) => typeof x === "string");
      if (failure) {
        setError(failure as string);
        return;
      }
      payload = { assets: converted as AssetInput[] };
    }
    if (step === 7) {
      const converted = debts.map((d, i) => validateDebtDraft(d, i));
      const failure = converted.find((x) => typeof x === "string");
      if (failure) {
        setError(failure as string);
        return;
      }
      payload = { liabilities: converted as LiabilityInput[] };
    }
    setSaving(true);
    try {
      if (step === 1) {
        await repository.saveOnboardingStep(1, {
          household: {
            id: householdId.current,
            name: name.trim(),
            state: "CA",
          },
          people: people.map((p) => ({
            ...p,
            name: p.name.trim(),
            birthDate: parseBirthDate(p.birthDate),
          })),
        });
      } else if (step === 2) {
        await repository.saveOnboardingStep(2, {
          taxProfile: {
            filingStatus: filingStatus as TaxProfile["filingStatus"],
            state: "CA",
            taxYear: 2026,
            thresholdInflationBps: 250,
            taxUnit: {
              id:
                initial.taxProfile?.taxUnit?.id ??
                `${householdId.current}-tax-unit`,
              filingStatus: filingStatus as TaxProfile["filingStatus"],
              memberPersonIds:
                filingStatus === "married-joint"
                  ? jointMembers
                  : [jointMembers[0] || people[0]?.id].filter(Boolean),
            },
            revision: initial.taxProfile?.revision ?? 1,
          },
        });
      } else if (step === 3) {
        await repository.saveOnboardingStep(3, {
          accounts: accounts.map(toAccount),
        });
      } else if (step < 8) {
        await repository.saveOnboardingStep(step, payload);
      } else {
        await repository.completeOnboarding();
        onComplete();
        return;
      }
      setStep(Math.min(8, step + 1));
    } catch (e) {
      setError(
        (e as { message?: string }).message ?? "Could not save this step.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <main className="standalone">
      <section className="card onboarding">
        <span className="label assumption">Setup · Step {step} of 8</span>
        <h1>
          {
            [
              "",
              "Tell us about your household",
              "Choose your tax profile",
              "Add the accounts you want to track",
              "Add recurring income",
              "Add recurring expenses",
              "Add your assets",
              "Add your debts",
              "Review and finish",
            ][step]
          }
        </h1>
        <p className="muted">
          Your progress is saved locally. LifeLook does not create an online
          account.
        </p>
        <form onSubmit={submit}>
          {step === 1 ? (
            <>
              <label>
                Household name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </label>
              {people.map((p, i) => (
                <fieldset className="repeat-row" key={p.id}>
                  <legend>Person {i + 1}</legend>
                  <label>
                    Name
                    <input
                      aria-label={`Person ${i + 1} name`}
                      value={p.name}
                      onChange={(e) =>
                        setPeople(updateAt(people, i, { name: e.target.value }))
                      }
                    />
                  </label>
                  <BirthDateField
                    label={`Person ${i + 1} birth date`}
                    value={p.birthDate ?? ""}
                    onChange={(birthDate) =>
                      setPeople(updateAt(people, i, { birthDate }))
                    }
                  />
                  {people.length > 1 && (
                    <button
                      type="button"
                      className="quiet danger"
                      onClick={() =>
                        setPeople(people.filter((_, x) => x !== i))
                      }
                    >
                      Remove person {i + 1}
                    </button>
                  )}
                </fieldset>
              ))}
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  setPeople([...people, newPerson(householdId.current)])
                }
              >
                <Plus size={15} /> Add another person
              </button>
              <label>
                Filing location
                <input value="California" disabled />
              </label>
            </>
          ) : step === 2 ? (
            <>
              <label>
                Filing status
                <select
                  aria-label="Filing status"
                  value={filingStatus}
                  onChange={(e) => setFilingStatus(e.target.value)}
                >
                  <option value="">Select…</option>
                  <option value="single">Single</option>
                  <option value="married-joint">Married filing jointly</option>
                  <option value="married-separate">
                    Married filing separately
                  </option>
                  <option value="head-of-household">Head of household</option>
                </select>
              </label>
              {filingStatus === "married-joint" && (
                <fieldset>
                  <legend>Joint tax unit</legend>
                  <label>
                    First spouse
                    <select
                      value={jointMembers[0]}
                      onChange={(event) =>
                        setJointMembers([event.target.value, jointMembers[1]])
                      }
                    >
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Second spouse
                    <select
                      value={jointMembers[1]}
                      onChange={(event) =>
                        setJointMembers([jointMembers[0], event.target.value])
                      }
                    >
                      <option value="">Select…</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </fieldset>
              )}
              <p className="muted">
                Required for tax-dependent projections. California and the 2026
                rule pack are used.
              </p>
            </>
          ) : step === 3 ? (
            <>
              {accounts.map((a, i) => (
                <fieldset className="repeat-row" key={a.id}>
                  <legend>Account {i + 1}</legend>
                  <fieldset className="account-types">
                    <legend>Account {i + 1} type</legend>
                    {accountKinds.map((k) => (
                      <label
                        className={a.kind === k.value ? "selected" : ""}
                        key={k.value}
                      >
                        <input
                          type="radio"
                          name={`account-${i}-type`}
                          value={k.value}
                          checked={a.kind === k.value}
                          onChange={() =>
                            setAccounts(
                              updateAt(accounts, i, { kind: k.value }),
                            )
                          }
                        />
                        <strong>{k.label}</strong>
                        <small>{k.help}</small>
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    Account name{" "}
                    <span className="optional">
                      Your own label, e.g. Main checking
                    </span>
                    <input
                      aria-label={`Account ${i + 1} name`}
                      value={a.name}
                      onChange={(e) =>
                        setAccounts(
                          updateAt(accounts, i, { name: e.target.value }),
                        )
                      }
                    />
                  </label>
                  <label>
                    Opening balance (USD)
                    <input
                      aria-label={`Account ${i + 1} opening balance`}
                      inputMode="decimal"
                      value={a.balance}
                      onChange={(e) =>
                        setAccounts(
                          updateAt(accounts, i, { balance: e.target.value }),
                        )
                      }
                    />
                  </label>
                  <p className="muted">
                    Balance as of today.{" "}
                    {a.kind === "credit"
                      ? "Enter the positive amount you owe (for example, 125.40). It is stored as debt."
                      : "Use the current balance; negative values are accepted."}
                  </p>
                  {accounts.length > 1 && (
                    <button
                      type="button"
                      className="quiet danger"
                      onClick={() => {
                        const removed = a.id;
                        setAccounts(accounts.filter((_, x) => x !== i));
                        setIncome(
                          income.map((r) =>
                            r.accountId === removed
                              ? { ...r, accountId: "" }
                              : r,
                          ),
                        );
                        setExpenses(
                          expenses.map((r) =>
                            r.accountId === removed
                              ? { ...r, accountId: "" }
                              : r,
                          ),
                        );
                      }}
                    >
                      Remove account {i + 1}
                    </button>
                  )}
                </fieldset>
              ))}
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  setAccounts([...accounts, newAccount(householdId.current)])
                }
              >
                <Plus size={15} /> Add another account
              </button>
            </>
          ) : step === 4 || step === 5 ? (
            <RecurringOnboardingFields
              kind={step === 4 ? "income" : "expense"}
              items={step === 4 ? income : expenses}
              setItems={step === 4 ? setIncome : setExpenses}
              accounts={accounts}
              categoryId={categoryId(step === 4 ? "income" : "expense")}
            />
          ) : step === 6 ? (
            <AssetOnboardingFields items={assets} setItems={setAssets} />
          ) : step === 7 ? (
            <DebtOnboardingFields items={debts} setItems={setDebts} />
          ) : (
            <OnboardingReview
              name={name}
              people={people}
              filingStatus={filingStatus}
              accounts={accounts}
              income={income}
              expenses={expenses}
              assets={assets}
              debts={debts}
              edit={setStep}
            />
          )}
          {error && (
            <p role="alert" className="negative">
              {error}
            </p>
          )}
          <div className="form-actions">
            {step > 1 && (
              <button
                type="button"
                className="quiet"
                onClick={() => setStep(step - 1)}
              >
                Back
              </button>
            )}
            <button className="add" disabled={saving}>
              {saving
                ? "Saving…"
                : step === 1
                  ? "Save & Continue"
                  : step === 8
                    ? "Finish setup"
                    : step >= 4 &&
                        (step === 4
                          ? income.length
                          : step === 5
                            ? expenses.length
                            : step === 6
                              ? assets.length
                              : debts.length) === 0
                      ? "Skip & Continue"
                      : "Save & Continue"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

type RecurringDraft = {
  id: string;
  categoryId: string;
  accountId: string;
  name: string;
  amount: string;
  frequency: RecurringInput["frequency"];
  startDate: string;
  endDate: string;
  growth: string;
};
type AssetDraft = { id: string; name: string; value: string; rate: string };
type DebtDraft = {
  id: string;
  name: string;
  balance: string;
  rate: string;
  minimumPayment: string;
  mortgage: boolean;
  principal: string;
  term: string;
  startDate: string;
  overridePayment: boolean;
  paymentOverride: string;
};
const toRecurringDraft = (r: RecurringEntry): RecurringDraft => ({
  id: r.id,
  categoryId: r.categoryId,
  accountId: r.accountId ?? "",
  name: r.name,
  amount: String(r.amountCents / 100),
  frequency: r.frequency,
  startDate: r.startDate,
  endDate: r.endDate ?? "",
  growth: String(r.annualGrowthBps / 100),
});
const newRecurringDraft = (categoryId: string): RecurringDraft => ({
  id: crypto.randomUUID(),
  categoryId,
  accountId: "",
  name: "",
  amount: "",
  frequency: "monthly",
  startDate: today(),
  endDate: "",
  growth: "0",
});
const toDebtDraft = (d: Liability): DebtDraft => ({
  id: d.id,
  name: d.name,
  balance: String(d.balanceCents / 100),
  rate: String(d.annualRateBps / 100),
  minimumPayment: String(d.minimumPaymentCents / 100),
  mortgage: Boolean(d.mortgage),
  principal: String((d.mortgage?.originalPrincipalCents ?? 0) / 100),
  term: String(d.mortgage?.termMonths ?? 360),
  startDate: d.mortgage?.startDate ?? today(),
  overridePayment: d.mortgage?.paymentOverrideCents != null,
  paymentOverride: String((d.mortgage?.paymentOverrideCents ?? 0) / 100),
});
const newDebtDraft = (): DebtDraft => ({
  id: crypto.randomUUID(),
  name: "",
  balance: "",
  rate: "0",
  minimumPayment: "",
  mortgage: false,
  principal: "",
  term: "360",
  startDate: today(),
  overridePayment: false,
  paymentOverride: "",
});
function validateRecurringDraft(
  d: RecurringDraft,
  i: number,
): RecurringInput | string {
  const amount = parseMoney(d.amount),
    growth = parsePercent(d.growth);
  if (!d.name.trim()) return `Record ${i + 1}: name is required.`;
  if (amount == null || amount <= 0)
    return `Record ${i + 1}: enter a positive USD amount.`;
  if (!d.startDate || (d.endDate && d.endDate < d.startDate))
    return `Record ${i + 1}: enter a valid date range.`;
  if (growth == null || growth < -10000 || growth > 100000)
    return `Record ${i + 1}: annual growth is outside the supported range.`;
  return {
    id: d.id,
    categoryId: d.categoryId,
    accountId: d.accountId || null,
    name: d.name.trim(),
    amountCents: amount,
    frequency: d.frequency,
    startDate: d.startDate,
    endDate: d.endDate || null,
    annualGrowthBps: growth,
  };
}
function validateAssetDraft(d: AssetDraft, i: number): AssetInput | string {
  const value = parseMoney(d.value),
    rate = parsePercent(d.rate);
  if (!d.name.trim()) return `Asset ${i + 1}: name is required.`;
  if (value == null || value < 0)
    return `Asset ${i + 1}: enter a non-negative USD value.`;
  if (rate == null || rate < -10000 || rate > 100000)
    return `Asset ${i + 1}: annual growth is outside the supported range.`;
  return {
    id: d.id,
    name: d.name.trim(),
    valueCents: value,
    annualGrowthBps: rate,
  };
}
function validateDebtDraft(d: DebtDraft, i: number): LiabilityInput | string {
  const balance = parseMoney(d.balance),
    rate = parsePercent(d.rate),
    minimum = parseMoney(d.minimumPayment);
  if (!d.name.trim()) return `Debt ${i + 1}: name is required.`;
  if (balance == null || balance < 0)
    return `Debt ${i + 1}: enter a non-negative balance.`;
  if (rate == null || rate < 0 || rate > 100000)
    return `Debt ${i + 1}: interest rate is outside the supported range.`;
  let mortgage = null,
    payment = minimum;
  if (d.mortgage) {
    const principal = parseMoney(d.principal),
      months = /^\d+$/.test(d.term) ? Number(d.term) : 0,
      custom = d.overridePayment ? parseMoney(d.paymentOverride) : null;
    if (
      !principal ||
      principal < balance ||
      months < 1 ||
      months > 480 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d.startDate)
    )
      return `Debt ${i + 1}: enter valid mortgage principal, date, and term.`;
    if (d.overridePayment && (!custom || custom <= 0))
      return `Debt ${i + 1}: enter a positive custom payment.`;
    payment = custom ?? mortgagePayment(principal, rate, months);
    mortgage = {
      originalPrincipalCents: principal,
      termMonths: months,
      startDate: d.startDate,
      paymentOverrideCents: custom,
    };
  }
  if (payment == null || (balance > 0 && payment <= 0))
    return `Debt ${i + 1}: enter a positive monthly payment.`;
  return {
    id: d.id,
    name: d.name.trim(),
    balanceCents: balance,
    annualRateBps: rate,
    minimumPaymentCents: payment,
    mortgage,
  };
}
function RecurringOnboardingFields({
  kind,
  items,
  setItems,
  accounts,
  categoryId,
}: {
  kind: "income" | "expense";
  items: RecurringDraft[];
  setItems: (x: RecurringDraft[]) => void;
  accounts: AccountDraft[];
  categoryId: string;
}) {
  return (
    <>
      <p className="muted">
        Optional. Add as many recurring {kind} records as you need.
      </p>
      {items.map((d, i) => (
        <fieldset className="repeat-row" key={d.id}>
          <legend>
            {kind === "income" ? "Income" : "Expense"} {i + 1}
          </legend>
          <label>
            Name
            <input
              aria-label={`${kind} ${i + 1} name`}
              value={d.name}
              onChange={(e) =>
                setItems(updateAt(items, i, { name: e.target.value }))
              }
            />
          </label>
          <label>
            Category
            <select
              value={d.categoryId}
              onChange={(e) =>
                setItems(updateAt(items, i, { categoryId: e.target.value }))
              }
            >
              <option value={categoryId}>
                {kind === "income" ? "Other income" : "Other expense"}
              </option>
            </select>
          </label>
          <label>
            Account (optional)
            <select
              value={d.accountId}
              onChange={(e) =>
                setItems(updateAt(items, i, { accountId: e.target.value }))
              }
            >
              <option value="">No specific account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount (USD)
            <input
              inputMode="decimal"
              value={d.amount}
              onChange={(e) =>
                setItems(updateAt(items, i, { amount: e.target.value }))
              }
            />
          </label>
          <label>
            Frequency
            <select
              value={d.frequency}
              onChange={(e) =>
                setItems(
                  updateAt(items, i, {
                    frequency: e.target.value as RecurringInput["frequency"],
                  }),
                )
              }
            >
              {[
                ["weekly", "Weekly"],
                ["biweekly", "Every two weeks"],
                ["monthly", "Monthly"],
                ["quarterly", "Quarterly"],
                ["annual", "Annual"],
              ].map((x) => (
                <option key={x[0]} value={x[0]}>
                  {x[1]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start date
            <input
              type="date"
              value={d.startDate}
              onChange={(e) =>
                setItems(updateAt(items, i, { startDate: e.target.value }))
              }
            />
          </label>
          <label>
            End date (optional)
            <input
              type="date"
              min={d.startDate}
              value={d.endDate}
              onChange={(e) =>
                setItems(updateAt(items, i, { endDate: e.target.value }))
              }
            />
          </label>
          <label>
            Annual growth (%)
            <input
              inputMode="decimal"
              value={d.growth}
              onChange={(e) =>
                setItems(updateAt(items, i, { growth: e.target.value }))
              }
            />
          </label>
          <button
            type="button"
            className="quiet danger"
            onClick={() => setItems(items.filter((_, x) => x !== i))}
          >
            Remove {kind} {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="quiet"
        onClick={() => setItems([...items, newRecurringDraft(categoryId)])}
      >
        <Plus size={15} /> Add {kind}
      </button>
    </>
  );
}
function AssetOnboardingFields({
  items,
  setItems,
}: {
  items: AssetDraft[];
  setItems: (x: AssetDraft[]) => void;
}) {
  return (
    <>
      <p className="muted">
        Optional. Include property and other assets not represented by an
        account.
      </p>
      {items.map((d, i) => (
        <fieldset className="repeat-row" key={d.id}>
          <legend>Asset {i + 1}</legend>
          <label>
            Asset name
            <input
              value={d.name}
              onChange={(e) =>
                setItems(updateAt(items, i, { name: e.target.value }))
              }
            />
          </label>
          <label>
            Current value (USD)
            <input
              inputMode="decimal"
              value={d.value}
              onChange={(e) =>
                setItems(updateAt(items, i, { value: e.target.value }))
              }
            />
          </label>
          <label>
            Annual growth (%)
            <input
              inputMode="decimal"
              value={d.rate}
              onChange={(e) =>
                setItems(updateAt(items, i, { rate: e.target.value }))
              }
            />
          </label>
          <button
            type="button"
            className="quiet danger"
            onClick={() => setItems(items.filter((_, x) => x !== i))}
          >
            Remove asset {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="quiet"
        onClick={() =>
          setItems([
            ...items,
            { id: crypto.randomUUID(), name: "", value: "", rate: "0" },
          ])
        }
      >
        <Plus size={15} /> Add asset
      </button>
    </>
  );
}
function DebtOnboardingFields({
  items,
  setItems,
}: {
  items: DebtDraft[];
  setItems: (x: DebtDraft[]) => void;
}) {
  return (
    <>
      <p className="muted">
        Optional. Mortgage payments include principal and interest only.
      </p>
      {items.map((d, i) => (
        <fieldset className="repeat-row" key={d.id}>
          <legend>Debt {i + 1}</legend>
          <label>
            Debt name
            <input
              value={d.name}
              onChange={(e) =>
                setItems(updateAt(items, i, { name: e.target.value }))
              }
            />
          </label>
          <label>
            Current balance (USD)
            <input
              inputMode="decimal"
              value={d.balance}
              onChange={(e) =>
                setItems(updateAt(items, i, { balance: e.target.value }))
              }
            />
          </label>
          <label>
            Annual interest rate (%)
            <input
              inputMode="decimal"
              value={d.rate}
              onChange={(e) =>
                setItems(updateAt(items, i, { rate: e.target.value }))
              }
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={d.mortgage}
              onChange={(e) =>
                setItems(updateAt(items, i, { mortgage: e.target.checked }))
              }
            />{" "}
            Include mortgage details
          </label>
          {d.mortgage ? (
            <>
              <label>
                Original principal (USD)
                <input
                  inputMode="decimal"
                  value={d.principal}
                  onChange={(e) =>
                    setItems(updateAt(items, i, { principal: e.target.value }))
                  }
                />
              </label>
              <label>
                Mortgage start date
                <input
                  type="date"
                  value={d.startDate}
                  onChange={(e) =>
                    setItems(updateAt(items, i, { startDate: e.target.value }))
                  }
                />
              </label>
              <label>
                Original term (months)
                <input
                  inputMode="numeric"
                  value={d.term}
                  onChange={(e) =>
                    setItems(updateAt(items, i, { term: e.target.value }))
                  }
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={d.overridePayment}
                  onChange={(e) =>
                    setItems(
                      updateAt(items, i, { overridePayment: e.target.checked }),
                    )
                  }
                />{" "}
                Use custom monthly payment
              </label>
              {d.overridePayment && (
                <label>
                  Custom monthly payment (USD)
                  <input
                    inputMode="decimal"
                    value={d.paymentOverride}
                    onChange={(e) =>
                      setItems(
                        updateAt(items, i, { paymentOverride: e.target.value }),
                      )
                    }
                  />
                </label>
              )}
            </>
          ) : (
            <label>
              Minimum monthly payment (USD)
              <input
                inputMode="decimal"
                value={d.minimumPayment}
                onChange={(e) =>
                  setItems(
                    updateAt(items, i, { minimumPayment: e.target.value }),
                  )
                }
              />
            </label>
          )}
          <button
            type="button"
            className="quiet danger"
            onClick={() => setItems(items.filter((_, x) => x !== i))}
          >
            Remove debt {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="quiet"
        onClick={() => setItems([...items, newDebtDraft()])}
      >
        <Plus size={15} /> Add debt
      </button>
    </>
  );
}
function OnboardingReview({
  name,
  people,
  filingStatus,
  accounts,
  income,
  expenses,
  assets,
  debts,
  edit,
}: {
  name: string;
  people: BootstrapPerson[];
  filingStatus: string;
  accounts: AccountDraft[];
  income: RecurringDraft[];
  expenses: RecurringDraft[];
  assets: AssetDraft[];
  debts: DebtDraft[];
  edit: (n: number) => void;
}) {
  const sections: [
    [string, string, number],
    ...Array<[string, string, number]>,
  ] = [
    ["Household", `${name} · ${people.length} member(s)`, 1],
    ["Tax profile", filingStatus, 2],
    ["Accounts", `${accounts.length} account(s)`, 3],
    ["Income", `${income.length} recurring record(s)`, 4],
    ["Expenses", `${expenses.length} recurring record(s)`, 5],
    ["Assets", `${assets.length} asset(s)`, 6],
    ["Debts", `${debts.length} debt(s)`, 7],
  ];
  return (
    <>
      {sections.map(([title, summary, target]) => (
        <section className="review-row" key={title}>
          <div>
            <strong>{title}</strong>
            <p className="muted">{summary}</p>
          </div>
          <button type="button" className="quiet" onClick={() => edit(target)}>
            Edit {title.toLowerCase()}
          </button>
        </section>
      ))}
    </>
  );
}

type AccountDraft = BootstrapAccount & { balance: string };
const accountKinds: {
  value: BootstrapAccount["kind"];
  label: string;
  help: string;
}[] = [
  { value: "checking", label: "Checking", help: "Everyday spending" },
  { value: "savings", label: "Savings", help: "Cash set aside" },
  { value: "credit", label: "Credit card", help: "Money you owe" },
  { value: "investment", label: "Investment", help: "Brokerage assets" },
  { value: "retirement", label: "Retirement", help: "401(k), IRA, or similar" },
];
const newPerson = (householdId: string): BootstrapPerson => ({
  id: crypto.randomUUID(),
  householdId,
  name: "",
  birthDate: "",
});
const newAccount = (householdId: string): AccountDraft => ({
  id: crypto.randomUUID(),
  householdId,
  name: "",
  kind: "" as BootstrapAccount["kind"],
  balance: "",
  openingBalanceCents: 0,
  balanceCents: 0,
  annualReturnBps: 0,
  liquid: true,
  revision: 1,
});
const updateAt = <T,>(items: T[], index: number, patch: Partial<T>) =>
  items.map((item, i) => (i === index ? { ...item, ...patch } : item));
const validMoney = (value: string) => parseMoney(value) !== undefined;
function parseMoney(value: string): number | undefined {
  const match = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const cents =
    BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  if (cents > 99_999_999_999_999n) return undefined;
  return Number(match[1] ? -cents : cents);
}
function parsePercent(value: string): number | undefined {
  const match = /^(-?)(\d{1,4})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const bps = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -bps : bps;
}
function mortgagePayment(
  principalCents: number,
  annualRateBps: number,
  months: number,
) {
  if (annualRateBps === 0) return Math.round(principalCents / months);
  const monthlyRate = annualRateBps / 120_000;
  return Math.round(
    (principalCents * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months)),
  );
}
const toAccount = (a: AccountDraft): BootstrapAccount => ({
  ...a,
  openingBalanceCents:
    a.kind === "credit"
      ? -Math.abs(parseMoney(a.balance)!)
      : parseMoney(a.balance)!,
  balanceCents:
    a.kind === "credit"
      ? -Math.abs(parseMoney(a.balance)!)
      : parseMoney(a.balance)!,
  liquid: a.kind === "checking" || a.kind === "savings" || a.kind === "credit",
});
const displayBirthDate = (value?: string | null) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`
    : (value ?? "");
function parseBirthDate(value?: string | null): string | null | undefined {
  const text = value?.trim() ?? "";
  if (!text) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return undefined;
  const [, month, day, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
    ? `${year}-${month}-${day}`
    : undefined;
}
function BirthDateField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const inputId = `${label.replaceAll(" ", "-")}-text`;
  return (
    <div className="birth-date-field">
      <label htmlFor={inputId}>
        Birth date <span className="optional">Optional · MM/DD/YYYY</span>
      </label>
      <div>
        <input
          id={inputId}
          aria-label={label}
          inputMode="numeric"
          placeholder="MM/DD/YYYY"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <label className="calendar-control" title="Choose from calendar">
          <Calendar size={18} />
          <span className="sr-only">Choose {label} from calendar</span>
          <input
            aria-label={`Choose ${label} from calendar`}
            type="date"
            value={parseBirthDate(value) ?? ""}
            disabled={disabled}
            onChange={(event) => onChange(displayBirthDate(event.target.value))}
          />
        </label>
      </div>
    </div>
  );
}

function Overview({
  bootstrap,
  projections,
  navigate,
  onAdd,
}: {
  bootstrap: Bootstrap;
  projections: ReturnType<typeof ProjectionEngine.calculate> | null;
  navigate: (view: View) => void;
  onAdd: (kind: "income" | "expense" | "transfer", el: HTMLElement) => void;
}) {
  const currentDate = localIsoDate();
  const currentNetWorth =
    bootstrap.accounts.reduce((sum, a) => sum + a.balanceCents, 0) +
    bootstrap.assets.reduce(
      (sum, a) => sum + currentAssetValue(a, currentDate),
      0,
    ) -
    bootstrap.liabilities.reduce((sum, a) => sum + a.balanceCents, 0);
  const year = String(new Date().getFullYear());
  const actual = bootstrap.activity.filter(
    (x) => x.occurredOn.startsWith(year) && x.kind !== "transfer",
  );
  const income = actual
    .filter((x) => x.kind === "income")
    .reduce((s, x) => s + x.amountCents, 0);
  const spending = -actual
    .filter((x) => x.kind === "expense")
    .reduce((s, x) => s + x.amountCents, 0);
  const assets =
      bootstrap.accounts
        .filter((a) => a.balanceCents > 0)
        .reduce((s, a) => s + a.balanceCents, 0) +
      bootstrap.assets.reduce(
        (s, a) => s + currentAssetValue(a, currentDate),
        0,
      ),
    debt =
      bootstrap.accounts
        .filter((a) => a.balanceCents < 0)
        .reduce((s, a) => s - a.balanceCents, 0) +
      bootstrap.liabilities.reduce((s, a) => s + a.balanceCents, 0),
    compositionTotal = Math.max(1, assets + debt);
  const recent = [
    ...bootstrap.activity
      .reduce(
        (map, row) =>
          map.set(row.entryId, [...(map.get(row.entryId) ?? []), row]),
        new Map<string, ActivityPosting[]>(),
      )
      .values(),
  ]
    .sort((a, b) => b[0].occurredOn.localeCompare(a[0].occurredOn))
    .slice(0, 4);
  const projectedEnd = projections?.at(-1)?.months.at(-1);
  return (
    <div className="content">
      <section className="hero">
        <div>
          <span className="label actual">Current balance</span>
          <p className="hero-label">Net worth</p>
          <h2>{money(currentNetWorth)}</h2>
          <p className="muted">
            Based on current account, asset, and liability balances.
          </p>
        </div>
        <div
          className="hero-chart composition"
          aria-label={`Financial position: ${money(assets)} assets and ${money(debt)} debt`}
        >
          <div className="composition-heading">
            <strong>Financial position</strong>
            <InfoPopover label="About financial position">
              This uses current saved balances only. Debt is shown separately
              and subtracted from net worth.
            </InfoPopover>
          </div>
          <div className="composition-bar">
            <i style={{ width: `${(assets / compositionTotal) * 100}%` }} />
            <i
              className="debt"
              style={{ width: `${(debt / compositionTotal) * 100}%` }}
            />
          </div>
          <div className="composition-labels">
            <span>
              <i />
              Assets <strong>{money(assets)}</strong>
            </span>
            <span>
              <i className="debt" />
              Debt <strong>{money(debt)}</strong>
            </span>
          </div>
        </div>
      </section>
      <div className="section-action">
        <AnchoredMenu
          primary
          label="Add transaction"
          icon={<Plus size={16} />}
          items={[
            { label: "Income", onSelect: (el) => onAdd("income", el!) },
            { label: "Expense", onSelect: (el) => onAdd("expense", el!) },
            { label: "Transfer", onSelect: (el) => onAdd("transfer", el!) },
          ]}
        />
      </div>
      <div className="metrics">
        <Metric
          title="Income"
          value={money(income)}
          change={`${year} actual`}
          icon={ArrowDownRight}
        />
        <Metric
          title="Spending"
          value={money(spending)}
          change={`${year} actual`}
          icon={ArrowUpRight}
          negative
        />
        <Metric
          title="Saved"
          value={money(income - spending)}
          change="Income minus spending"
          icon={PiggyBank}
        />
        <Metric
          title="Taxes"
          value={
            projections ? money(projections[0]?.taxCents ?? 0) : "Unavailable"
          }
          change={projections ? "Projected" : "Tax profile required"}
          icon={CircleDollarSign}
          neutral
        />
      </div>
      <div className="two-col">
        <section className="card">
          <div className="card-title">
            <div>
              <span className="label actual">Actual</span>
              <h3>Recent activity</h3>
            </div>
            <button onClick={() => navigate("Activity")}>
              View all <ChevronRight size={14} />
            </button>
          </div>
          {recent.map((group) => {
            const row = group[0],
              transfer = row.kind === "transfer";
            return (
              <Transaction
                key={row.entryId}
                icon={
                  transfer
                    ? WalletCards
                    : row.kind === "income"
                      ? ArrowDownRight
                      : ArrowUpRight
                }
                name={row.description || row.kind}
                detail={`${row.accountName} · ${row.occurredOn}`}
                amount={money(
                  transfer
                    ? Math.abs(
                        group.find((x) => x.amountCents < 0)?.amountCents ?? 0,
                      )
                    : row.amountCents,
                )}
                positive={row.kind === "income"}
              />
            );
          })}
          {!recent.length && (
            <p className="empty">No transactions have been recorded.</p>
          )}
        </section>
        <section className="card">
          <div className="card-title">
            <div>
              <span className="label assumption">Assumption</span>
              <h3>Your plan at a glance</h3>
            </div>
            <button onClick={() => navigate("Plan")}>
              Open plan <ChevronRight size={14} />
            </button>
          </div>
          {projections ? (
            <>
              <p>
                <strong>
                  {money(
                    (projectedEnd?.netWorthCents ?? currentNetWorth) -
                      currentNetWorth,
                  )}
                </strong>{" "}
                projected change by{" "}
                {projectedEnd?.month
                  ? projectionMonthLabel(projectedEnd.month)
                  : "the end of the plan"}
                .
              </p>
              <p className="muted">
                Projected values use your saved tax profile and planning
                assumptions.
              </p>
            </>
          ) : (
            <p>
              Complete your tax profile before LifeLook calculates projections.
            </p>
          )}
        </section>
      </div>
      <DetailDisclosure
        label="View exact financial position"
        storageKey={`lifelook:ui:v1:${bootstrap.household?.id ?? "local"}:overview-composition`}
      >
        <p>
          Assets: <strong>{money(assets)}</strong>
        </p>
        <p>
          Debt: <strong>{money(debt)}</strong>
        </p>
        <p>
          Net worth: <strong>{money(currentNetWorth)}</strong>
        </p>
      </DetailDisclosure>
    </div>
  );
}
function Metric({
  title,
  value,
  change,
  icon: Icon,
  negative,
  neutral,
}: {
  title: string;
  value: string;
  change: string;
  icon: typeof Activity;
  negative?: boolean;
  neutral?: boolean;
}) {
  return (
    <section className="metric">
      <div className="metric-head">
        <span>{title}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <small
        className={neutral ? "neutral" : negative ? "negative" : "positive"}
      >
        {change}
      </small>
    </section>
  );
}
function Transaction({
  icon: Icon,
  name,
  detail,
  amount,
  positive,
}: {
  icon: typeof Activity;
  name: string;
  detail: string;
  amount: string;
  positive?: boolean;
}) {
  return (
    <div className="transaction">
      <span className="transaction-icon">
        <Icon size={17} />
      </span>
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
      <b className={positive ? "positive" : ""}>{amount}</b>
    </div>
  );
}

function CsvImportWizard({
  bootstrap,
  repository,
  close,
  refresh,
  invoker,
}: {
  bootstrap: Bootstrap;
  repository: Repository;
  close: () => void;
  refresh: () => void;
  invoker?: HTMLElement | null;
}) {
  const modal = useRef<HTMLElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const [inspection, setInspection] = useState<CsvInspection | null>(null),
    [mapping, setMapping] = useState<CsvMapping | null>(null),
    [preview, setPreview] = useState<CsvPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    modal.current
      ?.querySelector<HTMLElement>(
        "button:not([disabled]),input:not([disabled]),select:not([disabled])",
      )
      ?.focus();
    return () => invoker?.focus();
  }, []);
  useEffect(() => {
    if (error) queueMicrotask(() => errorRef.current?.focus());
  }, [error]);
  function keyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      close();
    }
    if (e.key === "Tab" && modal.current) {
      const f = [
        ...modal.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled])",
        ),
      ];
      if (!f.length) return;
      const first = f[0],
        last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  async function choose() {
    setBusy(true);
    setError("");
    try {
      const path = await repository.selectCsvSource?.();
      if (!path) return;
      const info = await repository.inspectCsv?.(path);
      if (!info) return;
      setInspection(info);
      setPreview(null);
      setMapping(
        info.savedMapping ?? {
          accountId: bootstrap.accounts[0]?.id ?? "",
          dateColumn: info.headers[0] ?? "",
          descriptionColumn: info.headers[1] ?? info.headers[0] ?? "",
          noteColumn: null,
          amountLayout: "signed",
          amountColumn: info.headers[2] ?? info.headers[0] ?? "",
          debitColumn: null,
          creditColumn: null,
          inflowPositive: true,
          dateFormat: "iso",
        },
      );
    } catch (x) {
      setError(errorMessage(x, "Could not read this CSV."));
    } finally {
      setBusy(false);
    }
  }
  async function showPreview() {
    if (!inspection || !mapping) return;
    setBusy(true);
    setError("");
    try {
      setPreview(
        (await repository.previewCsv?.(
          inspection.path,
          inspection.fileHash,
          mapping,
        )) ?? null,
      );
    } catch (x) {
      setError(errorMessage(x, "Could not preview this CSV."));
    } finally {
      setBusy(false);
    }
  }
  function updateRow(
    rowNumber: number,
    patch: Partial<CsvPreview["rows"][number]>,
  ) {
    setPreview((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((r) =>
              r.rowNumber === rowNumber ? { ...r, ...patch } : r,
            ),
          }
        : p,
    );
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await repository.commitCsv?.(
        preview,
        preview.rows.map((r) => ({
          rowNumber: r.rowNumber,
          categoryId: r.categoryId ?? "",
          include: r.include,
        })),
      );
      await Promise.resolve(refresh());
      close();
    } catch (x) {
      setError(errorMessage(x, "Could not import this CSV."));
    } finally {
      setBusy(false);
    }
  }
  const columns = inspection?.headers ?? [],
    option = (blank = false) => (
      <>
        {blank && <option value="">None</option>}
        {columns.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </>
    );
  return (
    <div className="modal-backdrop">
      <section
        ref={modal}
        className="card import-modal side-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onKeyDown={keyDown}
      >
        <h2 id="import-title">Import CSV</h2>
        {error && (
          <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        {!inspection ? (
          <>
            <p>Choose a UTF-8 CSV up to 10 MiB and 50,000 rows.</p>
            <div className="actions">
              <button disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={choose}>
                {busy ? "Reading…" : "Choose CSV…"}
              </button>
            </div>
          </>
        ) : !preview && mapping ? (
          <>
            <p>
              {inspection.rowCount} data rows found.
              {inspection.savedMapping && " A saved mapping was restored."}
            </p>
            <div className="import-grid">
              <label>
                Destination account
                <select
                  value={mapping.accountId}
                  onChange={(e) =>
                    setMapping({ ...mapping, accountId: e.target.value })
                  }
                >
                  {bootstrap.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date column
                <select
                  value={mapping.dateColumn}
                  onChange={(e) =>
                    setMapping({ ...mapping, dateColumn: e.target.value })
                  }
                >
                  {option()}
                </select>
              </label>
              <label>
                Description column
                <select
                  value={mapping.descriptionColumn}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      descriptionColumn: e.target.value,
                    })
                  }
                >
                  {option()}
                </select>
              </label>
              <label>
                Note column
                <select
                  value={mapping.noteColumn ?? ""}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      noteColumn: e.target.value || null,
                    })
                  }
                >
                  {option(true)}
                </select>
              </label>
              <label>
                Date format
                <select
                  value={mapping.dateFormat}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      dateFormat: e.target.value as CsvMapping["dateFormat"],
                    })
                  }
                >
                  <option value="iso">YYYY-MM-DD</option>
                  <option value="us">M/D/YYYY</option>
                </select>
              </label>
              <label>
                Amount layout
                <select
                  value={mapping.amountLayout}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      amountLayout: e.target
                        .value as CsvMapping["amountLayout"],
                    })
                  }
                >
                  <option value="signed">Signed amount</option>
                  <option value="debitCredit">Debit and credit</option>
                </select>
              </label>
              {mapping.amountLayout === "signed" ? (
                <>
                  <label>
                    Amount column
                    <select
                      value={mapping.amountColumn ?? ""}
                      onChange={(e) =>
                        setMapping({ ...mapping, amountColumn: e.target.value })
                      }
                    >
                      {option()}
                    </select>
                  </label>
                  <label>
                    Positive values are
                    <select
                      value={mapping.inflowPositive ? "inflow" : "outflow"}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          inflowPositive: e.target.value === "inflow",
                        })
                      }
                    >
                      <option value="inflow">Inflows</option>
                      <option value="outflow">Outflows</option>
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Debit column
                    <select
                      value={mapping.debitColumn ?? ""}
                      onChange={(e) =>
                        setMapping({ ...mapping, debitColumn: e.target.value })
                      }
                    >
                      {option()}
                    </select>
                  </label>
                  <label>
                    Credit column
                    <select
                      value={mapping.creditColumn ?? ""}
                      onChange={(e) =>
                        setMapping({ ...mapping, creditColumn: e.target.value })
                      }
                    >
                      {option()}
                    </select>
                  </label>
                </>
              )}
            </div>
            <div className="actions">
              <button disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={showPreview}>
                {busy ? "Previewing…" : "Preview"}
              </button>
            </div>
          </>
        ) : (
          preview && (
            <>
              <p>
                {preview.rows.filter((r) => r.include).length} of{" "}
                {preview.rows.length} rows selected. Duplicates are skipped by
                default.
              </p>
              <div className="import-preview">
                <table>
                  <thead>
                    <tr>
                      <th>Include</th>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Amount</th>
                      <th>Category</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include row ${r.rowNumber}`}
                            checked={r.include}
                            disabled={!r.valid}
                            onChange={(e) =>
                              updateRow(r.rowNumber, {
                                include: e.target.checked,
                              })
                            }
                          />
                        </td>
                        <td>{r.occurredOn ?? "—"}</td>
                        <td>{r.description}</td>
                        <td>
                          {r.amountCents == null ? "—" : money(r.amountCents)}
                        </td>
                        <td>
                          <select
                            aria-label={`Category row ${r.rowNumber}`}
                            value={r.categoryId ?? ""}
                            disabled={!r.valid}
                            onChange={(e) =>
                              updateRow(r.rowNumber, {
                                categoryId: e.target.value,
                              })
                            }
                          >
                            {bootstrap.categories
                              .filter((c) => c.kind === r.kind)
                              .map((c) => (
                                <option value={c.id} key={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td>
                          {r.error ??
                            (r.duplicate !== "none"
                              ? `Duplicate (${r.duplicate})`
                              : "Ready")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="actions">
                <button disabled={busy} onClick={() => setPreview(null)}>
                  Back
                </button>
                <button
                  className="primary"
                  disabled={busy || !preview.rows.some((r) => r.include)}
                  onClick={commit}
                >
                  {busy ? "Importing…" : "Import selected"}
                </button>
              </div>
            </>
          )
        )}
      </section>
    </div>
  );
}

function ActivityView({
  activity,
  accounts,
  repository,
  onEdit,
  onDelete,
  onImport,
  revealEntryId,
  onAdd,
  preferenceKey,
}: {
  activity: ActivityPosting[];
  accounts: BootstrapAccount[];
  repository: Repository;
  onEdit: (entry: ActivityPosting[], el?: HTMLElement) => void;
  onDelete: (entry: ActivityPosting[], el?: HTMLElement) => void;
  onImport: (el: HTMLElement) => void;
  revealEntryId: string | null;
  onAdd: (kind: "income" | "expense" | "transfer", el: HTMLElement) => void;
  preferenceKey: string;
}) {
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("all");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (revealEntryId) {
      setQuery("");
      setAccount("all");
      setYear("all");
    }
  }, [revealEntryId]);
  useEffect(() => {
    if (!revealEntryId || query || account !== "all" || year !== "all") return;
    requestAnimationFrame(() => {
      const target = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-search-kind="Activity"]',
        ),
      ].find((node) => node.dataset.searchId === revealEntryId);
      target?.scrollIntoView?.({ block: "center" });
      target?.focus();
    });
  }, [revealEntryId, query, account, year]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const grouped = [
    ...activity
      .reduce(
        (map, row) =>
          map.set(row.entryId, [...(map.get(row.entryId) ?? []), row]),
        new Map<string, ActivityPosting[]>(),
      )
      .values(),
  ];
  const rows = grouped.filter(
    (group) =>
      (account === "all" || group.some((x) => x.accountId === account)) &&
      (year === "all" || group[0].occurredOn.startsWith(year)) &&
      group.some((x) =>
        `${x.description} ${x.accountName} ${x.categoryName ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
  );
  const total = rows
    .filter((x) => x[0].kind !== "transfer")
    .reduce((sum, x) => sum + x[0].amountCents, 0);
  const filteredIncome = rows
      .filter((x) => x[0].kind === "income")
      .reduce((s, x) => s + x[0].amountCents, 0),
    filteredSpending = -rows
      .filter((x) => x[0].kind === "expense")
      .reduce((s, x) => s + x[0].amountCents, 0);
  const filteredTaxes = -rows
    .filter(
      (group) =>
        group[0].kind === "expense" && /tax/i.test(group[0].categoryName ?? ""),
    )
    .reduce((sum, group) => sum + group[0].amountCents, 0);
  const categoryDistribution = [
    ...rows
      .filter((group) => group[0].kind === "expense")
      .reduce((map, group) => {
        const name = group[0].categoryName || "Uncategorized";
        return map.set(
          name,
          (map.get(name) ?? 0) + Math.abs(group[0].amountCents),
        );
      }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);
  const years = [...new Set(activity.map((x) => x.occurredOn.slice(0, 4)))]
    .sort()
    .reverse();
  async function exportCsv() {
    if (
      exporting ||
      !rows.length ||
      !repository.selectActivityExportDestination ||
      !repository.exportActivityCsv
    )
      return;
    setExportError("");
    setExporting(true);
    try {
      const destination = await repository.selectActivityExportDestination();
      if (!destination) return;
      await repository.exportActivityCsv(
        destination,
        rows.flat().map((row) => row.postingId),
      );
    } catch (error) {
      setExportError(
        errorMessage(
          error,
          "Could not export Activity CSV. Choose another location and try again.",
        ),
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="content">
      <div className="toolbar">
        <AnchoredMenu
          primary
          label="Add transaction"
          icon={<Plus size={16} />}
          items={[
            { label: "Income", onSelect: (el) => onAdd("income", el!) },
            { label: "Expense", onSelect: (el) => onAdd("expense", el!) },
            { label: "Transfer", onSelect: (el) => onAdd("transfer", el!) },
          ]}
        />
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Search activity"
            placeholder="Search transactions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ActionButton
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((x) => !x)}
        >
          Filters
          <ChevronDown size={14} />
        </ActionButton>
        {filtersOpen && (
          <div className="filter-panel">
            <label htmlFor="activity-account">Account</label>
            <select
              id="activity-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="all">All accounts</option>
              {accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <label htmlFor="activity-year">Year</label>
            <select
              id="activity-year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="all">All years</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
        )}
        <AnchoredMenu
          label="Actions"
          items={[
            { label: "Import CSV", onSelect: (el) => onImport(el!) },
            {
              label: exporting ? "Exporting…" : "Export CSV",
              disabled: !rows.length || exporting,
              onSelect: exportCsv,
            },
          ]}
        />
      </div>
      {exportError && (
        <p className="form-error" role="alert">
          {exportError}
        </p>
      )}
      <section className="card wide">
        <div className="card-title">
          <div>
            <span className="label actual">Actual</span>
            <h3>Activity</h3>
          </div>
          <strong className={total < 0 ? "negative" : "positive"}>
            {money(total)}
          </strong>
        </div>
        {rows.map((group) => {
          const row = group[0],
            transfer = row.kind === "transfer",
            from = group.find((x) => x.amountCents < 0),
            to = group.find((x) => x.amountCents > 0);
          return (
            <div
              data-search-kind="Activity"
              data-search-id={row.entryId}
              className="transaction transaction-action"
              key={row.entryId}
              role="group"
              tabIndex={0}
              onClick={(event) => onEdit(group, event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onEdit(group, event.currentTarget);
                }
              }}
              aria-label={`Edit ${row.description || row.kind}`}
            >
              <span className="transaction-icon">
                {row.kind === "income" ? (
                  <ArrowDownRight size={17} />
                ) : transfer ? (
                  <WalletCards size={17} />
                ) : (
                  <ArrowUpRight size={17} />
                )}
              </span>
              <div>
                <strong>{row.description || row.kind}</strong>
                <small>
                  {transfer
                    ? `${from?.accountName} to ${to?.accountName}`
                    : `${row.accountName} · ${row.categoryName}`}{" "}
                  · {row.occurredOn}
                </small>
              </div>
              <b className={row.amountCents > 0 && !transfer ? "positive" : ""}>
                {transfer
                  ? money(Math.abs(from?.amountCents ?? 0))
                  : money(row.amountCents)}
              </b>
              <span
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <OverflowMenu
                  label={`More actions for ${row.description || row.kind}`}
                  items={[
                    {
                      label: "Edit transaction",
                      onSelect: (el) => onEdit(group, el ?? undefined),
                    },
                    {
                      label: "Delete transaction",
                      destructive: true,
                      onSelect: (el) => onDelete(group, el ?? undefined),
                    },
                  ]}
                />
              </span>
            </div>
          );
        })}
        {!rows.length && (
          <p className="empty">
            {activity.length
              ? "No activity matches these filters."
              : "No transactions have been recorded."}
          </p>
        )}
      </section>
      <DetailDisclosure label="View breakdown" storageKey={preferenceKey}>
        <div className="breakdown-grid">
          <Metric
            title="Income"
            value={money(filteredIncome)}
            change="Filtered activity"
            icon={ArrowDownRight}
          />
          <Metric
            title="Spending"
            value={money(filteredSpending)}
            change="Filtered activity"
            icon={ArrowUpRight}
            negative
          />
          <Metric
            title="Saved"
            value={money(filteredIncome - filteredSpending)}
            change="Income minus spending"
            icon={PiggyBank}
          />
          {filteredTaxes > 0 && (
            <Metric
              title="Taxes"
              value={money(filteredTaxes)}
              change="Tax-labeled spending"
              icon={CircleDollarSign}
              neutral
            />
          )}
        </div>
        {categoryDistribution.length > 0 && (
          <div aria-label="Filtered spending by category">
            <h3>Category distribution</h3>
            {categoryDistribution.map(([name, value]) => (
              <p key={name}>
                <span>{name}</span> <strong>{money(value)}</strong>
              </p>
            ))}
          </div>
        )}
      </DetailDisclosure>
    </div>
  );
}

const horizonLabel = (months: number) =>
  months % 12 === 0 ? `${months / 12}-year` : `${months}-month`;
const projectionMonthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

function RecurringDialog({
  state,
  bootstrap,
  repository,
  close,
  refresh,
}: {
  state: DialogState;
  bootstrap: Bootstrap;
  repository: Repository;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const record = state.recurring;
  const initialKind = record
    ? bootstrap.categories.find((c) => c.id === record.categoryId)?.kind ===
      "income"
      ? "income"
      : "expense"
    : (state.kind ?? "expense");
  const [kind, setKind] = useState<"income" | "expense">(initialKind);
  const available = bootstrap.categories.filter((c) => c.kind === kind);
  const [name, setName] = useState(record?.name ?? ""),
    [categoryId, setCategoryId] = useState(
      record?.categoryId ?? available[0]?.id ?? "",
    ),
    [accountId, setAccountId] = useState(record?.accountId ?? ""),
    [amount, setAmount] = useState(
      record ? String(record.amountCents / 100) : "",
    ),
    [frequency, setFrequency] = useState(record?.frequency ?? "monthly"),
    [startDate, setStartDate] = useState(record?.startDate ?? today()),
    [endDate, setEndDate] = useState(record?.endDate ?? ""),
    [growth, setGrowth] = useState(
      String((record?.annualGrowthBps ?? 0) / 100),
    ),
    [growthCap, setGrowthCap] = useState(
      record?.annualGrowthCapCents != null
        ? String(record.annualGrowthCapCents / 100)
        : "",
    ),
    [taxTreatment, setTaxTreatment] = useState(record?.taxTreatment ?? "none"),
    [incomeTaxCategory, setIncomeTaxCategory] = useState(
      record?.incomeTaxCategory ??
        (record?.incomeType === "salary" ? "wages" : "taxable-nonwage"),
    ),
    [ownerPersonId, setOwnerPersonId] = useState(
      record?.ownerPersonId ?? bootstrap.people[0]?.id ?? "",
    ),
    [annualGrowthMonth, setAnnualGrowthMonth] = useState(
      record?.annualGrowthMonth ?? 2,
    );
  const salary =
    kind === "income" &&
    available
      .find((category) => category.id === categoryId)
      ?.name.trim()
      .toLowerCase() === "salary";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!available.some((c) => c.id === categoryId))
      setCategoryId(available[0]?.id ?? "");
    if (kind === "income") setTaxTreatment("none");
  }, [kind]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const cents = parseMoney(amount),
      bps = parsePercent(growth),
      capCents = growthCap ? parseMoney(growthCap) : null;
    if (!name.trim()) return setError("Name is required.");
    if (!categoryId)
      return setError(`Create an ${kind} category before adding this input.`);
    if (cents == null || cents <= 0)
      return setError(
        "Enter a positive USD amount with no more than two decimal places.",
      );
    if (!startDate || (endDate && endDate < startDate))
      return setError("End date must be on or after the start date.");
    if (bps == null || bps < -10000 || bps > 100000)
      return setError(
        "Enter an annual growth rate within the supported range.",
      );
    if (salary && growthCap && (capCents == null || capCents < cents))
      return setError(
        "Enter a salary cap equal to or greater than the starting annual salary.",
      );
    if (
      kind === "income" &&
      (salary || incomeTaxCategory === "wages") &&
      !ownerPersonId
    )
      return setError("Select the household person who earns these wages.");
    if (
      taxTreatment === "pretax" &&
      (kind !== "expense" ||
        bootstrap.accounts.find((account) => account.id === accountId)?.kind !==
          "retirement")
    )
      return setError(
        "Pre-tax retirement contributions require a retirement account.",
      );
    setBusy(true);
    try {
      const input = {
        id: record?.id ?? crypto.randomUUID(),
        categoryId,
        accountId: salary ? null : accountId || null,
        name: name.trim(),
        amountCents: cents,
        frequency,
        startDate,
        endDate: endDate || null,
        annualGrowthBps: bps,
        taxTreatment,
        incomeType: salary ? ("salary" as const) : ("ordinary" as const),
        incomeTaxCategory: salary
          ? ("wages" as const)
          : kind === "income"
            ? incomeTaxCategory
            : undefined,
        ownerPersonId:
          kind === "income" && (salary || incomeTaxCategory === "wages")
            ? ownerPersonId
            : null,
        annualGrowthMonth: salary ? annualGrowthMonth : null,
        annualGrowthCapCents: salary ? capCents : null,
      };
      if (record)
        await repository.updateRecurring?.({
          ...input,
          expectedRevision: record.revision,
        });
      else await repository.createRecurring?.(input);
      await refresh();
      close();
    } catch (x) {
      setError(errorMessage(x, "Could not save this planning input."));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await repository.deleteRecurring?.({
        id: record!.id,
        expectedRevision: record!.revision,
      });
      await refresh();
      close();
    } catch (x) {
      setError(errorMessage(x, "Could not delete this planning input."));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="card entry-modal side-sheet"
        role={confirmDelete ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="recurring-title"
      >
        <h2 id="recurring-title">
          {confirmDelete
            ? "Delete planning input?"
            : record
              ? "Edit planning input"
              : "Add planning input"}
        </h2>
        {error && (
          <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        {confirmDelete ? (
          <>
            <p>
              This permanently removes {record?.name} from future projections.
            </p>
            <div className="actions">
              <button disabled={busy} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="danger" disabled={busy} onClick={remove}>
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>
              Type
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </label>
            <label>
              Name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Category
              <select
                aria-label="Recurring category"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  if (
                    bootstrap.categories
                      .find((category) => category.id === e.target.value)
                      ?.name.trim()
                      .toLowerCase() === "salary"
                  )
                    setFrequency("monthly");
                }}
              >
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {kind === "income" && !salary && (
              <label>
                Tax category
                <select
                  value={incomeTaxCategory}
                  onChange={(event) =>
                    setIncomeTaxCategory(
                      event.target.value as typeof incomeTaxCategory,
                    )
                  }
                >
                  <option value="taxable-nonwage">
                    Taxable non-wage income
                  </option>
                  <option value="wages">W-2 wages</option>
                  <option value="nontaxable">Nontaxable income</option>
                </select>
              </label>
            )}
            {kind === "income" && (salary || incomeTaxCategory === "wages") && (
              <label>
                Employee / owner
                <select
                  value={ownerPersonId}
                  onChange={(event) => setOwnerPersonId(event.target.value)}
                >
                  <option value="">Select…</option>
                  {bootstrap.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!salary && (
              <label>
                Account (optional)
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">No specific account</option>
                  {bootstrap.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {salary ? "Annual salary (USD)" : "Amount (USD)"}
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            {!salary && (
              <label>
                Frequency
                <select
                  value={frequency}
                  onChange={(e) =>
                    setFrequency(e.target.value as typeof frequency)
                  }
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </label>
            )}
            <label>
              Start date
              <input
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              End date (optional)
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <label>
              Annual growth (%)
              <input
                required
                inputMode="decimal"
                value={growth}
                onChange={(e) => setGrowth(e.target.value)}
              />
            </label>
            {salary && (
              <label>
                Maximum annual salary (USD, optional)
                <input
                  aria-label="Maximum annual salary (USD, optional)"
                  inputMode="decimal"
                  value={growthCap}
                  onChange={(e) => setGrowthCap(e.target.value)}
                />
                <small>
                  Annual raises stop once the projected salary reaches this
                  ceiling.
                </small>
              </label>
            )}
            {salary && (
              <label>
                Annual raise month
                <select
                  value={annualGrowthMonth}
                  onChange={(event) =>
                    setAnnualGrowthMonth(Number(event.target.value))
                  }
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {new Date(2026, index, 1).toLocaleString(undefined, {
                        month: "long",
                      })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!salary && (
              <label>
                Tax treatment
                <select
                  value={taxTreatment}
                  onChange={(e) =>
                    setTaxTreatment(
                      e.target.value as Exclude<
                        RecurringInput["taxTreatment"],
                        undefined
                      >,
                    )
                  }
                >
                  <option value="none">Paid after tax</option>
                  <option value="pretax" disabled={kind !== "expense"}>
                    Traditional workplace retirement contribution
                  </option>
                </select>
                <small>
                  The supported pre-tax preset reduces federal and California
                  income-tax wages, but not Social Security or Medicare wages.
                  It requires a retirement account.
                </small>
              </label>
            )}
            <div className="actions">
              {record && (
                <button
                  type="button"
                  className="danger-link"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </button>
              )}
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function ScenarioDialog({
  state,
  scenarios,
  repository,
  close,
  refresh,
  select,
}: {
  state: DialogState;
  scenarios: ScenarioRecord[];
  repository: Repository;
  close: () => void;
  refresh: () => Promise<void>;
  select: (id: string) => void;
}) {
  const editing = state.type === "scenario-edit",
    record = state.scenario;
  const [name, setName] = useState(
      editing ? (record?.name ?? "") : `${record?.name ?? "Baseline"} copy`,
    ),
    [clone, setClone] = useState(true),
    [inflation, setInflation] = useState(
      String((record?.assumptions.inflationBps ?? 250) / 100),
    ),
    [threshold, setThreshold] = useState(
      String((record?.assumptions.thresholdInflationBps ?? 250) / 100),
    ),
    [horizon, setHorizon] = useState(String(record?.horizonMonths ?? 120)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Scenario name is required.");
    if (
      scenarios.some(
        (s) =>
          s.id !== record?.id &&
          s.name.trim().toLowerCase() === name.trim().toLowerCase(),
      )
    )
      return setError("A scenario with this name already exists.");
    setBusy(true);
    try {
      if (editing) {
        const i = parsePercent(inflation),
          t = parsePercent(threshold),
          h = /^\d+$/.test(horizon) ? Number(horizon) : 0;
        if (
          i == null ||
          t == null ||
          i < -10000 ||
          i > 100000 ||
          t < -10000 ||
          t > 100000
        )
          throw {
            message: "Enter assumption rates within the supported range.",
          };
        if (h < 1 || h > 480)
          throw {
            message: "Projection horizon must be between 1 and 480 months.",
          };
        await repository.updateScenario?.({
          id: record!.id,
          name: name.trim(),
          assumptions: { inflationBps: i, thresholdInflationBps: t },
          horizonMonths: h,
          events: record!.events,
          defaultContributionAccountId: record!.defaultContributionAccountId,
          contributions: record!.contributions,
          withdrawals: record!.withdrawals,
          expectedRevision: record!.revision,
        });
        await refresh();
        select(record!.id);
      } else {
        const id = crypto.randomUUID();
        await repository.createScenario?.({
          id,
          name: name.trim(),
          cloneFromId: clone ? (record?.id ?? null) : null,
        });
        await refresh();
        select(id);
      }
      close();
    } catch (x) {
      setError(errorMessage(x, "Could not save this scenario."));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await repository.deleteScenario?.({
        id: record!.id,
        expectedRevision: record!.revision,
      });
      await refresh();
      const next = scenarios.find((s) => s.id !== record!.id)?.id ?? "";
      select(next);
      close();
    } catch (x) {
      setError(errorMessage(x, "Could not delete this scenario."));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="card modal entry-modal"
        role={confirmDelete ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="scenario-title"
      >
        <h2 id="scenario-title">
          {confirmDelete
            ? "Delete scenario?"
            : editing
              ? "Edit scenario"
              : "New scenario"}
        </h2>
        {error && (
          <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        {confirmDelete ? (
          <>
            <p>
              This permanently removes {record?.name}. The baseline and planning
              inputs remain.
            </p>
            <div className="actions">
              <button disabled={busy} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="danger" disabled={busy} onClick={remove}>
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>
              Name
              <input
                required
                disabled={record?.isBaseline}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {!editing && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={clone}
                  onChange={(e) => setClone(e.target.checked)}
                />{" "}
                Clone active scenario settings
              </label>
            )}
            {editing && (
              <>
                <label>
                  Inflation (%)
                  <input
                    inputMode="decimal"
                    required
                    value={inflation}
                    onChange={(e) => setInflation(e.target.value)}
                  />
                </label>
                <label>
                  Tax-threshold inflation (%)
                  <input
                    inputMode="decimal"
                    required
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                </label>
                <label>
                  Projection horizon (months)
                  <input
                    type="number"
                    min="1"
                    max="480"
                    required
                    value={horizon}
                    onChange={(e) => setHorizon(e.target.value)}
                  />
                </label>
              </>
            )}
            <div className="actions">
              {editing && !record?.isBaseline && (
                <button
                  type="button"
                  className="danger-link"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </button>
              )}
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save" : "Create scenario"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

type PlanViewProps = {
  projections: ReturnType<typeof ProjectionEngine.calculate>;
  scenarios: Scenario[];
  selectedScenarioId: string;
  onSelectScenario: (id: string) => void;
  excludedPropertyIds: ReadonlySet<string>;
  onToggleProperty: (assetId:string,included:boolean) => void;
  snapshot: FinancialSnapshot;
  expanded: number | null;
  setExpanded: (x: number | null) => void;
  recurring: RecurringEntry[];
  categories: Bootstrap["categories"];
  accounts: BootstrapAccount[];
  onAddRecurring: (kind: "income" | "expense", el: HTMLElement) => void;
  onEditRecurring: (entry: RecurringEntry, el: HTMLElement) => void;
  onAddScenario: (el: HTMLElement) => void;
  onEditScenario: (el: HTMLElement) => void;
  onPlanScenario: (el: HTMLElement, focusedEntry?: "event" | "contribution") => void;
  onEditPlannedProperty: (eventId:string,el:HTMLElement) => void;
  onPlanCurrentHome: (kind:"property-rental-start"|"adu-build",el:HTMLElement) => void;
  selectedSeries: string;
  onSelectSeries: (id: string) => void;
  range: 5 | 10 | 15 | 20 | "max";
  onRange: (range: 5 | 10 | 15 | 20 | "max") => void;
  preferenceKey: string;
};

type WealthSeries = {
  id: string;
  name: string;
  group: "net-worth" | "account" | "asset" | "private-stock" | "debt";
  component?: "vested" | "unvested";
};

function PlanView(props: PlanViewProps) {
  const {
    projections,
    scenarios,
    selectedScenarioId,
    onSelectScenario,
    excludedPropertyIds,
    onToggleProperty,
    snapshot,
    recurring,
    categories,
    accounts,
    onAddRecurring,
    onEditRecurring,
    onAddScenario,
    onEditScenario,
    onPlanScenario,
    onEditPlannedProperty,
    onPlanCurrentHome,
    selectedSeries: selected,
    onSelectSeries: setSelected,
    range,
    onRange: setRange,
    preferenceKey,
  } = props;
  const [tab, setTab] = useState<
    "wealth" | "cash-flow" | "contributions" | "setup"
  >("wealth");
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const [selectedCashFlowSeries, setSelectedCashFlowSeries] = useState<
    string[]
  >(["surplus"]);
  const [activeCashFlowPoint, setActiveCashFlowPoint] = useState<number | null>(
    null,
  );
  const [selectedPropertyId,setSelectedPropertyId]=useState("");
  const scenario =
    scenarios.find((item) => item.id === selectedScenarioId) ?? scenarios[0]!;
  const privateAssets = snapshot.assets.filter(
    (asset) => asset.privateStock || asset.equityHolding,
  );
  const ordinaryAssets = snapshot.assets.filter(
    (asset) => !asset.privateStock && !asset.equityHolding,
  );
  const plannedProperties=(scenario?.events??[]).filter((event):event is Extract<import("./domain").ScenarioEvent,{type:"asset-purchase"}>=>event.type==="asset-purchase");
  const currentHomeTransitions=(scenario?.events??[]).filter((event):event is Extract<import("./domain").ScenarioEvent,{type:"property-rental-start"}>=>event.type==="property-rental-start");
  const currentHomes=snapshot.assets.filter(asset=>asset.housingCosts||snapshot.liabilities.some(liability=>liability.mortgage?.assetId===asset.id));
  const currentHomeIds=new Set(currentHomes.map(home=>home.id));
  const currentHomeAduPlans=(scenario?.events??[]).filter((event):event is Extract<import("./domain").ScenarioEvent,{type:"adu-build"}>=>event.type==="adu-build"&&currentHomeIds.has(event.assetId));
  const currentHomePlanIds=[...new Set([...currentHomeTransitions.map(event=>event.assetId),...currentHomeAduPlans.map(event=>event.assetId)])];
  const selectedProperty=plannedProperties.find(item=>item.assetId===selectedPropertyId)??plannedProperties[0];
  const includedPlannedProperties=plannedProperties.filter(item=>!excludedPropertyIds.has(item.assetId));
  const series: WealthSeries[] = [
    { id: "net-worth", name: "Net Worth", group: "net-worth" },
    ...snapshot.accounts.map((item) => ({
      id: `account:${item.id}`,
      name: item.name,
      group: "account" as const,
    })),
    ...ordinaryAssets.map((item) => ({
      id: `asset:${item.id}`,
      name: item.name,
      group: "asset" as const,
    })),
    ...includedPlannedProperties.map((item)=>({id:`asset:${item.assetId}`,name:item.name,group:"asset" as const})),
    ...privateAssets.flatMap((item) => [
      {
        id: `private:${item.id}:vested`,
        name: `${item.name} — Vested`,
        group: "private-stock" as const,
        component: "vested" as const,
      },
      {
        id: `private:${item.id}:unvested`,
        name: `${item.name} — Unvested`,
        group: "private-stock" as const,
        component: "unvested" as const,
      },
    ]),
    ...snapshot.liabilities.map((item) => ({
      id: `debt:${item.id}`,
      name: item.name,
      group: "debt" as const,
    })),
    ...includedPlannedProperties.filter(item=>item.financing).map(item=>({id:`debt:${item.financing!.liabilityId}`,name:item.financing!.name,group:"debt" as const})),
  ];
  useEffect(() => {
    if (!series.some((item) => item.id === selected)) setSelected("net-worth");
  }, [selected, series.map((item) => item.id).join("|")]);
  const currentDate = localIsoDate();
  const currentValue = (item: WealthSeries) => {
    if (item.group === "net-worth")
      return (
        snapshot.accounts.reduce((sum, x) => sum + x.balanceCents, 0) +
        snapshot.assets.reduce(
          (sum, x) => sum + currentAssetValue(x, currentDate),
          0,
        ) -
        snapshot.liabilities.reduce((sum, x) => sum + x.balanceCents, 0)
      );
    const [, id, component] = item.id.split(":");
    if (item.group === "account")
      return snapshot.accounts.find((x) => x.id === id)?.balanceCents ?? 0;
    if (item.group === "asset")
      return snapshot.assets.find((x) => x.id === id)?.valueCents ?? 0;
    if (item.group === "debt")
      return snapshot.liabilities.find((x) => x.id === id)?.balanceCents ?? 0;
    const asset = snapshot.assets.find((x) => x.id === id);
    if (!asset) return 0;
    const vested = asset.equityHolding
        ? equityVestedValue(asset, currentDate)
        : vestedAssetValue(asset, currentDate),
      total = asset.equityHolding
        ? asset.equityHolding.grants.reduce(
            (sum, grant) =>
              sum +
              valueForUnits(
                grant.unitsMicros,
                projectedSharePrice(asset.equityHolding!, currentDate),
              ),
            0,
          )
        : asset.valueCents;
    return component === "vested" ? vested : total - vested;
  };
  const projectedValue = (
    item: WealthSeries,
    month: (typeof projections)[number]["months"][number],
  ) => {
    if (item.group === "net-worth") return month.netWorthCents ?? 0;
    const [, id, component] = item.id.split(":");
    if (item.group === "account") return month.balances?.accounts[id] ?? 0;
    if (item.group === "asset") return month.balances?.assets[id] ?? 0;
    if (item.group === "debt") return month.balances?.liabilities[id] ?? 0;
    const value = month.balances?.privateStock[id];
    return component === "vested"
      ? (value?.vestedCents ?? 0)
      : (value?.unvestedCents ?? 0);
  };
  const annualRows = projections
    .map((year) => ({
      year: year.year,
      month: [...year.months].reverse().find((item) => item.balances),
    }))
    .filter((row) => row.month) as {
    year: number;
    month: (typeof projections)[number]["months"][number];
  }[];
  const visibleRows = range === "max" ? annualRows : annualRows.slice(0, range);
  const activeSeries = series.find((item) => item.id === selected) ?? series[0];
  let estimatedWealthStart = currentValue(activeSeries);
  const estimatedWealthPoints = visibleRows.flatMap((row) => {
    const months =
        projections.find((year) => year.year === row.year)?.months ?? [],
      ending = projectedValue(activeSeries, row.month),
      result = months.map((month, index) => ({
        label: projectionMonthLabel(month.month),
        value: Math.round(
          estimatedWealthStart +
            ((ending - estimatedWealthStart) * (index + 1)) / months.length,
        ),
      }));
    estimatedWealthStart = ending;
    return result;
  });
  const points = [
    { label: "Current", value: currentValue(activeSeries) },
    ...estimatedWealthPoints,
  ];
  const first = points[0]?.value ?? 0,
    last = points.at(-1)?.value ?? first,
    change = last - first,
    percent =
      first === 0 ? null : Math.round((change / Math.abs(first)) * 1000) / 10;
  const values = points.map((point) => point.value),
    min = Math.min(...values, 0),
    max = Math.max(...values, 0),
    span = Math.max(1, max - min);
  const coords = points.map((point, index) => ({
    x: points.length === 1 ? 50 : 4 + (index * 92) / (points.length - 1),
    y: 8 + ((max - point.value) * 76) / span,
    ...point,
  }));
  const chartTickYs = [8, 27, 46, 65, 84];
  const wealthValueTicks = chartTickYs.map((y) => ({
    y,
    value: Math.round(max - ((y - 8) * span) / 76),
  }));
  const yearTickStep =
    visibleRows.length > 20 ? 5 : visibleRows.length > 10 ? 2 : 1;
  let wealthMonthOffset = 0;
  const wealthYearTicks = visibleRows
    .map((row) => {
      wealthMonthOffset +=
        projections.find((year) => year.year === row.year)?.months.length ?? 0;
      return {
        label: String(row.year),
        x: 4 + (wealthMonthOffset * 92) / Math.max(1, points.length - 1),
      };
    })
    .filter(
      (_, index) =>
        index % yearTickStep === 0 || index === visibleRows.length - 1,
    );
  const path = coords
    .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
    .join(" ");
  const homeCosts = snapshot.assets
    .filter((asset) => {
      const housing = asset.housingCosts,
        mortgage = snapshot.liabilities.some(
          (item) => item.mortgage?.assetId === asset.id,
        );
      return Boolean(
        housing &&
          (mortgage ||
            asset.purchaseDate ||
            asset.purchasePriceCents ||
            housing.propertyTaxRateBps ||
            housing.insuranceMonthlyCents ||
            housing.hoaMonthlyCents),
      );
    })
    .map((asset) => {
      const mortgage = snapshot.liabilities.find(
          (item) => item.mortgage?.assetId === asset.id,
        ),
        housing = asset.housingCosts!;
      const principalAndInterest = mortgage?.minimumPaymentCents ?? 0,
        propertyTax = Math.round(
          (californiaAssessedValue(asset, localIsoDate().slice(0, 7)) *
            housing.propertyTaxRateBps) /
            120000,
        ),
        insurance = housing.insuranceMonthlyCents,
        hoa = housing.hoaMonthlyCents;
      return {
        id: asset.id,
        name: asset.name,
        principalAndInterest,
        propertyTax,
        insurance,
        hoa,
        total: principalAndInterest + propertyTax + insurance + hoa,
      };
    });
  const selectSeries = (id: string) => {
    setSelected(id);
    setActivePoint(null);
  };
  const positiveMonths =
      projections[0]?.months.filter((month) => month.surplusCents > 0) ?? [],
    averageMonthlySurplus = positiveMonths.length
      ? positiveMonths.reduce((sum, month) => sum + month.surplusCents, 0) /
        positiveMonths.length
      : 0,
    effectiveAssignedBps = effectiveContributionBps(
      scenario?.contributions ?? [],
      averageMonthlySurplus,
    );
  const cashFlowSeries = [
    {
      id: "income",
      name: "Income",
      color: "#547ea8",
      value: (year: (typeof projections)[number]) => year.incomeCents,
    },
    {
      id: "spending",
      name: "Spending",
      color: "#9a7848",
      value: (year: (typeof projections)[number]) => year.expenseCents,
    },
    {
      id: "cash-taxes",
      name: "Cash taxes",
      color: "#a65e58",
      value: (year: (typeof projections)[number]) => year.cashTaxCents,
    },
    {
      id: "rsu-taxes",
      name: "RSU sell-to-cover",
      color: "#8669a5",
      value: (year: (typeof projections)[number]) =>
        year.rsuSellToCoverTaxCents,
    },
    {
      id: "surplus",
      name: "Surplus",
      color: "#6d9b72",
      value: (year: (typeof projections)[number]) => year.surplusCents,
    },
  ];
  const visibleCashFlowYears =
    range === "max" ? projections : projections.slice(0, range);
  const estimatedCashFlowMonths = visibleCashFlowYears.flatMap(
    (year, yearIndex) =>
      year.months.map((month, monthIndex) => ({
        month,
        year,
        yearIndex,
        monthIndex,
        monthsInYear: year.months.length,
      })),
  );
  const activeCashSeries = cashFlowSeries.filter((item) =>
    selectedCashFlowSeries.includes(item.id),
  );
  const estimatedCashValue = (
    item: (typeof cashFlowSeries)[number],
    point: (typeof estimatedCashFlowMonths)[number],
  ) => {
    const ending = item.value(point.year),
      previous = point.yearIndex
        ? item.value(visibleCashFlowYears[point.yearIndex - 1])
        : ending;
    return Math.round(
      previous +
        ((ending - previous) * (point.monthIndex + 1)) / point.monthsInYear,
    );
  };
  const cashValues = activeCashSeries.flatMap((item) =>
      estimatedCashFlowMonths.map((point) => estimatedCashValue(item, point)),
    ),
    cashMin = Math.min(...cashValues, 0),
    cashMax = Math.max(...cashValues, 0),
    cashSpan = Math.max(1, cashMax - cashMin);
  const cashCoords = (item: (typeof cashFlowSeries)[number]) =>
    estimatedCashFlowMonths.map((point, index) => {
      const value = estimatedCashValue(item, point);
      return {
        x:
          estimatedCashFlowMonths.length === 1
            ? 50
            : 4 + (index * 92) / (estimatedCashFlowMonths.length - 1),
        y: 8 + ((cashMax - value) * 76) / cashSpan,
        label: projectionMonthLabel(point.month.month),
        value,
      };
    });
  const cashValueTicks = chartTickYs.map((y) => ({
    y,
    value: Math.round(cashMax - ((y - 8) * cashSpan) / 76),
  }));
  let cashMonthOffset = 0;
  const cashYearTicks = visibleCashFlowYears
    .map((year) => {
      cashMonthOffset += year.months.length;
      return {
        label: String(year.year),
        x:
          4 +
          ((cashMonthOffset - 1) * 92) /
            Math.max(1, estimatedCashFlowMonths.length - 1),
      };
    })
    .filter(
      (_, index) =>
        index % yearTickStep === 0 || index === visibleCashFlowYears.length - 1,
    );
  const toggleCashFlowSeries = (id: string) => {
    setSelectedCashFlowSeries((current) =>
      current.includes(id)
        ? current.length === 1
          ? current
          : current.filter((item) => item !== id)
        : [...current, id],
    );
    setActiveCashFlowPoint(null);
  };
  const cell = (item: WealthSeries, value: number, key: string) => (
    <td key={key} className={selected === item.id ? "selected" : undefined}>
      <button
        onClick={() => selectSeries(item.id)}
        aria-label={`Select ${item.name}, ${money(value)}`}
        title={money(value)}
      >
        {money(value, true)}
        {item.group === "debt" && <small> owed</small>}
      </button>
    </td>
  );
  return (
    <div className="content plan-workspace">
      <div className="plan-toolbar">
        <div>
          <span className="label assumption">Plan</span>
          <h2>{scenario?.name ?? "Baseline"}</h2>
        </div>
        <div className="inline-actions">
          <label>
            Scenario
            <select
              data-search-kind="Scenario"
              data-search-id={selectedScenarioId}
              aria-label="Active scenario"
              value={selectedScenarioId}
              onChange={(event) => onSelectScenario(event.target.value)}
            >
              {scenarios.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <ActionButton
            tier="primary"
            onClick={(e) => onAddScenario(e.currentTarget)}
          >
            <Plus size={16} /> New scenario
          </ActionButton>
        </div>
      </div>
      <div className="plan-tabs" role="tablist" aria-label="Plan sections">
        {(["wealth", "cash-flow", "contributions", "setup"] as const).map(
          (item) => (
            <button
              key={item}
              role="tab"
              aria-selected={tab === item}
              onClick={() => setTab(item)}
            >
              {
                {
                  wealth: "Outlook",
                  "cash-flow": "Cash Flow",
                  contributions: "Contributions",
                  setup: "Scenario",
                }[item]
              }
            </button>
          ),
        )}
      </div>
      <label className="compact-section-select">
        Plan section
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value as typeof tab)}
        >
          <option value="wealth">Outlook</option>
          <option value="cash-flow">Cash Flow</option>
          <option value="contributions">Contributions</option>
          <option value="setup">Scenario</option>
        </select>
      </label>
      {tab === "wealth" && (
        <>
          <section
            className={`wealth-chart card wide series-${activeSeries.group}`}
            aria-labelledby="wealth-chart-title"
          >
            <div className="chart-heading">
              <div>
                <span className="label projected">Projected balance</span>
                <h3 id="wealth-chart-title">{activeSeries.name}</h3>
              </div>
              <div className="chart-ranges" aria-label="Projection range">
                {([5, 10, 15, 20, "max"] as const).map((item) => (
                  <button
                    key={item}
                    aria-pressed={range === item}
                    onClick={() => setRange(item)}
                  >
                    {item === "max" ? "Max" : `${item}Y`}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-y-axis" aria-hidden="true">
              {wealthValueTicks.map((tick) => (
                <span key={tick.y} style={{ top: `${tick.y}%` }}>
                  {money(tick.value, true)}
                </span>
              ))}
            </div>
            <div className="chart-x-axis" aria-hidden="true">
              {wealthYearTicks.map((tick) => (
                <span key={tick.label} style={{ left: `${tick.x}%` }}>
                  <i />
                  {tick.label}
                </span>
              ))}
            </div>
            <div className="wealth-summary" aria-live="polite">
              <strong>{money(first)}</strong>
              <span>Current</span>
              <strong>{money(last)}</strong>
              <span>Ending</span>
              <strong className={change >= 0 ? "positive" : "negative"}>
                {change >= 0 ? "+" : ""}
                {money(change)}{" "}
                {percent === null
                  ? "—"
                  : `(${percent >= 0 ? "+" : ""}${percent}%)`}
              </strong>
              <span>Total balance change</span>
            </div>
            <div
              className="chart-canvas"
              role="slider"
              tabIndex={0}
              aria-label={`Explore estimated ${activeSeries.name} by month`}
              aria-valuemin={0}
              aria-valuemax={Math.max(0, coords.length - 1)}
              aria-valuenow={activePoint ?? 0}
              aria-valuetext={coords[activePoint ?? 0] ? `${coords[activePoint ?? 0].label}, ${money(coords[activePoint ?? 0].value)} estimated` : undefined}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect(),
                  ratio = Math.max(
                    0,
                    Math.min(
                      1,
                      ((event.clientX - rect.left) / rect.width - 0.04) / 0.92,
                    ),
                  );
                setActivePoint(Math.round(ratio * (coords.length - 1)));
              }}
              onPointerLeave={() => setActivePoint(null)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                  return;
                event.preventDefault();
                setActivePoint((current) =>
                  Math.max(
                    0,
                    Math.min(
                      coords.length - 1,
                      (current ?? 0) + (event.key === "ArrowRight" ? 1 : -1),
                    ),
                  ),
                );
              }}
            >
              <svg
                viewBox="0 0 100 100"
                role="img"
                aria-label={`${activeSeries.name} projection from ${money(first)} to ${money(last)}`}
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient
                    id="wealth-chart-fill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--series)"
                      stopOpacity=".18"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--series)"
                      stopOpacity=".015"
                    />
                  </linearGradient>
                </defs>
                {[8, 27, 46, 65, 84].map((y) => (
                  <line
                    key={y}
                    className="chart-grid"
                    x1="4"
                    x2="96"
                    y1={y}
                    y2={y}
                  />
                ))}
                <line
                  className="chart-zero"
                  x1="4"
                  x2="96"
                  y1={8 + (max * 76) / span}
                  y2={8 + (max * 76) / span}
                />
                <path
                  className="chart-area"
                  d={`${path} L ${coords.at(-1)?.x ?? 96} 92 L 4 92 Z`}
                />
                <path className="chart-line" d={path} />
              </svg>
              {activePoint !== null && coords[activePoint] && (
                <>
                  <i
                    className="chart-scrub-line"
                    style={{ left: `${coords[activePoint].x}%` }}
                  />
                  <i
                    className="chart-scrub-point"
                    style={{
                      left: `${coords[activePoint].x}%`,
                      top: `${coords[activePoint].y}%`,
                    }}
                  />
                  <output
                    className="chart-tooltip"
                    style={{
                      left: `${coords[activePoint].x}%`,
                      top: `${coords[activePoint].y}%`,
                    }}
                  >
                    {coords[activePoint].label}
                    <strong>
                      {money(coords[activePoint].value)} estimated
                    </strong>
                  </output>
                </>
              )}
            </div>
          </section>
          <DetailDisclosure label="View annual wealth data" storageKey={`${preferenceKey}:annual-wealth`}>
          <section className="projection-sheet card wide" aria-label="Annual wealth projection">
            <div className="sheet-scroll">
              <table>
                <thead>
                  <tr>
                    <th rowSpan={3} className="year-column">
                      Year
                    </th>
                    <th colSpan={1}>Net Worth</th>
                    {snapshot.accounts.length > 0 && (
                      <th colSpan={snapshot.accounts.length}>Accounts</th>
                    )}
                    {snapshot.assets.length + includedPlannedProperties.length > 0 && (
                      <th
                        colSpan={
                          ordinaryAssets.length + includedPlannedProperties.length + privateAssets.length * 2
                        }
                      >
                        Assets
                      </th>
                    )}
                    {snapshot.liabilities.length + includedPlannedProperties.filter(item=>item.financing).length > 0 && (
                      <th colSpan={snapshot.liabilities.length + includedPlannedProperties.filter(item=>item.financing).length}>Debts</th>
                    )}
                  </tr>
                  <tr>
                    <th
                      rowSpan={2}
                      className={
                        selected === "net-worth" ? "selected" : undefined
                      }
                    >
                      <button
                        aria-pressed={selected === "net-worth"}
                        onClick={() => selectSeries("net-worth")}
                      >
                        Net Worth
                      </button>
                    </th>
                    {snapshot.accounts.map((item) => (
                      <th
                        rowSpan={2}
                        key={item.id}
                        className={
                          selected === `account:${item.id}`
                            ? "selected"
                            : undefined
                        }
                      >
                        <button
                          aria-pressed={selected === `account:${item.id}`}
                          onClick={() => selectSeries(`account:${item.id}`)}
                        >
                          {item.name}
                        </button>
                      </th>
                    ))}
                    {ordinaryAssets.map((item) => (
                      <th
                        rowSpan={2}
                        key={item.id}
                        className={
                          selected === `asset:${item.id}`
                            ? "selected"
                            : undefined
                        }
                      >
                        <button
                          aria-pressed={selected === `asset:${item.id}`}
                          onClick={() => selectSeries(`asset:${item.id}`)}
                        >
                          {item.name}
                        </button>
                      </th>
                    ))}
                    {includedPlannedProperties.map((item) => (
                      <th rowSpan={2} key={item.assetId} className={selected===`asset:${item.assetId}`?"selected":undefined}><button aria-pressed={selected===`asset:${item.assetId}`} onClick={()=>selectSeries(`asset:${item.assetId}`)}>{item.name}</button></th>
                    ))}
                    {privateAssets.map((item) => (
                      <th colSpan={2} key={item.id}>
                        <button
                          aria-pressed={
                            selected === `private:${item.id}:vested`
                          }
                          onClick={() =>
                            selectSeries(`private:${item.id}:vested`)
                          }
                        >
                          {item.name}
                        </button>
                      </th>
                    ))}
                    {snapshot.liabilities.map((item) => (
                      <th
                        rowSpan={2}
                        key={item.id}
                        className={
                          selected === `debt:${item.id}`
                            ? "selected"
                            : undefined
                        }
                      >
                        <button
                          aria-pressed={selected === `debt:${item.id}`}
                          onClick={() => selectSeries(`debt:${item.id}`)}
                        >
                          {item.name}
                        </button>
                      </th>
                    ))}
                    {includedPlannedProperties.filter(item=>item.financing).map(item=><th rowSpan={2} key={item.financing!.liabilityId} className={selected===`debt:${item.financing!.liabilityId}`?"selected":undefined}><button aria-pressed={selected===`debt:${item.financing!.liabilityId}`} onClick={()=>selectSeries(`debt:${item.financing!.liabilityId}`)}>{item.financing!.name}</button></th>)}
                  </tr>
                  <tr>
                    {privateAssets.flatMap((item) => [
                      <th
                        key={`${item.id}-v`}
                        className={
                          selected === `private:${item.id}:vested`
                            ? "selected"
                            : undefined
                        }
                      >
                        <button
                          aria-pressed={
                            selected === `private:${item.id}:vested`
                          }
                          onClick={() =>
                            selectSeries(`private:${item.id}:vested`)
                          }
                        >
                          Vested
                        </button>
                      </th>,
                      <th
                        key={`${item.id}-u`}
                        className={
                          selected === `private:${item.id}:unvested`
                            ? "selected"
                            : undefined
                        }
                      >
                        <button
                          aria-pressed={
                            selected === `private:${item.id}:unvested`
                          }
                          onClick={() =>
                            selectSeries(`private:${item.id}:unvested`)
                          }
                        >
                          Unvested
                        </button>
                      </th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th className="year-column" scope="row">
                      Current
                    </th>
                    {series.map((item) =>
                      cell(item, currentValue(item), `current-${item.id}`),
                    )}
                  </tr>
                  {visibleRows.map((row) => (
                    <tr key={row.year}>
                      <th className="year-column" scope="row">
                        {row.year}
                      </th>
                      {series.map((item) =>
                        cell(
                          item,
                          projectedValue(item, row.month),
                          `${row.year}-${item.id}`,
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          </DetailDisclosure>
          {currentHomes.length>0&&<section className="card wide current-home-plans" aria-labelledby="current-home-plans-title">
            <div className="card-title"><div><span className="label projected">Current homes</span><h3 id="current-home-plans-title">Rental and ADU plans</h3><p className="muted">Change a home you already own without creating another asset.</p></div><div className="current-home-actions"><ActionButton onClick={(event)=>onPlanCurrentHome("property-rental-start",event.currentTarget)}>Convert to rental</ActionButton><ActionButton onClick={(event)=>onPlanCurrentHome("adu-build",event.currentTarget)}>Plan ADU</ActionButton></div></div>
            {currentHomeTransitions.map(event=><div className="current-home-plan" key={event.id}><div><strong>{event.name}</strong><small>Rental starts {event.date} · {money(event.monthlyRentalIncomeCents)}/month</small></div><label className="property-inclusion-toggle"><input type="checkbox" checked={!excludedPropertyIds.has(event.assetId)} onChange={change=>onToggleProperty(event.assetId,change.target.checked)} /> Include in projection</label><button type="button" className="property-edit-button" onClick={click=>onEditPlannedProperty(event.id,click.currentTarget)}><Pencil size={14} aria-hidden="true"/> Edit</button></div>)}
            {currentHomeAduPlans.map(event=><div className="current-home-plan" key={event.id}><div><strong>{event.name}</strong><small>ADU build {event.date} · {money(event.costCents)}</small></div><label className="property-inclusion-toggle"><input type="checkbox" checked={!excludedPropertyIds.has(event.assetId)} onChange={change=>onToggleProperty(event.assetId,change.target.checked)} /> Include in projection</label><button type="button" className="property-edit-button" onClick={click=>onEditPlannedProperty(event.id,click.currentTarget)}><Pencil size={14} aria-hidden="true"/> Edit</button></div>)}
            {!currentHomeTransitions.length&&!currentHomeAduPlans.length&&<p className="empty">No rental conversion or ADU is planned for a current home.</p>}
            {currentHomePlanIds.filter(assetId=>!excludedPropertyIds.has(assetId)).map(assetId=>{const home=currentHomes.find(item=>item.id===assetId),rows=projections.map(year=>year.properties.find(item=>item.assetId===assetId)).filter((item):item is NonNullable<typeof item>=>Boolean(item));return <div className="current-home-outlook" key={assetId}><h4>{home?.name??"Current home"} outlook</h4><div className="property-table-scroll"><table><thead><tr><th>Year</th><th>Status</th><th>Home value</th><th>Mortgage</th><th>Equity</th><th>Base rent</th><th>ADU rent</th><th>Mortgage P&amp;I</th><th>Operating costs</th><th>ADU build</th><th>Net cash flow</th></tr></thead><tbody>{rows.map(item=>{const operating=item.propertyTaxCents+item.insuranceCents+item.hoaCents+item.maintenanceCents,net=item.rentCents+item.aduIncomeCents-item.principalCents-item.interestCents-operating-item.aduCostCents;return <tr key={item.year}><th>{item.year}</th><td><span className={`property-status-badge ${item.status}`}>{item.status}</span></td><td>{money(item.assetValueCents??0)}{item.aduAddedValueCents>0&&<small className="property-value-added">+{money(item.aduAddedValueCents)} ADU value</small>}</td><td>{money(item.mortgageBalanceCents??0)}</td><td className="property-emphasis">{money(item.equityCents??0)}</td><td>{money(item.rentCents)}</td><td>{money(item.aduIncomeCents)}</td><td>{money(item.principalCents+item.interestCents)}</td><td>{money(operating)}</td><td>{item.aduCostCents?money(item.aduCostCents):"—"}</td><td className={net<0?"property-negative":"property-positive"}>{money(net)}</td></tr>})}</tbody></table></div></div>})}
          </section>}
          {plannedProperties.length > 0 && selectedProperty && (
            <section
              className="card wide property-tracker"
              aria-labelledby="property-tracker-title"
            >
              <div className="property-tracker-heading">
                <div>
                  <span className="label projected">Planned property</span>
                  <h3 id="property-tracker-title">Property outlook</h3>
                  <p>Annual ownership, cash flow, and tax estimates.</p>
                </div>
                <div className="property-tracker-controls">
                  <label className="property-selector">
                    Property
                    <select
                      value={selectedProperty.assetId}
                      onChange={(event) => setSelectedPropertyId(event.target.value)}
                    >
                      {plannedProperties.map((item) => (
                        <option key={item.assetId} value={item.assetId}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="property-inclusion-toggle">
                    <input
                      type="checkbox"
                      checked={!excludedPropertyIds.has(selectedProperty.assetId)}
                      onChange={(event) =>
                        onToggleProperty(selectedProperty.assetId,event.target.checked)
                      }
                    />
                    Include in projection
                  </label>
                  <button
                    type="button"
                    className="property-edit-button"
                    onClick={(event) =>
                      onEditPlannedProperty(selectedProperty.id,event.currentTarget)
                    }
                  >
                    <Pencil size={14} aria-hidden="true" />
                    Edit property
                  </button>
                </div>
              </div>
              {!excludedPropertyIds.has(selectedProperty.assetId) && !selectedProperty.propertyDetails?.rentalTaxModelingEnabled && (
                <p className="property-tax-notice">
                  Rental tax modeling is not included. Owner housing costs and
                  property cash flow are still projected.
                </p>
              )}
              {excludedPropertyIds.has(selectedProperty.assetId) ? (
                <div className="property-excluded-state">
                  <span className="property-status-badge">Excluded</span>
                  <strong>{selectedProperty.name} is not included in this comparison.</strong>
                  <p>Turn it back on to restore its purchase, mortgage, ADU, income, costs, and linked events.</p>
                </div>
              ) : <div className="property-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th rowSpan={2} className="property-year">Year</th>
                      <th rowSpan={2} className="property-status">Status</th>
                      <th colSpan={3}>Position</th>
                      <th colSpan={3}>Annual cash flow</th>
                      <th rowSpan={2}>Net cash flow</th>
                      <th colSpan={2}>Rental tax</th>
                    </tr>
                    <tr>
                      <th>Home value</th>
                      <th>Mortgage</th>
                      <th>Equity</th>
                      <th>Rent</th>
                      <th>Mortgage P&amp;I</th>
                      <th>Operating costs</th>
                      <th>Taxable result</th>
                      <th>Est. effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projections
                      .map((year) =>
                        year.properties.find(
                          (item) => item.assetId === selectedProperty.assetId,
                        ),
                      )
                      .filter(
                        (item): item is NonNullable<typeof item> => Boolean(item),
                      )
                      .map((item) => {
                        const operating =
                            item.propertyTaxCents +
                            item.insuranceCents +
                            item.hoaCents +
                            item.maintenanceCents,
                          net =
                            item.rentCents +
                            item.aduIncomeCents -
                            item.principalCents -
                            item.interestCents -
                            operating -
                            item.aduCostCents;
                        return (
                          <tr key={item.year}>
                            <th className="property-year" scope="row">{item.year}</th>
                            <td className="property-status">
                              <span className={`property-status-badge ${item.status}`}>
                                {item.status}
                              </span>
                              {item.aduCostCents > 0 && (
                                <span className="property-event-badge">ADU build</span>
                              )}
                              {item.executionShortfallCents > 0 && (
                                <small>{money(item.executionShortfallCents)} short</small>
                              )}
                            </td>
                            <td>
                              {item.assetValueCents == null ? "—" : money(item.assetValueCents)}
                              {item.aduAddedValueCents > 0 && (
                                <small className="property-value-added">+{money(item.aduAddedValueCents)} ADU value</small>
                              )}
                            </td>
                            <td>{item.mortgageBalanceCents == null ? "—" : money(item.mortgageBalanceCents)}</td>
                            <td className="property-emphasis">{item.equityCents == null ? "—" : money(item.equityCents)}</td>
                            <td>{money(item.rentCents + item.aduIncomeCents)}</td>
                            <td>{money(item.principalCents + item.interestCents)}</td>
                            <td>{money(operating)}</td>
                            <td className={net < 0 ? "property-negative" : "property-positive"}>
                              {money(net)}
                              {item.aduCostCents > 0 && (
                                <small className="property-build-cost">Includes {money(item.aduCostCents)} build</small>
                              )}
                            </td>
                            <td>{item.rentalTaxModelingEnabled ? money(item.taxableRentalCents) : "—"}</td>
                            <td>{item.rentalTaxModelingEnabled ? money(item.estimatedTaxEffectCents) : "—"}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>}
            </section>
          )}
        </>
      )}
      {tab === "cash-flow" && (
        <>
          <section
            className="cash-flow-chart card wide"
            aria-labelledby="cash-flow-chart-title"
          >
            <div className="chart-heading">
              <div>
                <span className="label projected">
                  Projected annual cash flow
                </span>
                <h3 id="cash-flow-chart-title">
                  {activeCashSeries.map((item) => item.name).join(", ")}
                </h3>
              </div>
              <div
                className="chart-ranges"
                aria-label="Cash flow projection range"
              >
                {([5, 10, 15, 20, "max"] as const).map((item) => (
                  <button
                    key={item}
                    aria-pressed={range === item}
                    onClick={() => setRange(item)}
                  >
                    {item === "max" ? "Max" : `${item}Y`}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-y-axis" aria-hidden="true">
              {cashValueTicks.map((tick) => (
                <span key={tick.y} style={{ top: `${tick.y}%` }}>
                  {money(tick.value, true)}
                </span>
              ))}
            </div>
            <div className="chart-x-axis" aria-hidden="true">
              {cashYearTicks.map((tick) => (
                <span key={tick.label} style={{ left: `${tick.x}%` }}>
                  <i />
                  {tick.label}
                </span>
              ))}
            </div>
            <div className="cash-flow-legend" aria-live="polite">
              {activeCashSeries.map((item) => {
                const firstYear = visibleCashFlowYears[0],
                  lastYear = visibleCashFlowYears.at(-1);
                return (
                  <div key={item.id}>
                    <i style={{ background: item.color }} />
                    <span>{item.name}</span>
                    <strong>
                      {lastYear ? money(item.value(lastYear)) : "—"}
                    </strong>
                    <small>
                      {firstYear && lastYear
                        ? `${money(item.value(lastYear) - item.value(firstYear))} annual change`
                        : "Ending annual value"}
                    </small>
                  </div>
                );
              })}
            </div>
            <div
              className="chart-canvas"
              role="slider"
              tabIndex={0}
              aria-label="Explore estimated monthly cash flow"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, estimatedCashFlowMonths.length - 1)}
              aria-valuenow={activeCashFlowPoint ?? 0}
              aria-valuetext={estimatedCashFlowMonths[activeCashFlowPoint ?? 0] ? `${cashCoords(activeCashSeries[0])[activeCashFlowPoint ?? 0]?.label}, ${activeCashSeries.map(item => `${item.name} ${money(cashCoords(item)[activeCashFlowPoint ?? 0]?.value ?? 0)}`).join(", ")}` : undefined}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect(),
                  ratio = Math.max(
                    0,
                    Math.min(
                      1,
                      ((event.clientX - rect.left) / rect.width - 0.04) / 0.92,
                    ),
                  );
                setActiveCashFlowPoint(
                  Math.round(ratio * (estimatedCashFlowMonths.length - 1)),
                );
              }}
              onPointerLeave={() => setActiveCashFlowPoint(null)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                  return;
                event.preventDefault();
                setActiveCashFlowPoint((current) =>
                  Math.max(
                    0,
                    Math.min(
                      estimatedCashFlowMonths.length - 1,
                      (current ?? 0) + (event.key === "ArrowRight" ? 1 : -1),
                    ),
                  ),
                );
              }}
            >
              <svg
                viewBox="0 0 100 100"
                role="img"
                aria-label={`Cash flow projection for ${activeCashSeries.map((item) => item.name).join(", ")}`}
                preserveAspectRatio="none"
              >
                {[8, 27, 46, 65, 84].map((y) => (
                  <line
                    key={y}
                    className="chart-grid"
                    x1="4"
                    x2="96"
                    y1={y}
                    y2={y}
                  />
                ))}
                <line
                  className="chart-zero"
                  x1="4"
                  x2="96"
                  y1={8 + (cashMax * 76) / cashSpan}
                  y2={8 + (cashMax * 76) / cashSpan}
                />
                {activeCashSeries.map((item) => {
                  const coordinates = cashCoords(item),
                    path = coordinates
                      .map(
                        (point, index) =>
                          `${index ? "L" : "M"} ${point.x} ${point.y}`,
                      )
                      .join(" ");
                  return (
                    <g key={item.id} style={{ color: item.color }}>
                      <path
                        className="cash-chart-area"
                        d={`${path} L ${coordinates.at(-1)?.x ?? 96} 92 L 4 92 Z`}
                      />
                      <path className="cash-chart-line" d={path} />
                    </g>
                  );
                })}
              </svg>
              {activeCashFlowPoint !== null &&
                estimatedCashFlowMonths[activeCashFlowPoint] && (
                  <>
                    <i
                      className="chart-scrub-line"
                      style={{
                        left: `${cashCoords(activeCashSeries[0])[activeCashFlowPoint]?.x ?? 4}%`,
                      }}
                    />
                    {activeCashSeries.map((item) => {
                      const point = cashCoords(item)[activeCashFlowPoint];
                      return point ? (
                        <i
                          key={item.id}
                          className="chart-scrub-point"
                          style={{
                            left: `${point.x}%`,
                            top: `${point.y}%`,
                            borderColor: item.color,
                          }}
                        />
                      ) : null;
                    })}
                    <output
                      className="chart-tooltip cash-scrub-tooltip"
                      style={{
                        left: `${cashCoords(activeCashSeries[0])[activeCashFlowPoint]?.x ?? 4}%`,
                        top: `${Math.min(...activeCashSeries.map((item) => cashCoords(item)[activeCashFlowPoint]?.y ?? 92))}%`,
                      }}
                    >
                      {
                        cashCoords(activeCashSeries[0])[activeCashFlowPoint]
                          ?.label
                      }
                      {activeCashSeries.map((item) => (
                        <strong key={item.id}>
                          <i style={{ background: item.color }} />
                          {item.name}:{" "}
                          {money(
                            cashCoords(item)[activeCashFlowPoint]?.value ?? 0,
                          )}{" "}
                          estimated
                        </strong>
                      ))}
                    </output>
                  </>
                )}
            </div>
          </section>
          <section className="card wide">
            <div className="card-title">
              <div>
                <span className="label assumption">Inputs</span>
                <h3>Income and spending</h3>
              </div>
              <AnchoredMenu
                primary
                label="Add cash flow"
                icon={<Plus size={16} />}
                items={[
                  {
                    label: "Income",
                    onSelect: (el) => onAddRecurring("income", el!),
                  },
                  {
                    label: "Expense",
                    onSelect: (el) => onAddRecurring("expense", el!),
                  },
                ]}
              />
            </div>
            <DetailDisclosure
              label={`View income and expense details (${recurring.length + homeCosts.length})`}
              storageKey={`${preferenceKey}:cash-flow-inputs`}
            >
              {recurring.map((entry) => {
                const kind = categories.find(
                  (c) => c.id === entry.categoryId,
                )?.kind;
                return (
                  <button
                    key={entry.id}
                    className="transaction transaction-action"
                    onClick={(e) => onEditRecurring(entry, e.currentTarget)}
                  >
                    <div>
                      <strong>{entry.name}</strong>
                      <small>
                        {categories.find((c) => c.id === entry.categoryId)
                          ?.name ?? "Uncategorized"}{" "}
                        · {entry.frequency}
                      </small>
                    </div>
                    <b>
                      {money(
                        kind === "income"
                          ? entry.amountCents
                          : -entry.amountCents,
                      )}
                    </b>
                  </button>
                );
              })}
              {homeCosts.map((home) => (
                <div className="transaction" key={`home-${home.id}`}>
                  <div>
                    <strong>{home.name} housing</strong>
                    <small>
                      Automatic monthly expense · P&amp;I{" "}
                      {money(home.principalAndInterest)} + property tax{" "}
                      {money(home.propertyTax)} + insurance{" "}
                      {money(home.insurance)}
                      {home.hoa ? ` + HOA ${money(home.hoa)}` : ""}
                    </small>
                  </div>
                  <b>{money(-home.total)}</b>
                </div>
              ))}
            </DetailDisclosure>
          </section>
          <DetailDisclosure label="View annual cash flow data" storageKey={`${preferenceKey}:annual-cash-flow`}>
          <section className="card wide">
            <h3>Annual cash flow</h3>
            <p className="muted">
              Select one or more columns to compare them in the chart. Cash
              taxes reduce projected household cash. RSU sell-to-cover taxes
              reduce vested shares instead.
            </p>
            <div className="year-table cash-flow-table">
              <div className="year-row table-head">
                <span>Year</span>
                {cashFlowSeries.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={selectedCashFlowSeries.includes(item.id)}
                    onClick={() => toggleCashFlowSeries(item.id)}
                  >
                    <i style={{ background: item.color }} />
                    {item.name}
                  </button>
                ))}
              </div>
              {visibleCashFlowYears.map((year) => (
                <div className="year-row" key={year.year}>
                  <span>{year.year}</span>
                  <span>{money(year.incomeCents, true)}</span>
                  <span>{money(year.expenseCents, true)}</span>
                  <span>{money(year.cashTaxCents, true)}</span>
                  <span>{money(year.rsuSellToCoverTaxCents, true)}</span>
                  <strong>{money(year.surplusCents, true)}</strong>
                </div>
              ))}
            </div>
          </section>
          </DetailDisclosure>
          {projections.some((year) => year.taxLedger) && (
            <DetailDisclosure label="View yearly tax ledger" storageKey={`${preferenceKey}:tax-ledger`}>
            <section className="card wide">
              <h3>Yearly tax ledger</h3>
              {projections.map(
                (year) =>
                  year.taxLedger && (
                    <details key={year.year}>
                      <summary>
                        {year.year} · full-year liability{" "}
                        {money(year.taxLedger.fullYearLiabilityCents)} · future
                        cash flow {money(year.taxLedger.futureCashFlowCents)}
                      </summary>
                      <p>
                        {year.taxLedger.employees
                          .map(
                            (employee) =>
                              `${snapshot.household.people.find((person) => person.id === employee.personId)?.name ?? employee.personId}: wages ${money(employee.salaryCents)}, RSUs ${money(employee.rsuCents)}, Social Security ${money(employee.socialSecurityCents)}, Medicare ${money(employee.medicareCents)}, SDI ${money(employee.sdiCents)}`,
                          )
                          .join(" · ")}
                      </p>
                      <p>
                        Federal: standard{" "}
                        {money(year.taxLedger.federalStandardCents)} vs itemized{" "}
                        {money(year.taxLedger.federalItemizedCents)}; taxable{" "}
                        {money(year.taxLedger.federalTaxableCents)}; tax{" "}
                        {money(year.taxLedger.federalCents)}. California:
                        standard {money(year.taxLedger.californiaStandardCents)}{" "}
                        vs itemized{" "}
                        {money(year.taxLedger.californiaItemizedCents)}; taxable{" "}
                        {money(year.taxLedger.californiaTaxableCents)}; tax{" "}
                        {money(year.taxLedger.californiaCents)}.
                      </p>
                      <p>
                        Additional Medicare{" "}
                        {money(year.taxLedger.additionalMedicareCents)} · refund
                        or balance due unknown ·{" "}
                        {year.taxLedger.projected
                          ? "projected assumptions included"
                          : "official rules"}
                        .{" "}
                        {year.taxLedger.sources.map((source, index) => (
                          <span key={`${source.url}-${index}`}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.jurisdiction} source
                            </a>
                            {index < year.taxLedger!.sources.length - 1
                              ? " · "
                              : ""}
                          </span>
                        ))}
                      </p>
                    </details>
                  ),
              )}
            </section>
            </DetailDisclosure>
          )}
        </>
      )}
      {tab === "contributions" && (
        <section className="card wide">
          <div className="card-title">
            <div>
              <span className="label assumption">Surplus routing</span>
              <h3>Contributions</h3>
            </div>
            <AnchoredMenu primary label="Add contribution" icon={<Plus size={16}/>} items={[
              { label: "New contribution", onSelect: (el) => onPlanScenario(el!, "contribution") },
              { label: "Manage contributions", onSelect: (el) => onPlanScenario(el!) },
            ]}/>
          </div>
          <p>
            <strong>
              {effectiveAssignedBps / 100}% of projected surplus assigned
            </strong>{" "}
            · {(10000 - effectiveAssignedBps) / 100}% remaining
          </p>
          <p className="muted">
            Fixed monthly amounts are reserved first. Percentage rules divide
            the remaining Cash Flow surplus.
          </p>
          {scenario.contributions.map((rule) => (
            <div className="transaction" key={rule.id}>
              <div>
                <strong>{rule.destinationType} contribution</strong>
                <small>
                  {rule.frequency} ·{" "}
                  {rule.monthlyAmountCents !== undefined
                    ? `${money(rule.monthlyAmountCents)}/month · about ${averageMonthlySurplus ? Math.min(100, Math.round((rule.monthlyAmountCents * 10000) / averageMonthlySurplus) / 100) : 0}% of projected surplus`
                    : `${(rule.percentBps ?? 0) / 100}% of remaining surplus`}
                  {rule.targetBalanceCents !== undefined
                    ? ` · cap ${money(rule.targetBalanceCents)}`
                    : ""}
                </small>
              </div>
            </div>
          ))}
          {!scenario.contributions.length && (
            <p className="empty">
              All positive surplus remains in the default cash account.
            </p>
          )}
        </section>
      )}
      {tab === "setup" && (
        <section className="card wide">
          <div className="card-title">
            <div>
              <span className="label assumption">Scenario configuration</span>
              <h3>{scenario?.name}</h3>
            </div>
            <div className="inline-actions">
              <ActionButton onClick={(e) => onEditScenario(e.currentTarget)}>
                Edit scenario
              </ActionButton>
              <ActionButton onClick={(e) => onPlanScenario(e.currentTarget)}>
                Events &amp; withdrawals
              </ActionButton>
            </div>
          </div>
          <div className="setup-summary">
            <div>
              <span>Projection horizon</span>
              <strong>
                {scenario ? `${scenario.horizon.months} months` : "—"}
              </strong>
            </div>
            <div>
              <span>Inflation assumption</span>
              <strong>
                {scenario ? `${scenario.assumptions.inflationBps / 100}%` : "—"}
              </strong>
            </div>
            <div>
              <span>Events</span>
              <strong>{scenario?.events.length ?? 0}</strong>
            </div>
            <div>
              <span>Contribution rules</span>
              <strong>{scenario?.contributions.length ?? 0}</strong>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function NetWorth({
  snapshot,
  accounts,
  assets: assetRecords,
  liabilities: liabilityRecords,
  onAdd,
  onEdit,
  onDelete,
  onReconcile,
  onAddAsset,
  onAddLiability,
  onEditAsset,
  onDeleteAsset,
  onEditLiability,
  onDeleteLiability,
}: {
  snapshot: FinancialSnapshot;
  accounts: BootstrapAccount[];
  assets: Asset[];
  liabilities: Liability[];
  onAdd: (el: HTMLElement) => void;
  onEdit: (a: BootstrapAccount, el: HTMLElement) => void;
  onDelete: (a: BootstrapAccount, el: HTMLElement) => void;
  onReconcile: (a: BootstrapAccount, el: HTMLElement) => void;
  onAddAsset: (el: HTMLElement) => void;
  onAddLiability: (el: HTMLElement) => void;
  onEditAsset: (a: Asset, el: HTMLElement) => void;
  onDeleteAsset: (a: Asset, el: HTMLElement) => void;
  onEditLiability: (l: Liability, el: HTMLElement) => void;
  onDeleteLiability: (l: Liability, el: HTMLElement) => void;
}) {
  const assets =
      snapshot.accounts.reduce((s, a) => s + Math.max(0, a.balanceCents), 0) +
      snapshot.assets.reduce(
        (s, a) => s + currentAssetValue(a, localIsoDate()),
        0,
      ),
    debt =
      snapshot.liabilities.reduce((s, l) => s + l.balanceCents, 0) +
      snapshot.accounts.reduce((s, a) => s + Math.max(0, -a.balanceCents), 0),
    netWorth =
      snapshot.accounts.reduce((s, a) => s + a.balanceCents, 0) +
      snapshot.assets.reduce(
        (s, a) => s + currentAssetValue(a, localIsoDate()),
        0,
      ) -
      snapshot.liabilities.reduce((s, l) => s + l.balanceCents, 0);
  return (
    <div className="content">
      <div className="metrics">
        <Metric
          title="Total assets"
          value={money(assets)}
          change={`${snapshot.accounts.length + snapshot.assets.length} accounts & assets`}
          icon={WalletCards}
          neutral
        />
        <Metric
          title="Total debt"
          value={money(debt)}
          change={`${snapshot.liabilities.length} liabilities`}
          icon={Building2}
          neutral
        />
        <Metric
          title="Net worth"
          value={money(netWorth)}
          change="Current"
          icon={Landmark}
        />
      </div>
      <section
        className="card wide"
        aria-label={`Asset allocation. ${money(assets)} in assets. ${money(debt)} in debt excluded from allocation.`}
      >
        <div className="card-title">
          <div>
            <span className="label actual">Current balance</span>
            <h3>Asset allocation</h3>
          </div>
          <AnchoredMenu
            primary
            label="Add holding"
            icon={<Plus size={16} />}
            items={[
              { label: "Account", onSelect: (el) => onAdd(el!) },
              { label: "Asset", onSelect: (el) => onAddAsset(el!) },
              { label: "Debt", onSelect: (el) => onAddLiability(el!) },
            ]}
          />
        </div>
        <p>
          <strong>{money(assets)}</strong> allocated across accounts and assets.
          Debt of <strong>{money(debt)}</strong> is shown separately and
          excluded from allocation proportions.
        </p>
      </section>
      <section className="card wide">
        <div className="card-title">
          <div>
            <span className="label actual">Current balance</span>
            <h3>Accounts & assets</h3>
          </div>
        </div>
        {snapshot.accounts
          .filter((a) => a.balanceCents >= 0)
          .map((a) => (
            <div
              className="account"
              key={a.id}
              role="group"
              tabIndex={0}
              data-search-kind="Account"
              data-search-id={a.id}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest(".anchored-menu"))
                  onEdit(accounts.find((x) => x.id === a.id)!, e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (
                  (e.key === "Enter" || e.key === " ") &&
                  !(e.target as HTMLElement).closest(".anchored-menu")
                ) {
                  e.preventDefault();
                  onEdit(accounts.find((x) => x.id === a.id)!, e.currentTarget);
                }
              }}
            >
              <span className="transaction-icon">
                <WalletCards size={17} />
              </span>
              <div>
                <strong>{a.name}</strong>
                <small>{a.kind}</small>
              </div>
              <b>{money(a.balanceCents)}</b>
              <OverflowMenu
                label={`More actions for ${a.name}`}
                items={[
                  {
                    label: "Edit account",
                    onSelect: (el) =>
                      onEdit(accounts.find((x) => x.id === a.id)!, el!),
                  },
                  {
                    label: "Reconcile",
                    onSelect: (el) =>
                      onReconcile(accounts.find((x) => x.id === a.id)!, el!),
                  },
                  {
                    label: "Delete account",
                    danger: true,
                    onSelect: (el) =>
                      onDelete(accounts.find((x) => x.id === a.id)!, el!),
                  },
                ]}
              />
            </div>
          ))}
        {assetRecords.map((a) => (
          <div
            className="account"
            key={a.id}
            role="group"
            tabIndex={0}
            data-search-kind="Asset"
            data-search-id={a.id}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest(".anchored-menu"))
                onEditAsset(a, e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (
                (e.key === "Enter" || e.key === " ") &&
                !(e.target as HTMLElement).closest(".anchored-menu")
              ) {
                e.preventDefault();
                onEditAsset(a, e.currentTarget);
              }
            }}
          >
            <span className="transaction-icon">
              <Building2 size={17} />
            </span>
            <div>
              <strong>{a.name}</strong>
              <small>
                {a.equityHolding
                  ? `Private stock holding · ${a.equityHolding.grants.length} RSU grants`
                  : a.privateStock
                    ? "Private stock"
                    : liabilityRecords.find((l) => l.mortgage?.assetId === a.id)
                      ? `Home · linked to ${liabilityRecords.find((l) => l.mortgage?.assetId === a.id)!.name}`
                      : "Asset"}
              </small>
              {a.privateStock && (
                <small>
                  {money(a.valueCents)} total company value ·{" "}
                  {money(a.valueCents - vestedAssetValue(a, localIsoDate()))}{" "}
                  unvested
                </small>
              )}
              {a.equityHolding && (
                <>
                  <small>
                    {units(
                      a.equityHolding.grants.reduce(
                        (sum, grant) => sum + grant.unitsMicros,
                        0,
                      ),
                    )}{" "}
                    total units ·{" "}
                    {units(
                      a.equityHolding.grants.reduce(
                        (sum, grant) =>
                          sum + vestedUnitsAt(grant, localIsoDate()),
                        0,
                      ),
                    )}{" "}
                    vested · {money(a.valueCents)} total modeled value
                  </small>
                  <details>
                    <summary>
                      View {a.equityHolding.grants.length} grant schedules
                    </summary>
                    {a.equityHolding.grants.map((grant) => {
                      const vested = vestedUnitsAt(grant, localIsoDate()),
                        upcoming = nextVest(grant, localIsoDate());
                      return (
                        <div key={grant.id}>
                          <strong>
                            {grant.id === "original"
                              ? "Original grant"
                              : grant.id === "promotion"
                                ? "Promotion grant"
                                : grant.id}
                          </strong>
                          <small>
                            Granted {grant.grantDate} ·{" "}
                            {units(grant.unitsMicros)} units at{" "}
                            {money(grant.grantPriceCents)} · {units(vested)}{" "}
                            vested
                          </small>
                          <small>
                            {upcoming
                              ? `Next: ${units(upcoming.unitsMicros)} units on ${upcoming.date}`
                              : "Fully vested"}
                          </small>
                        </div>
                      );
                    })}
                  </details>
                </>
              )}
              {a.purchasePriceCents != null && a.purchasePriceCents > 0 && (
                <small>
                  {money(a.valueCents - a.purchasePriceCents)} (
                  {((a.valueCents / a.purchasePriceCents - 1) * 100).toFixed(1)}
                  %) since purchase
                </small>
              )}
            </div>
            <b>
              {money(
                a.equityHolding
                  ? equityVestedValue(a, localIsoDate())
                  : vestedAssetValue(a, localIsoDate()),
              )}
            </b>
            <OverflowMenu
              label={`More actions for ${a.name}`}
              items={[
                { label: "Edit asset", onSelect: (el) => onEditAsset(a, el!) },
                {
                  label: "Delete asset",
                  danger: true,
                  onSelect: (el) => onDeleteAsset(a, el!),
                },
              ]}
            />
          </div>
        ))}
        {!snapshot.accounts.length && !snapshot.assets.length && (
          <p className="empty">No accounts or assets yet.</p>
        )}
      </section>
      <section className="card wide">
        <div className="card-title">
          <div>
            <span className="label actual">Current balance</span>
            <h3>Credit & liabilities</h3>
          </div>
        </div>
        {snapshot.accounts
          .filter((a) => a.balanceCents < 0)
          .map((a) => (
            <div
              className="account"
              key={a.id}
              role="group"
              tabIndex={0}
              data-search-kind="Account"
              data-search-id={a.id}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest(".anchored-menu"))
                  onEdit(accounts.find((x) => x.id === a.id)!, e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (
                  (e.key === "Enter" || e.key === " ") &&
                  !(e.target as HTMLElement).closest(".anchored-menu")
                ) {
                  e.preventDefault();
                  onEdit(accounts.find((x) => x.id === a.id)!, e.currentTarget);
                }
              }}
            >
              <span className="transaction-icon">
                <WalletCards size={17} />
              </span>
              <div>
                <strong>{a.name}</strong>
                <small>Credit balance</small>
              </div>
              <b>{money(-a.balanceCents)}</b>
              <OverflowMenu
                label={`More actions for ${a.name}`}
                items={[
                  {
                    label: "Edit account",
                    onSelect: (el) =>
                      onEdit(accounts.find((x) => x.id === a.id)!, el!),
                  },
                  {
                    label: "Reconcile",
                    onSelect: (el) =>
                      onReconcile(accounts.find((x) => x.id === a.id)!, el!),
                  },
                  {
                    label: "Delete account",
                    danger: true,
                    onSelect: (el) =>
                      onDelete(accounts.find((x) => x.id === a.id)!, el!),
                  },
                ]}
              />
            </div>
          ))}
        {liabilityRecords.map((l) => (
          <div
            className="account"
            key={l.id}
            role="group"
            tabIndex={0}
            data-search-kind="Debt"
            data-search-id={l.id}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest(".anchored-menu"))
                onEditLiability(l, e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (
                (e.key === "Enter" || e.key === " ") &&
                !(e.target as HTMLElement).closest(".anchored-menu")
              ) {
                e.preventDefault();
                onEditLiability(l, e.currentTarget);
              }
            }}
          >
            <span className="transaction-icon">
              <Building2 size={17} />
            </span>
            <div>
              <strong>{l.name}</strong>
              <small>Liability</small>
            </div>
            <b>{money(l.balanceCents)}</b>
            <OverflowMenu
              label={`More actions for ${l.name}`}
              items={[
                {
                  label: "Edit debt",
                  onSelect: (el) => onEditLiability(l, el!),
                },
                {
                  label: "Delete debt",
                  danger: true,
                  onSelect: (el) => onDeleteLiability(l, el!),
                },
              ]}
            />
          </div>
        ))}
        {debt === 0 && (
          <p className="empty">No credit balances or liabilities.</p>
        )}
      </section>
    </div>
  );
}
function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  )
    return (error as { message: string }).message;
  return fallback;
}
function SettingsView({
  settings,
  setSettings,
  bootstrap,
  repository,
  onSaved,
  onRestore,
}: {
  settings: Bootstrap["settings"];
  setSettings: (
    x:
      | Bootstrap["settings"]
      | ((old: Bootstrap["settings"]) => Bootstrap["settings"]),
  ) => void;
  bootstrap: Bootstrap;
  repository: Repository;
  onSaved: () => void;
  onRestore: (value: BootstrapInput) => void;
}) {
  const [people, setPeople] = useState<BootstrapPerson[]>(
    bootstrap.people.map((person) => ({
      ...person,
      birthDate: displayBirthDate(person.birthDate),
    })),
  );
  const [message, setMessage] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dataResult, setDataResult] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const dataAlert = useRef<HTMLParagraphElement>(null);
  const restoreCancel = useRef<HTMLButtonElement>(null);
  const resetCancel = useRef<HTMLButtonElement>(null);
  const confirmationInvoker = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!confirmRestore && !confirmReset) return;
    const key = (event: globalThis.KeyboardEvent) => {
      const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
      if (event.key === "Escape") { event.preventDefault(); setConfirmRestore(false); setConfirmReset(false); return; }
      if (event.key !== "Tab" || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); queueMicrotask(() => confirmationInvoker.current?.focus()); };
  }, [confirmRestore, confirmReset]);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "household" | "tax" | "appearance" | "data"
  >("household");
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberResult, setMemberResult] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const memberAlert = useRef<HTMLParagraphElement>(null);
  const [filingStatus, setFilingStatus] = useState<TaxProfile["filingStatus"]>(
      bootstrap.taxProfile?.filingStatus ?? "single",
    ),
    [jointMembers, setJointMembers] = useState<[string, string]>(() => {
      const ids = bootstrap.taxProfile?.taxUnit?.memberPersonIds ?? [];
      return [
        ids[0] ?? bootstrap.people[0]?.id ?? "",
        ids[1] ?? bootstrap.people[1]?.id ?? "",
      ];
    }),
    [taxSaving, setTaxSaving] = useState(false),
    [taxResult, setTaxResult] = useState<{
      kind: "error" | "success";
      message: string;
    } | null>(null);
  useEffect(() => {
    if (memberResult?.kind === "error") memberAlert.current?.focus();
  }, [memberResult]);
  useEffect(
    () =>
      setPeople(
        bootstrap.people.map((person) => ({
          ...person,
          birthDate: displayBirthDate(person.birthDate),
        })),
      ),
    [bootstrap.people],
  );
  useEffect(() => {
    setFilingStatus(bootstrap.taxProfile?.filingStatus ?? "single");
    const ids = bootstrap.taxProfile?.taxUnit?.memberPersonIds ?? [];
    setJointMembers([
      ids[0] ?? bootstrap.people[0]?.id ?? "",
      ids[1] ?? bootstrap.people[1]?.id ?? "",
    ]);
  }, [bootstrap.taxProfile, bootstrap.people]);
  async function createBackup() {
    if (backupBusy || restoreBusy) return;
    setBackupBusy(true);
    setDataResult(null);
    try {
      if (!repository.selectBackupDestination || !repository.backupDatabase)
        throw new Error("Backup is unavailable.");
      const destination = await repository.selectBackupDestination();
      if (destination === null) return;
      await repository.backupDatabase(destination);
      setDataResult({
        kind: "success",
        message: "Backup created successfully.",
      });
    } catch (error) {
      setDataResult({
        kind: "error",
        message: errorMessage(error, "Could not create the backup."),
      });
      queueMicrotask(() => dataAlert.current?.focus());
    } finally {
      setBackupBusy(false);
    }
  }
  async function restoreBackup() {
    if (backupBusy || restoreBusy) return;
    setConfirmRestore(false);
    setRestoreBusy(true);
    setDataResult(null);
    try {
      if (!repository.selectRestoreSource || !repository.restoreDatabase)
        throw new Error("Restore is unavailable.");
      const source = await repository.selectRestoreSource();
      if (source === null) return;
      const restored = await repository.restoreDatabase(source);
      onRestore(restored);
      setDataResult({
        kind: "success",
        message: "Backup restored successfully.",
      });
    } catch (error) {
      const value = error as { code?: string };
      const fallback =
        value?.code === "invalid_backup" ||
        value?.code === "incompatible_backup"
          ? "That file is not a compatible LifeLook backup."
          : "Could not restore the backup. Your current data is still available.";
      setDataResult({ kind: "error", message: errorMessage(error, fallback) });
      queueMicrotask(() => dataAlert.current?.focus());
    } finally {
      setRestoreBusy(false);
    }
  }
  async function resetProfile() {
    if (backupBusy || restoreBusy) return;
    setConfirmReset(false);
    setRestoreBusy(true);
    setDataResult(null);
    try {
      if (!repository.resetProfile)
        throw new Error("Profile reset is unavailable.");
      const reset = await repository.resetProfile();
      onRestore(reset);
    } catch (error) {
      setDataResult({
        kind: "error",
        message: errorMessage(
          error,
          "Could not reset the profile. Your current data is still available.",
        ),
      });
      queueMicrotask(() => dataAlert.current?.focus());
    } finally {
      setRestoreBusy(false);
    }
  }
  async function saveAppearance(patch: Partial<Bootstrap["settings"]>) {
    const next = { ...settings, ...patch };
    setAppearanceSaving(true);
    setMessage("");
    try {
      if (!repository.updateSettings)
        throw new Error("Settings persistence is unavailable.");
      const saved = await repository.updateSettings({
        theme: next.theme,
        reducedMotion: next.reducedMotion,
        expectedRevision: settings.revision,
      });
      setSettings(saved);
      setMessage("Appearance saved.");
    } catch (e) {
      setMessage(
        (e as { message?: string }).message ?? "Could not save appearance.",
      );
    } finally {
      setAppearanceSaving(false);
    }
  }
  async function savePeople() {
    if (memberSaving) return;
    setMemberResult(null);
    if (people.some((p) => !p.name.trim())) {
      setMemberResult({
        kind: "error",
        message: "Every household member needs a name.",
      });
      return;
    }
    const invalidDate = people.findIndex(
      (person) => parseBirthDate(person.birthDate) === undefined,
    );
    if (invalidDate >= 0) {
      setMemberResult({
        kind: "error",
        message: `Member ${invalidDate + 1}: enter a valid birth date as MM/DD/YYYY.`,
      });
      return;
    }
    setMemberSaving(true);
    try {
      await repository.saveOnboardingStep(8, {
        people: people.map((p) => ({
          ...p,
          name: p.name.trim(),
          birthDate: parseBirthDate(p.birthDate),
        })),
      });
      setMemberResult({ kind: "success", message: "Household members saved." });
      onSaved();
    } catch (error) {
      setMemberResult({
        kind: "error",
        message: errorMessage(error, "Could not save household members."),
      });
    } finally {
      setMemberSaving(false);
    }
  }
  async function saveTaxProfile() {
    setTaxResult(null);
    if (
      filingStatus === "married-joint" &&
      (!jointMembers[0] ||
        !jointMembers[1] ||
        jointMembers[0] === jointMembers[1])
    ) {
      setTaxResult({
        kind: "error",
        message:
          "Married filing jointly requires two distinct household people.",
      });
      return;
    }
    setTaxSaving(true);
    try {
      await repository.saveOnboardingStep(8, {
        taxProfile: {
          filingStatus,
          state: "CA",
          taxYear: 2026,
          thresholdInflationBps:
            bootstrap.taxProfile?.thresholdInflationBps ?? 250,
          revision: bootstrap.taxProfile?.revision ?? 1,
          taxUnit: {
            id:
              bootstrap.taxProfile?.taxUnit?.id ??
              `${bootstrap.household?.id ?? "household"}-tax-unit`,
            filingStatus,
            memberPersonIds:
              filingStatus === "married-joint"
                ? jointMembers
                : [jointMembers[0]].filter(Boolean),
          },
        },
      });
      setTaxResult({ kind: "success", message: "Joint filing link saved." });
      onSaved();
    } catch (error) {
      setTaxResult({
        kind: "error",
        message: errorMessage(error, "Could not save the tax profile."),
      });
    } finally {
      setTaxSaving(false);
    }
  }
  return (
    <div className="content settings-workspace">
      <nav className="settings-nav" aria-label="Settings sections">
        {(
          [
            ["household", "Household"],
            ["tax", "Tax"],
            ["appearance", "Appearance"],
            ["data", "Data & Privacy"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-current={settingsSection === id ? "page" : undefined}
            className={settingsSection === id ? "active" : undefined}
            onClick={() => setSettingsSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <label className="compact-section-select settings-section-select">
        Settings section
        <select value={settingsSection} onChange={(event) => setSettingsSection(event.target.value as typeof settingsSection)}>
          <option value="household">Household</option>
          <option value="tax">Tax</option>
          <option value="appearance">Appearance</option>
          <option value="data">Data &amp; Privacy</option>
        </select>
      </label>
      <div className="settings-panel">
        {settingsSection === "household" && (
          <section className="card settings-card">
            <h3>Household members</h3>
            <p className="muted">
              People whose income and spending are included in this plan.
            </p>
            {people.map((p, i) => (
              <div className="member-setting" key={p.id}>
                <input
                  aria-label={`Member ${i + 1} name`}
                  value={p.name}
                  disabled={memberSaving}
                  onChange={(e) =>
                    setPeople(updateAt(people, i, { name: e.target.value }))
                  }
                />
                <BirthDateField
                  label={`Member ${i + 1} birth date`}
                  value={p.birthDate ?? ""}
                  disabled={memberSaving}
                  onChange={(birthDate) =>
                    setPeople(updateAt(people, i, { birthDate }))
                  }
                />
                {people.length > 1 && (
                  <OverflowMenu label={`More actions for ${p.name || `member ${i + 1}`}`} items={[{
                    label: "Remove member",
                    destructive: true,
                    disabled: memberSaving,
                    onSelect: () => setPeople(people.filter((_, x) => x !== i)),
                  }]}/>
                )}
              </div>
            ))}
            <div className="form-actions">
              <ActionButton
                tier="primary"
                disabled={memberSaving}
                onClick={() =>
                  setPeople([...people, newPerson(bootstrap.household!.id)])
                }
              >
                <Plus size={14} /> Add person
              </ActionButton>
              <ActionButton
                tier="secondary"
                disabled={memberSaving}
                onClick={savePeople}
              >
                {memberSaving ? "Saving…" : "Save members"}
              </ActionButton>
            </div>
            {memberResult?.kind === "error" && (
              <p
                ref={memberAlert}
                tabIndex={-1}
                role="alert"
                className="negative"
              >
                {memberResult.message}
              </p>
            )}
            {memberResult?.kind === "success" && (
              <p role="status">{memberResult.message}</p>
            )}
            {message && <p role="status">{message}</p>}
          </section>
        )}
        {settingsSection === "tax" && (
          <section
            className="card settings-card"
            aria-labelledby="tax-profile-title"
          >
            <h3 id="tax-profile-title">Tax filing</h3>
            <p className="muted">
              Choose whose incomes are combined on the household income-tax
              return. Payroll taxes remain calculated separately for each
              employee.
            </p>
            <label>
              Filing status
              <select
                aria-label="Tax filing status"
                value={filingStatus}
                disabled={taxSaving}
                onChange={(event) =>
                  setFilingStatus(
                    event.target.value as TaxProfile["filingStatus"],
                  )
                }
              >
                <option value="single">Single</option>
                <option value="married-joint">Married filing jointly</option>
                <option value="married-separate">
                  Married filing separately
                </option>
                <option value="head-of-household">Head of household</option>
              </select>
            </label>
            {filingStatus === "married-joint" && (
              <fieldset>
                <legend>People filing together</legend>
                <label>
                  Spouse 1
                  <select
                    aria-label="Joint filer 1"
                    value={jointMembers[0]}
                    disabled={taxSaving}
                    onChange={(event) =>
                      setJointMembers([event.target.value, jointMembers[1]])
                    }
                  >
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span aria-hidden="true"> + </span>
                <label>
                  Spouse 2
                  <select
                    aria-label="Joint filer 2"
                    value={jointMembers[1]}
                    disabled={taxSaving}
                    onChange={(event) =>
                      setJointMembers([jointMembers[0], event.target.value])
                    }
                  >
                    <option value="">Select…</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p role="status">
                  <strong>
                    {people.find((person) => person.id === jointMembers[0])
                      ?.name ?? "First spouse"}{" "}
                    +{" "}
                    {people.find((person) => person.id === jointMembers[1])
                      ?.name ?? "Second spouse"}
                  </strong>{" "}
                  — incomes combined for federal and California income tax.
                </p>
              </fieldset>
            )}
            <div>
              <strong>Linked wage income</strong>
              {bootstrap.recurring
                .filter(
                  (entry) =>
                    entry.incomeType === "salary" ||
                    entry.incomeTaxCategory === "wages",
                )
                .map((entry) => (
                  <p key={entry.id}>
                    {bootstrap.people.find(
                      (person) => person.id === entry.ownerPersonId,
                    )?.name ?? "Owner required"}
                    : {entry.name} · {money(entry.amountCents)} annually
                  </p>
                ))}
            </div>
            <button
              className="primary"
              disabled={taxSaving}
              onClick={saveTaxProfile}
            >
              {taxSaving ? "Saving…" : "Save tax filing"}
            </button>
            {taxResult && (
              <p
                role={taxResult.kind === "error" ? "alert" : "status"}
                className={taxResult.kind === "error" ? "negative" : undefined}
              >
                {taxResult.message}
              </p>
            )}
          </section>
        )}
        {settingsSection === "appearance" && (
          <section className="card settings-card">
            <h3>Appearance</h3>
            <div className="setting">
              <fieldset>
                <legend>Theme</legend>
                {(["system", "light", "dark"] as Theme[]).map((theme) => (
                  <label key={theme}>
                    <input
                      type="radio"
                      name="theme"
                      checked={settings.theme === theme}
                      disabled={appearanceSaving}
                      onChange={() => saveAppearance({ theme })}
                    />
                    {theme[0].toUpperCase() + theme.slice(1)}
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="setting">
              <div>
                <strong id="reduced-motion-label">Reduced motion</strong>
                <p id="reduced-motion-description">
                  Minimize interface animation.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={settings.reducedMotion}
                aria-labelledby="reduced-motion-label"
                aria-describedby="reduced-motion-description"
                className={settings.reducedMotion ? "switch on" : "switch"}
                disabled={appearanceSaving}
                onClick={() =>
                  saveAppearance({ reducedMotion: !settings.reducedMotion })
                }
              >
                <span />
              </button>
            </div>
          </section>
        )}
        {settingsSection === "data" && (
          <section className="card settings-card">
            <h3>Data & privacy</h3>
            <div className="setting">
              <div>
                <strong>Local database</strong>
                <p>Your financial data stays on this device.</p>
              </div>
              <button
                disabled={backupBusy || restoreBusy}
                onClick={createBackup}
              >
                {backupBusy ? "Backing up…" : "Back up data"}
              </button>
            </div>
            <div className="setting">
              <div>
                <strong>Restore</strong>
                <p>Replace local data from a LifeLook backup.</p>
              </div>
              <button
                disabled={backupBusy || restoreBusy}
                onClick={(event) => {
                  confirmationInvoker.current = event.currentTarget;
                  setConfirmRestore(true);
                  queueMicrotask(() => restoreCancel.current?.focus());
                }}
              >
                Choose backup
              </button>
            </div>
            <div className="setting">
              <div>
                <strong>Reset profile</strong>
                <p>
                  Permanently erase this workspace and start onboarding again.
                </p>
              </div>
              <button
                className="danger"
                disabled={backupBusy || restoreBusy}
                onClick={(event) => {
                  confirmationInvoker.current = event.currentTarget;
                  setConfirmReset(true);
                  queueMicrotask(() => resetCancel.current?.focus());
                }}
              >
                Reset profile
              </button>
            </div>
            {dataResult?.kind === "error" && (
              <p
                ref={dataAlert}
                tabIndex={-1}
                role="alert"
                className="negative"
              >
                {dataResult.message}
              </p>
            )}
            {dataResult?.kind === "success" && (
              <p role="status">{dataResult.message}</p>
            )}
          </section>
        )}
        {confirmRestore && (
          <div className="modal-backdrop">
            <section
              className="card modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="restore-title"
              aria-describedby="restore-warning"
            >
              <h2 id="restore-title">Replace all current data?</h2>
              <p id="restore-warning">
                Restoring a backup replaces all data in this workspace and
                cannot be undone.
              </p>
              <div className="actions">
                <button
                  ref={restoreCancel}
                  onClick={() => setConfirmRestore(false)}
                >
                  Cancel
                </button>
                <button className="primary" onClick={restoreBackup}>
                  Choose backup and restore
                </button>
              </div>
            </section>
          </div>
        )}
        {confirmReset && (
          <div className="modal-backdrop">
            <section
              className="card modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="reset-title"
              aria-describedby="reset-warning"
            >
              <h2 id="reset-title">Reset your profile?</h2>
              <p id="reset-warning">
                This permanently erases all household, account, activity, and
                planning data in this workspace. This cannot be undone.
              </p>
              <div className="actions">
                <button
                  ref={resetCancel}
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
                <button className="danger" onClick={resetProfile}>
                  Yes, reset profile
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
