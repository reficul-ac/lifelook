import {
  FormEvent,
  type KeyboardEvent,
  useEffect,
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
  emptySettings,
} from "./repository";

type View = "Overview" | "Activity" | "Plan" | "Net Worth" | "Settings";
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
  events: [],
  allocations: [{ accountId: "savings", percentBps: 10000, priority: 1 }],
  horizon: { start: "2025-01", months: 120 },
};
const normalizeBootstrap = (value: BootstrapInput): Bootstrap => ({
  ...value,
  settings: value.settings ?? emptySettings,
  taxProfile: value.taxProfile ?? null,
  activity: value.activity ?? [],
  recurring: (value.recurring ?? []).map((entry) => ({ ...entry, frequency: entry.frequency ?? "monthly" })),
  assets: value.assets ?? [],
  liabilities: value.liabilities ?? [],
  scenarios: value.scenarios ?? [],
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
  onRefresh: () => void;
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
  const dark =
    settings.theme === "dark" || (settings.theme === "system" && osDark);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState(bootstrap.scenarios[0]?.id ?? "");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const openDialog = (state: DialogState, invoker?: HTMLElement | null) =>
    setDialog({
      ...state,
      invoker: invoker ?? (document.activeElement as HTMLElement),
    });
  const closeDialog = () => setDialog(null);
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
    }),
    [bootstrap],
  );
  const scenarios = useMemo(() => bootstrap.scenarios.map((record): Scenario => ({
    id: record.id,
    name: record.name,
    assumptions: { inflationBps: record.assumptions.inflationBps ?? 250, thresholdInflationBps: record.assumptions.thresholdInflationBps ?? 250 },
    events: record.events,
    allocations: record.allocations.map(rule => ({ ...rule, targetBalanceCents: rule.targetBalanceCents ?? undefined })),
    horizon: { start: new Date().toISOString().slice(0, 7), months: record.horizonMonths },
  })), [bootstrap.scenarios]);
  const selectedScenario = scenarios.find(s => s.id === selectedScenarioId) ?? scenarios[0] ?? { ...baseline, allocations: snapshot.accounts[0] ? [{ accountId: snapshot.accounts[0].id, percentBps: 10000, priority: 1 }] : [] };
  const projections = useMemo(() => bootstrap.taxProfile ? ProjectionEngine.calculate(snapshot, selectedScenario) : null, [snapshot, bootstrap.taxProfile, selectedScenario]);
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
            className="profile"
            disabled
            title="Profile menu is not available in this build"
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
              className="icon"
              aria-label="Search (not yet available)"
              disabled
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
            onEditAsset={(asset, el) => openDialog({ type: "asset", asset }, el)}
            onEditLiability={(liability, el) => openDialog({ type: "liability", liability }, el)}
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
      {dialog?.type === "import" ? (
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
    "chooser" | "transaction" | "transfer" | "account" | "reconcile" | "import" | "asset" | "liability";
  kind?: "income" | "expense";
  entry?: ActivityPosting[];
  account?: BootstrapAccount;
  asset?: Asset;
  liability?: Liability;
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
      ((isAsset ? state.asset?.annualGrowthBps : liability?.annualRateBps) ?? 0) /
        100,
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
    modal.current
      ?.querySelector<HTMLElement>("button,input,select")
      ?.focus();
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
    if (!name.trim()) return setError(`${isAsset ? "Asset" : "Debt"} name is required.`);
    if (cents == null || cents < 0) return setError("Enter an exact non-negative USD value.");
    if (bps == null || bps < (isAsset ? -10_000 : 0) || bps > 100_000)
      return setError(`Enter an annual ${isAsset ? "growth" : "interest"} rate within the supported range.`);
    setBusy(true);
    try {
      if (isAsset) {
        const input = { id: state.asset?.id ?? crypto.randomUUID(), name: name.trim(), valueCents: cents, annualGrowthBps: bps };
        if (state.asset) await repository.updateAsset?.({ ...input, expectedRevision: state.asset.revision });
        else await repository.createAsset?.(input);
      } else {
        let payment = parseMoney(minimumPayment);
        let mortgageTerms = null;
        if (mortgage) {
          const original = parseMoney(principal);
          const months = /^\d+$/.test(term) ? Number(term) : 0;
          const custom = overridePayment ? parseMoney(paymentOverride) : null;
          if (!original || original < cents || months < 1 || months > 480 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
            throw { message: "Enter valid mortgage principal, start date, and a term from 1 to 480 months." };
          if (overridePayment && (!custom || custom <= 0)) throw { message: "Enter a positive custom monthly payment." };
          payment = custom ?? mortgagePayment(original, bps, months);
          mortgageTerms = { originalPrincipalCents: original, termMonths: months, startDate, paymentOverrideCents: custom };
        }
        if (payment == null || (cents > 0 && payment <= 0)) throw { message: "Enter a positive monthly payment for a nonzero debt." };
        const input = { id: liability?.id ?? crypto.randomUUID(), name: name.trim(), balanceCents: cents, annualRateBps: bps, minimumPaymentCents: payment, mortgage: mortgageTerms };
        if (liability) await repository.updateLiability?.({ ...input, expectedRevision: liability.revision });
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
      if (isAsset) await repository.deleteAsset?.({ id: state.asset!.id, expectedRevision: state.asset!.revision });
      else await repository.deleteLiability?.({ id: liability!.id, expectedRevision: liability!.revision });
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
      <section ref={modal} className="card modal entry-modal" role={confirmDelete ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="financial-record-title" onKeyDown={keyDown}>
        <h2 id="financial-record-title" ref={headingRef} tabIndex={confirmDelete ? -1 : undefined}>
          {confirmDelete ? `Delete ${noun}?` : `${record ? "Edit" : "Add"} ${noun}`}
        </h2>
        {error && <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        {confirmDelete ? <>
          <p>This permanently removes {record?.name}. Existing account and activity history is unaffected.</p>
          <div className="actions"><button disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button><button className="danger" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Delete permanently"}</button></div>
        </> : <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <label>{isAsset ? "Asset name" : "Debt name"}<input required value={name} onChange={e => setName(e.target.value)} /></label>
            <label>{isAsset ? "Current value (USD)" : "Current balance (USD)"}<input required inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} /></label>
            <label>{isAsset ? "Annual growth (%)" : "Annual interest rate (%)"}<input required inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} /></label>
            {!isAsset && <>
              <label className="check-row"><input type="checkbox" checked={mortgage} onChange={e => setMortgage(e.target.checked)} /> Include mortgage details</label>
              {mortgage ? <>
                <p className="muted">Calculated payments include principal and interest only, not taxes, insurance, or escrow.</p>
                <label>Original principal (USD)<input required inputMode="decimal" value={principal} onChange={e => setPrincipal(e.target.value)} /></label>
                <label>Mortgage start date<input required type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
                <label>Original term (months)<input required inputMode="numeric" value={term} onChange={e => setTerm(e.target.value)} /></label>
                {!overridePayment && calculatedPayment != null && <p role="status">Calculated principal and interest: <strong>{money(calculatedPayment)}</strong> per month.</p>}
                <label className="check-row"><input type="checkbox" checked={overridePayment} onChange={e => setOverridePayment(e.target.checked)} /> Use custom monthly payment</label>
                {overridePayment && <label>Custom monthly payment (USD)<input required inputMode="decimal" value={paymentOverride} onChange={e => setPaymentOverride(e.target.value)} /></label>}
              </> : <label>Minimum monthly payment (USD)<input required inputMode="decimal" value={minimumPayment} onChange={e => setMinimumPayment(e.target.value)} /></label>}
            </>}
          </fieldset>
          <div className="actions">{record && <button type="button" className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</button>}<button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
        </form>}
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
  const [step, setStep] = useState(initial.onboardingStep >= 6 ? 2 : 1);
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
  const [filingStatus, setFilingStatus] = useState("");
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
        setError("Select a filing status before finishing setup.");
        return;
      }
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
        setStep(2);
      } else {
        await repository.saveOnboardingStep(6, {
          accounts: accounts.map(toAccount),
          taxProfile: {
            filingStatus,
            state: "CA",
            taxYear: 2026,
            thresholdInflationBps: 250,
            revision: 1,
          },
        });
        await repository.completeOnboarding();
        onComplete();
      }
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
        <span className="label assumption">Setup · Step {step} of 2</span>
        <h1>
          {step === 1
            ? "Tell us about your household"
            : "Add the accounts you want to track"}
        </h1>
        <p>
          {step === 1
            ? "Include each person whose income, spending, or goals are part of this financial plan."
            : "Accounts are financial balances LifeLook tracks, such as bank, credit card, investment, and retirement accounts."}
        </p>
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
          ) : (
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
                      onClick={() =>
                        setAccounts(accounts.filter((_, x) => x !== i))
                      }
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
          )}
          {error && (
            <p role="alert" className="negative">
              {error}
            </p>
          )}
          <div className="form-actions">
            {step === 2 && (
              <button
                type="button"
                className="quiet"
                onClick={() => setStep(1)}
              >
                Back
              </button>
            )}
            <button className="add" disabled={saving}>
              {saving
                ? "Saving…"
                : step === 1
                  ? "Save & Continue"
                  : "Finish setup"}
            </button>
          </div>
        </form>
      </section>
    </main>
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
function mortgagePayment(principalCents: number, annualRateBps: number, months: number) {
  if (annualRateBps === 0) return Math.round(principalCents / months);
  const monthlyRate = annualRateBps / 120_000;
  return Math.round(
    (principalCents * monthlyRate) /
      (1 - Math.pow(1 + monthlyRate, -months)),
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
  onEdit,
  onImport,
}: {
  activity: ActivityPosting[];
  accounts: BootstrapAccount[];
  onEdit: (entry: ActivityPosting[]) => void;
  onImport: (el: HTMLElement) => void;
}) {
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("all");
  const [year, setYear] = useState(String(new Date().getFullYear()));
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
      </div>
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

function PlanView({
  projections,
  scenarios,
  selectedScenarioId,
  onSelectScenario,
  snapshot,
  expanded,
  setExpanded,
}: {
  projections: ReturnType<typeof ProjectionEngine.calculate>;
  scenarios: Scenario[];
  selectedScenarioId: string;
  onSelectScenario: (id: string) => void;
  snapshot: FinancialSnapshot;
  expanded: number | null;
  setExpanded: (x: number | null) => void;
}) {
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const comparisons = scenarios.filter(s => comparisonIds.includes(s.id)).map(s => ({ scenario: s, years: ProjectionEngine.calculate(snapshot, s) }));
  const comparisonYears = [...new Set(comparisons.flatMap(x => x.years.map(y => y.year)))].sort();
  return (
    <div className="content">
      <div className="scenario-bar">
        <div>
          <span className="label assumption">Assumptions</span>
          <h3>{scenarios.find(s => s.id === selectedScenarioId)?.name ?? "Baseline"} plan</h3>
          {scenarios.length > 0 && <select aria-label="Active scenario" value={selectedScenarioId} onChange={event => onSelectScenario(event.target.value)}>{scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        </div>
        <div aria-label="Compare scenarios">{scenarios.map(s => <label key={s.id}><input type="checkbox" checked={comparisonIds.includes(s.id)} disabled={!comparisonIds.includes(s.id) && comparisonIds.length >= 3} onChange={() => setComparisonIds(ids => ids.includes(s.id) ? ids.filter(id => id !== s.id) : [...ids, s.id])}/>{s.name}</label>)}</div>
      </div>
      {comparisons.length > 1 && <section className="card wide" aria-label="Scenario comparison"><h3>Scenario comparison</h3><div className="year-table"><div className="year-row table-head"><span>Year</span>{comparisons.map(x => <span key={x.scenario.id}>{x.scenario.name}</span>)}</div>{comparisonYears.map(year => <div className="year-row" key={year}><span>{year}</span>{comparisons.map(x => { const row=x.years.find(y => y.year===year); return <span key={x.scenario.id}>{row ? `${money(row.endingNetWorthCents,true)} · deficit ${money(row.unfundedDeficitCents,true)}` : "—"}</span>})}</div>)}</div></section>}
      <section className="card wide">
        <div className="card-title">
          <div>
            <span className="label projected">Projected</span>
            <h3>10-year outlook</h3>
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
                <strong>{money(year.endingNetWorthCents, true)}</strong>
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
                      <strong>{money(m.netWorthCents, true)}</strong>
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
            <button onClick={(e) => onAddAsset(e.currentTarget)}><Plus size={14} /> Add asset</button>
            <button onClick={(e) => onAdd(e.currentTarget)}><Plus size={14} /> Add account</button>
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
            <button onClick={(e) => onEditAsset(a, e.currentTarget)}>Edit</button>
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
            <button onClick={(e) => onAddLiability(e.currentTarget)}><Plus size={14} /> Add debt</button>
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
              <button onClick={(e) => onEditLiability(l, e.currentTarget)}>Edit</button>
            </div>
          ))}
          {debt === 0 && <p className="empty">No credit balances or liabilities.</p>}
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
      queueMicrotask(() => memberAlert.current?.focus());
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
      queueMicrotask(() => memberAlert.current?.focus());
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
      queueMicrotask(() => memberAlert.current?.focus());
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
