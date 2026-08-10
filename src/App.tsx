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
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  WalletCards,
} from "lucide-react";
import {
  ProjectionEngine,
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
import {
  buildSearchIndex,
  GlobalSearch,
  type SearchResult,
} from "./GlobalSearch";

type View = "Overview" | "Activity" | "Plan" | "Net Worth" | "Settings";
const localIsoDate=()=>{const now=new Date(),offset=now.getTimezoneOffset()*60000;return new Date(now.valueOf()-offset).toISOString().slice(0,10)};
const nav: [View, typeof LayoutDashboard][] = [
  ["Overview", LayoutDashboard],
  ["Activity", Activity],
  ["Plan", PiggyBank],
  ["Net Worth", Landmark],
  ["Settings", Settings],
];
const money = (cents: number, compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
  }).format(cents / 100);

const baseline: Scenario = {
  id: "base",
  name: "Baseline",
  assumptions: { inflationBps: 250, thresholdInflationBps: 250 },
  assumptionsInherited: true,
  events: [],
  allocations: [{ accountId: "savings", percentBps: 10000, priority: 1 }],
  withdrawals: [],
  goals: [],
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
    taxTreatment: entry.taxTreatment ?? "none",
  })),
  assets: value.assets ?? [],
  liabilities: value.liabilities ?? [],
  scenarios: (value.scenarios ?? []).map((scenario)=>({...scenario,withdrawals:scenario.withdrawals??[],goals:scenario.goals??[]})),
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
  useEffect(()=>{if(settings.theme!=="system"||!repository.systemThemeDark)return;let active=true;const refresh=()=>repository.systemThemeDark?.().then(value=>{if(active&&value!==null&&value!==undefined)setOsDark(value)}).catch(()=>{});refresh();const timer=window.setInterval(refresh,500);return()=>{active=false;window.clearInterval(timer)}},[settings.theme,repository]);
  const dark =
    settings.theme === "dark" || (settings.theme === "system" && osDark);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    bootstrap.scenarios[0]?.id ?? "",
  );
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
  const [profileOpen,setProfileOpen]=useState(false);
  const [workspaceInfo,setWorkspaceInfo]=useState<WorkspaceInfo|null>(null);
  const [profileResult,setProfileResult]=useState("");
  const [profileBusy,setProfileBusy]=useState(false);
  useEffect(()=>{if(!profileOpen)return;setProfileResult("");setWorkspaceInfo(null);repository.workspaceInfo?.().then(setWorkspaceInfo).catch(error=>setProfileResult(errorMessage(error,"Could not read workspace information.")));requestAnimationFrame(()=>profileMenu.current?.querySelector<HTMLElement>("button")?.focus());const dismiss=(event:MouseEvent)=>{if(!profileMenu.current?.contains(event.target as Node)&&!profileButton.current?.contains(event.target as Node)){setProfileOpen(false);profileButton.current?.focus()}};const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==="Escape"){setProfileOpen(false);profileButton.current?.focus()}};document.addEventListener("mousedown",dismiss);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("mousedown",dismiss);document.removeEventListener("keydown",escape)}},[profileOpen,repository]);
  async function backupFromProfile(){setProfileResult("");setProfileBusy(true);try{const destination=await repository.selectBackupDestination?.();if(!destination)return;await repository.backupDatabase?.(destination);setProfileResult("Backup created successfully.")}catch(error){setProfileResult(errorMessage(error,"Could not create the backup."))}finally{setProfileBusy(false)}}
  function profileMenuKey(event:React.KeyboardEvent){const items=[...profileMenu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')??[]];const current=items.indexOf(document.activeElement as HTMLButtonElement);let next=current;if(event.key==="ArrowDown")next=(current+1)%items.length;else if(event.key==="ArrowUp")next=(current-1+items.length)%items.length;else if(event.key==="Home")next=0;else if(event.key==="End")next=items.length-1;else return;event.preventDefault();items[next]?.focus()}
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
      actuals: bootstrap.activity.map((posting) => ({date:posting.occurredOn,kind:posting.kind,amountCents:posting.amountCents})),
    }),
    [bootstrap],
  );
  const scenarios = useMemo(
    () =>
      bootstrap.scenarios.map((record): Scenario => ({
        id: record.id,
        name: record.name,
        assumptions: {
          inflationBps: record.assumptions.inflationBps ?? 250,
          thresholdInflationBps:
            record.assumptions.thresholdInflationBps ?? 250,
        },
        assumptionsInherited: false,
        events: record.events,
        allocations: record.allocations.map((rule) => ({
          ...rule,
          targetBalanceCents: rule.targetBalanceCents ?? undefined,
        })),
        withdrawals: record.withdrawals ?? [],
        goals: record.goals ?? [],
        horizon: {
          start: new Date().toISOString().slice(0, 7),
          months: record.horizonMonths,
        },
      })),
    [bootstrap.scenarios],
  );
  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId) ??
    scenarios[0] ?? {
      ...baseline,
      allocations: snapshot.accounts[0]
        ? [
            {
              accountId: snapshot.accounts[0].id,
              percentBps: 10000,
              priority: 1,
            },
          ]
        : [],
    };
  const projections = useMemo(
    () =>
      bootstrap.taxProfile
        ? ProjectionEngine.calculate(snapshot, selectedScenario, localIsoDate())
        : null,
    [snapshot, bootstrap.taxProfile, selectedScenario],
  );
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
          {nav.map(([name, Icon]) => (
            <button
              key={name}
              className={view === name ? "active" : ""}
              aria-current={view === name ? "page" : undefined}
              onClick={() => setView(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Activity" && bootstrap.activity.length > 0 && (
                <i>{new Set(bootstrap.activity.map((x) => x.entryId)).size}</i>
              )}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <button
            ref={profileButton}
            className="profile"
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            onClick={()=>setProfileOpen(open=>!open)}
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
          {profileOpen&&<div className="profile-menu card" role="menu" aria-label="Workspace" ref={profileMenu} onKeyDown={profileMenuKey}><strong>{workspaceInfo?.householdName??bootstrap.household?.name??"Local household"}</strong><small>Local workspace</small><code>{workspaceInfo?.profilePath??"Loading profile path…"}</code><button role="menuitem" onClick={()=>{setProfileOpen(false);setView("Settings")}}>Open Settings</button><button role="menuitem" disabled={profileBusy} onClick={backupFromProfile}>{profileBusy?"Creating backup…":"Create Backup"}</button>{profileResult&&<p role={profileResult.includes("successfully")?"status":"alert"} aria-live="polite">{profileResult}</p>}</div>}
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
              onClick={() => setSearchInvoker(searchButton.current)}
            >
              <Search size={18} />
            </button>
            <button
              className="icon"
              onClick={() =>
                setSettings((s) => ({ ...s, theme: dark ? "light" : "dark" }))
              }
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              ref={addButton}
              className="add"
              onClick={() => openDialog({ type: "chooser" }, addButton.current)}
            >
              <Plus size={17} /> Add
            </button>
          </div>
        </header>
        {view === "Overview" && (
          <Overview
            bootstrap={bootstrap}
            projections={projections}
            navigate={setView}
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
            onImport={(el) => openDialog({ type: "import" }, el)}
            onEdit={(entry) =>
              openDialog({
                type: entry[0].kind === "transfer" ? "transfer" : "transaction",
                entry,
              })
            }
          />
        )}
        {view === "Plan" && projections && (
          <PlanView
            projections={projections}
            scenarios={scenarios}
            selectedScenarioId={selectedScenario.id}
            onSelectScenario={setSelectedScenarioId}
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
            onPlanScenario={(el) =>
              openDialog(
                {
                  type: "scenario-plan",
                  scenario: bootstrap.scenarios.find(
                    (s) => s.id === selectedScenario.id,
                  ),
                },
                el,
              )
            }
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
            onReconcile={(account, el) =>
              openDialog({ type: "reconcile", account }, el)
            }
            onAddAsset={(el) => openDialog({ type: "asset" }, el)}
            onAddLiability={(el) => openDialog({ type: "liability" }, el)}
            onEditAsset={(asset, el) =>
              openDialog({ type: "asset", asset }, el)
            }
            onEditLiability={(liability, el) =>
              openDialog({ type: "liability", liability }, el)
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
          repository={repository}
          close={closeDialog}
          refresh={onRefresh}
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
  recurring?: RecurringEntry;
  scenario?: ScenarioRecord;
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
    );
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
        if (state.account)
          await repository.updateAccount?.({
            id: state.account.id,
            name: name.trim(),
            kind: accountKind,
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
        if (impact && !impact.canDelete) {
          setBlockers(impact.blockers);
          return;
        }
        setConfirmDelete(true);
      } catch (x) {
        setError(errorMessage(x, "Could not check this account."));
      } finally {
        setBusy(false);
      }
    } else setConfirmDelete(true);
  }
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
          <div role="alert" tabIndex={-1} ref={noticeRef}>
            <p>This account cannot be deleted:</p>
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
              . Financial history is never cascaded.
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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    if (!name.trim())
      return setError(`${isAsset ? "Asset" : "Debt"} name is required.`);
    if (cents == null || cents < 0)
      return setError("Enter an exact non-negative USD value.");
    if (bps == null || bps < (isAsset ? -10_000 : 0) || bps > 100_000)
      return setError(
        `Enter an annual ${isAsset ? "growth" : "interest"} rate within the supported range.`,
      );
    setBusy(true);
    try {
      if (isAsset) {
        const input = {
          id: state.asset?.id ?? crypto.randomUUID(),
          name: name.trim(),
          valueCents: cents,
          annualGrowthBps: bps,
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
        className="card modal entry-modal"
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
              This permanently removes {record?.name}. Existing account and
              activity history is unaffected.
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
                {isAsset ? "Current value (USD)" : "Current balance (USD)"}
                <input
                  required
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <label>
                {isAsset ? "Annual growth (%)" : "Annual interest rate (%)"}
                <input
                  required
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </label>
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
}: {
  bootstrap: Bootstrap;
  projections: ReturnType<typeof ProjectionEngine.calculate> | null;
  navigate: (view: View) => void;
}) {
  const currentNetWorth =
    bootstrap.accounts.reduce((sum, a) => sum + a.balanceCents, 0) +
    bootstrap.assets.reduce((sum, a) => sum + a.valueCents, 0) -
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
        <div className="hero-chart">
          <p className="muted">
            Historical net-worth trend unavailable: no dated balance history has
            been recorded.
          </p>
        </div>
      </section>
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
          <p className="empty">No transactions have been recorded.</p>
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
            <p>
              Projected values use your saved tax profile and planning
              assumptions. Open Plan for the monthly reconciliation.
            </p>
          ) : (
            <p>
              Complete your tax profile before LifeLook calculates projections.
            </p>
          )}
        </section>
      </div>
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
        className="card modal import-modal"
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
  onImport,
  revealEntryId,
}: {
  activity: ActivityPosting[];
  accounts: BootstrapAccount[];
  repository: Repository;
  onEdit: (entry: ActivityPosting[]) => void;
  onImport: (el: HTMLElement) => void;
  revealEntryId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("all");
  const [year, setYear] = useState(String(new Date().getFullYear()));
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
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Search activity"
            placeholder="Search transactions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="sr-only" htmlFor="activity-account">
          Account
        </label>
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
        <label className="sr-only" htmlFor="activity-year">
          Year
        </label>
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
        <button onClick={(e) => onImport(e.currentTarget)}>Import CSV</button>
        <button onClick={exportCsv} disabled={!rows.length || exporting}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
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
            <button
              data-search-kind="Activity"
              data-search-id={row.entryId}
              className="transaction transaction-action"
              key={row.entryId}
              onClick={() => onEdit(group)}
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
            </button>
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
    </div>
  );
}

const horizonLabel = (months: number) =>
  months % 12 === 0 ? `${months / 12}-year` : `${months}-month`;

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
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!available.some((c) => c.id === categoryId))
      setCategoryId(available[0]?.id ?? "");
  }, [kind]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const cents = parseMoney(amount),
      bps = parsePercent(growth);
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
    setBusy(true);
    try {
      const input = {
        id: record?.id ?? crypto.randomUUID(),
        categoryId,
        accountId: accountId || null,
        name: name.trim(),
        amountCents: cents,
        frequency,
        startDate,
        endDate: endDate || null,
        annualGrowthBps: bps,
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
        className="card modal entry-modal"
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
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
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
            <label>
              Amount (USD)
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
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
          allocations: record!.allocations,
          withdrawals: record!.withdrawals,
          goals: record!.goals,
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

function PlanView({
  projections,
  scenarios,
  selectedScenarioId,
  onSelectScenario,
  snapshot,
  expanded,
  setExpanded,
  recurring,
  categories,
  accounts,
  onAddRecurring,
  onEditRecurring,
  onAddScenario,
  onEditScenario,
  onPlanScenario,
}: {
  projections: ReturnType<typeof ProjectionEngine.calculate>;
  scenarios: Scenario[];
  selectedScenarioId: string;
  onSelectScenario: (id: string) => void;
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
  onPlanScenario: (el: HTMLElement) => void;
}) {
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const activeScenario=scenarios.find(s=>s.id===selectedScenarioId);
  const latestGoalResults=projections.flatMap(year=>year.months).at(-1)?.goalResults??[];
  const comparisons = scenarios
    .filter((s) => comparisonIds.includes(s.id))
    .map((s) => ({
      scenario: s,
      years: ProjectionEngine.calculate(snapshot, s, localIsoDate()),
    }));
  const comparisonYears = [
    ...new Set(comparisons.flatMap((x) => x.years.map((y) => y.year))),
  ].sort();
  return (
    <div className="content">
      <div className="scenario-bar">
        <div>
          <span className="label assumption">Assumptions</span>
          <h3>
            {scenarios.find((s) => s.id === selectedScenarioId)?.name ??
              "Baseline"}{" "}
            plan
          </h3>
          {scenarios.length > 0 && (
            <select
              data-search-kind="Scenario"
              data-search-id={selectedScenarioId}
              aria-label="Active scenario"
              value={selectedScenarioId}
              onChange={(event) => onSelectScenario(event.target.value)}
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <div className="inline-actions">
            <button onClick={(e) => onAddScenario(e.currentTarget)}>
              New scenario
            </button>
            <button
              disabled={!scenarios.length}
              onClick={(e) => onEditScenario(e.currentTarget)}
            >
              Edit scenario
            </button>
            <button
              disabled={!scenarios.length}
              onClick={(e) => onPlanScenario(e.currentTarget)}
            >
              Events &amp; allocations
            </button>
          </div>
        </div>
        <div aria-label="Compare scenarios">
          {scenarios.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={comparisonIds.includes(s.id)}
                disabled={
                  !comparisonIds.includes(s.id) && comparisonIds.length >= 3
                }
                onChange={() =>
                  setComparisonIds((ids) =>
                    ids.includes(s.id)
                      ? ids.filter((id) => id !== s.id)
                      : [...ids, s.id],
                  )
                }
              />
              {s.name}
            </label>
          ))}
        </div>
      </div>
      {activeScenario&&<section className="card wide" aria-labelledby="goal-summary-title"><div className="card-title"><div><span className="label assumption">Funding trackers</span><h3 id="goal-summary-title">Goals</h3></div><span>{money(projections.reduce((sum,year)=>sum+year.goalFundingCents,0),true)} projected funding</span></div>{activeScenario.goals.map(goal=>{const result=latestGoalResults.find(item=>item.goalId===goal.id);return <div className="transaction" key={goal.id}><div><strong>{goal.name}</strong><small>{goal.enabled?(result?.targetResult.replaceAll("-"," ")??"Waiting for projection"):"Disabled"}</small></div>{result&&<div><progress aria-label={`${goal.name} funding progress`} max={10000} value={result.completionBps}>{result.completionBps/100}%</progress><small>{money(result.earmarkedCents)} of {money(result.targetCents)} · {money(result.requiredCents)}/month required · {money(result.shortfallCents)} shortfall{result.projectedCompletionDate?` · completion ${result.projectedCompletionDate}`:""}</small></div>}</div>})}{!activeScenario.goals.length&&<p className="empty">No funding goals in this scenario.</p>}<p className="muted">Funding does not execute purchases, debt payoff, or retirement changes; add those separately as dated events.</p></section>}
      {comparisons.length > 1 && (
        <section className="card wide" aria-label="Scenario comparison">
          <h3>Scenario comparison</h3>
          <div className="year-table">
            <div className="year-row table-head">
              <span>Year</span>
              {comparisons.map((x) => (
                <span key={x.scenario.id}>{x.scenario.name}</span>
              ))}
            </div>
            {comparisonYears.map((year) => (
              <div className="year-row" key={year}>
                <span>{year}</span>
                {comparisons.map((x) => {
                  const row = x.years.find((y) => y.year === year);
                  return (
                    <span key={x.scenario.id}>
                      {row
                        ? `${row.endingNetWorthCents === null ? "Unavailable" : money(row.endingNetWorthCents, true)} · goals ${money(row.goalFundingCents,true)} · deficit ${money(row.unfundedDeficitCents, true)}`
                        : "—"}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="card wide" aria-label="Planning inputs">
        <div className="card-title">
          <div>
            <span className="label assumption">Inputs</span>
            <h3>Planning inputs</h3>
          </div>
          <div className="inline-actions">
            <button onClick={(e) => onAddRecurring("income", e.currentTarget)}>
              Add income
            </button>
            <button onClick={(e) => onAddRecurring("expense", e.currentTarget)}>
              Add expense
            </button>
          </div>
        </div>
        <div className="planning-inputs">
          {recurring.map((entry) => {
            const category = categories.find((c) => c.id === entry.categoryId);
            const account = accounts.find((a) => a.id === entry.accountId);
            return (
              <button
                data-search-kind="Recurring"
                data-search-id={entry.id}
                className="transaction transaction-action"
                key={entry.id}
                onClick={(e) => onEditRecurring(entry, e.currentTarget)}
                aria-label={`Edit recurring ${entry.name}`}
              >
                <span className="transaction-icon">
                  {category?.kind === "income" ? (
                    <ArrowDownRight size={17} />
                  ) : (
                    <ArrowUpRight size={17} />
                  )}
                </span>
                <div>
                  <strong>{entry.name}</strong>
                  <small>
                    {category?.name ?? "Uncategorized"}
                    {account ? ` · ${account.name}` : ""} · {entry.frequency}
                  </small>
                </div>
                <b className={category?.kind === "income" ? "positive" : ""}>
                  {money(
                    category?.kind === "income"
                      ? entry.amountCents
                      : -entry.amountCents,
                  )}
                </b>
              </button>
            );
          })}
          {!recurring.length && (
            <p className="empty">No recurring planning inputs yet.</p>
          )}
        </div>
      </section>
      <section className="card wide">
        <div className="card-title">
          <div>
            <span className="label projected">Projected</span>
            <h3>
              {horizonLabel(
                scenarios.find((s) => s.id === selectedScenarioId)?.horizon
                  .months ?? 120,
              )}{" "}
              outlook
            </h3>
          </div>
          <small>Click a year for monthly detail</small>
        </div>
        <div className="year-table">
          <div className="year-row table-head">
            <span>Year</span>
            <span>Income</span>
            <span>Spending</span>
            <span>Taxes</span>
            <span>Net worth</span>
          </div>
          {projections.map((year) => (
            <div key={year.year}>
              <button
                className="year-row"
                aria-expanded={expanded === year.year}
                aria-controls={`plan-months-${year.year}`}
                onClick={() =>
                  setExpanded(expanded === year.year ? null : year.year)
                }
              >
                <span>
                  {expanded === year.year ? (
                    <ChevronDown size={15} />
                  ) : (
                    <ChevronRight size={15} />
                  )}{" "}
                  {year.year}
                </span>
                <span>{money(year.incomeCents, true)}</span>
                <span>{money(year.expenseCents, true)}</span>
                <span>{money(year.taxCents, true)}</span>
                <strong>{year.endingNetWorthCents === null ? "Unavailable" : money(year.endingNetWorthCents, true)}</strong>
              </button>
              {expanded === year.year && (
                <div
                  className="months"
                  id={`plan-months-${year.year}`}
                  role="region"
                  aria-label={`${year.year} monthly detail`}
                >
                  {year.months.map((m) => (
                    <div key={m.month}>
                      <span>
                        {new Date(m.month + "-02").toLocaleDateString("en", {
                          month: "short",
                        })}
                      </span>
                      <span>{money(m.incomeCents, true)}</span>
                      <span>{money(m.expenseCents, true)}</span>
                      <span>{money(m.taxCents, true)}</span>
                      <strong>{m.netWorthCents === null ? "Unavailable" : money(m.netWorthCents, true)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
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
  onReconcile,
  onAddAsset,
  onAddLiability,
  onEditAsset,
  onEditLiability,
}: {
  snapshot: FinancialSnapshot;
  accounts: BootstrapAccount[];
  assets: Asset[];
  liabilities: Liability[];
  onAdd: (el: HTMLElement) => void;
  onEdit: (a: BootstrapAccount, el: HTMLElement) => void;
  onReconcile: (a: BootstrapAccount, el: HTMLElement) => void;
  onAddAsset: (el: HTMLElement) => void;
  onAddLiability: (el: HTMLElement) => void;
  onEditAsset: (a: Asset, el: HTMLElement) => void;
  onEditLiability: (l: Liability, el: HTMLElement) => void;
}) {
  const assets =
      snapshot.accounts.reduce((s, a) => s + Math.max(0, a.balanceCents), 0) +
      snapshot.assets.reduce((s, a) => s + a.valueCents, 0),
    debt =
      snapshot.liabilities.reduce((s, l) => s + l.balanceCents, 0) +
      snapshot.accounts.reduce((s, a) => s + Math.max(0, -a.balanceCents), 0),
    netWorth =
      snapshot.accounts.reduce((s, a) => s + a.balanceCents, 0) +
      snapshot.assets.reduce((s, a) => s + a.valueCents, 0) -
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
      <section className="card wide">
        <div className="card-title">
          <div>
            <span className="label actual">Current balance</span>
            <h3>Accounts & assets</h3>
          </div>
          <div className="actions">
            <button onClick={(e) => onAddAsset(e.currentTarget)}>
              <Plus size={14} /> Add asset
            </button>
            <button onClick={(e) => onAdd(e.currentTarget)}>
              <Plus size={14} /> Add account
            </button>
          </div>
        </div>
        {snapshot.accounts
          .filter((a) => a.balanceCents >= 0)
          .map((a) => (
            <div className="account" key={a.id}>
              <span className="transaction-icon">
                <WalletCards size={17} />
              </span>
              <div>
                <strong>{a.name}</strong>
                <small>{a.kind}</small>
              </div>
              <b>{money(a.balanceCents)}</b>
              <button
                data-search-kind="Account"
                data-search-id={a.id}
                onClick={(e) =>
                  onEdit(
                    accounts.find((x) => x.id === a.id)!,
                    e.currentTarget,
                  )
                }
              >
                Edit
              </button>
              <button
                onClick={(e) =>
                  onReconcile(
                    accounts.find((x) => x.id === a.id)!,
                    e.currentTarget,
                  )
                }
              >
                Reconcile
              </button>
            </div>
          ))}
        {assetRecords.map((a) => (
          <div className="account" key={a.id}>
            <span className="transaction-icon">
              <Building2 size={17} />
            </span>
            <div>
              <strong>{a.name}</strong>
              <small>Asset</small>
            </div>
            <b>{money(a.valueCents)}</b>
            <button
              data-search-kind="Asset"
              data-search-id={a.id}
              onClick={(e) => onEditAsset(a, e.currentTarget)}
            >
              Edit
            </button>
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
          <button onClick={(e) => onAddLiability(e.currentTarget)}>
            <Plus size={14} /> Add debt
          </button>
        </div>
        {snapshot.accounts
          .filter((a) => a.balanceCents < 0)
          .map((a) => (
            <div className="account" key={a.id}>
              <span className="transaction-icon">
                <WalletCards size={17} />
              </span>
              <div>
                <strong>{a.name}</strong>
                <small>Credit balance</small>
              </div>
              <b>{money(-a.balanceCents)}</b>
              <button
                data-search-kind="Account"
                data-search-id={a.id}
                onClick={(e) =>
                  onEdit(
                    accounts.find((x) => x.id === a.id)!,
                    e.currentTarget,
                  )
                }
              >
                Edit
              </button>
              <button
                onClick={(e) =>
                  onReconcile(
                    accounts.find((x) => x.id === a.id)!,
                    e.currentTarget,
                  )
                }
              >
                Reconcile
              </button>
            </div>
          ))}
        {liabilityRecords.map((l) => (
          <div className="account" key={l.id}>
            <span className="transaction-icon">
              <Building2 size={17} />
            </span>
            <div>
              <strong>{l.name}</strong>
              <small>Liability</small>
            </div>
            <b>{money(l.balanceCents)}</b>
            <button
              data-search-kind="Debt"
              data-search-id={l.id}
              onClick={(e) => onEditLiability(l, e.currentTarget)}
            >
              Edit
            </button>
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
  const [dataResult, setDataResult] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const dataAlert = useRef<HTMLParagraphElement>(null);
  const restoreCancel = useRef<HTMLButtonElement>(null);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberResult, setMemberResult] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const memberAlert = useRef<HTMLParagraphElement>(null);
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
  return (
    <div className="content">
      <section className="card settings-card">
        <h3>Household members</h3>
        <p className="muted">
          People whose income, spending, or goals are included in this plan.
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
              <button
                onClick={() => setPeople(people.filter((_, x) => x !== i))}
                disabled={memberSaving}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="form-actions">
          <button
            disabled={memberSaving}
            onClick={() =>
              setPeople([...people, newPerson(bootstrap.household!.id)])
            }
          >
            <Plus size={14} /> Add person
          </button>
          <button
            className="primary"
            disabled={memberSaving}
            onClick={savePeople}
          >
            {memberSaving ? "Saving…" : "Save members"}
          </button>
        </div>
        {memberResult?.kind === "error" && (
          <p ref={memberAlert} tabIndex={-1} role="alert" className="negative">
            {memberResult.message}
          </p>
        )}
        {memberResult?.kind === "success" && (
          <p role="status">{memberResult.message}</p>
        )}
        {message && <p role="status">{message}</p>}
      </section>
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
            <p id="reduced-motion-description">Minimize interface animation.</p>
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
      <section className="card settings-card">
        <h3>Data & privacy</h3>
        <div className="setting">
          <div>
            <strong>Local database</strong>
            <p>Your financial data stays on this device.</p>
          </div>
          <button disabled={backupBusy || restoreBusy} onClick={createBackup}>
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
            onClick={() => {
              setConfirmRestore(true);
              queueMicrotask(() => restoreCancel.current?.focus());
            }}
          >
            Choose backup
          </button>
        </div>
        {dataResult?.kind === "error" && (
          <p ref={dataAlert} tabIndex={-1} role="alert" className="negative">
            {dataResult.message}
          </p>
        )}
        {dataResult?.kind === "success" && (
          <p role="status">{dataResult.message}</p>
        )}
      </section>
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
              Restoring a backup replaces all data in this workspace and cannot
              be undone.
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
    </div>
  );
}
