import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
const normalizeBootstrap=(value:BootstrapInput):Bootstrap=>({
  ...value,
  settings:value.settings??emptySettings,
  taxProfile:value.taxProfile??null,
  activity:value.activity??[],recurring:value.recurring??[],assets:value.assets??[],liabilities:value.liabilities??[],scenarios:value.scenarios??[],
  accounts:value.accounts.map(a=>({...a,balanceCents:"balanceCents" in a?a.balanceCents:a.openingBalanceCents})),
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
          <p>{startupGuidance[loadError.code] ?? startupGuidance.startup_failed}</p>
          {loadError.profilePath && <p><strong>Local profile:</strong> <code>{loadError.profilePath}</code></p>}
          <p>Your existing profile has not been deleted, renamed, replaced, or changed by this recovery screen.</p>
          {loadError.retryable && <button disabled={retrying} onClick={retryStartup}>{retrying ? "Retrying…" : "Retry"}</button>}
          <p className="muted">You can safely close this window and try again later.</p>
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
        onComplete={() => repository.bootstrap().then((value)=>setBootstrap(normalizeBootstrap(value)))}
      />
    );
  return (
    <Workspace
      bootstrap={bootstrap}
      repository={repository}
      onRefresh={() => repository.bootstrap().then((value)=>setBootstrap(normalizeBootstrap(value)))}
    />
  );
}

const startupGuidance:Record<string,string> = {
  corrupt:"The profile appears damaged. Restore access to a known-good copy or contact support before retrying.",
  unwritable:"Check the profile and folder permissions, free disk space if needed, then retry.",
  incompatible:"Open this profile with the newer LifeLook version that created it.",
  startup_failed:"Resolve the reported local profile problem, then retry.",
};
function normalizeStartupError(error:unknown):StartupError {
  if (error && typeof error === "object") {
    const value=error as Partial<StartupError>;
    return {code:value.code??"startup_failed",message:value.message??"Could not open the local database",profilePath:value.profilePath,retryable:value.retryable??true};
  }
  return {code:"startup_failed",message:typeof error==="string"?error:"Could not open the local database",retryable:true};
}

function Workspace({
  bootstrap,
  repository,
  onRefresh,
}: {
  bootstrap: Bootstrap;
  repository: Repository;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<View>("Overview");
  const [settings, setSettings] = useState(bootstrap.settings);
  const systemDark=()=>typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches;
  const [osDark,setOsDark]=useState(systemDark);
  useEffect(()=>{if(typeof matchMedia!=="function")return;const media=matchMedia("(prefers-color-scheme: dark)");const change=()=>setOsDark(media.matches);media.addEventListener("change",change);return()=>media.removeEventListener("change",change)},[]);
  const dark=settings.theme==="dark"||(settings.theme==="system"&&osDark);
  const [expanded, setExpanded] = useState<number | null>(null);
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
      recurring: bootstrap.recurring.map(r=>({...r,endDate:r.endDate??undefined,kind:bootstrap.categories.find(c=>c.id===r.categoryId)?.kind==="income"?"income":"expense"})),
      assets: bootstrap.assets,
      liabilities: bootstrap.liabilities,
    }),
    [bootstrap],
  );
  const projections = useMemo(() => bootstrap.taxProfile ? ProjectionEngine.calculate(snapshot, baseline) : null,[snapshot,bootstrap.taxProfile]);
  return (
    <div className={dark ? "app dark" : "app"} data-reduced-motion={settings.reducedMotion||undefined}>
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
              {name === "Activity" && bootstrap.activity.length>0 && <i>{new Set(bootstrap.activity.map(x=>x.entryId)).size}</i>}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <button className="profile" disabled title="Profile menu is not available in this build">
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
            <button className="icon" aria-label="Search (not yet available)" disabled>
              <Search size={18} />
            </button>
            <button
              className="icon"
              onClick={() => setSettings(s=>({...s,theme:dark?"light":"dark"}))}
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="add" disabled title="Creation forms are not yet available in this build">
              <Plus size={17} /> Add (unavailable)
            </button>
          </div>
        </header>
        {view === "Overview" && <Overview bootstrap={bootstrap} projections={projections} navigate={setView} />}
        {view === "Activity" && <ActivityView activity={bootstrap.activity} accounts={bootstrap.accounts} />}
        {view === "Plan" && projections && (
          <PlanView
            projections={projections}
            expanded={expanded}
            setExpanded={setExpanded}
          />
        )}
        {view === "Plan" && !projections && <div className="content"><section className="card"><h2>Complete your tax profile</h2><p>Projected plan values are hidden until a filing status and supported tax year are saved.</p><button onClick={()=>setView("Settings")}>Open Settings</button></section></div>}
        {view === "Net Worth" && <NetWorth snapshot={snapshot} />}
        {view === "Settings" && (
          <SettingsView
            settings={settings}
            setSettings={setSettings}
            bootstrap={bootstrap}
            repository={repository}
            onSaved={onRefresh}
          />
        )}
      </main>
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
  const [filingStatus,setFilingStatus]=useState("");
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
      if(!filingStatus){setError("Select a filing status before finishing setup.");return;}
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
          taxProfile:{filingStatus,state:"CA",taxYear:2026,thresholdInflationBps:250,revision:1},
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
              <label>Filing status<select aria-label="Filing status" value={filingStatus} onChange={e=>setFilingStatus(e.target.value)}><option value="">Select…</option><option value="single">Single</option><option value="married-joint">Married filing jointly</option><option value="married-separate">Married filing separately</option><option value="head-of-household">Head of household</option></select></label>
              <p className="muted">Required for tax-dependent projections. California and the 2026 rule pack are used.</p>
              {accounts.map((a, i) => (
                <fieldset className="repeat-row" key={a.id}>
                  <legend>Account {i + 1}</legend>
                  <fieldset
                    className="account-types"
                  >
                    <legend>Account {i + 1} type</legend>
                    {accountKinds.map((k) => (
                      <label
                        className={a.kind === k.value ? "selected" : ""}
                        key={k.value}
                      >
                        <input type="radio" name={`account-${i}-type`} value={k.value} checked={a.kind===k.value} onChange={()=>setAccounts(updateAt(accounts,i,{kind:k.value}))}/>
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
  balanceCents:0,
  annualReturnBps: 0,
  liquid: true,
  revision: 1,
});
const updateAt = <T,>(items: T[], index: number, patch: Partial<T>) =>
  items.map((item, i) => (i === index ? { ...item, ...patch } : item));
const validMoney = (value: string) =>
  parseMoney(value)!==undefined;
function parseMoney(value:string):number|undefined{
  const match=/^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if(!match)return undefined;
  const cents=BigInt(match[2])*100n+BigInt((match[3]??"").padEnd(2,"0"));
  if(cents>99_999_999_999_999n)return undefined;
  return Number((match[1]? -cents:cents));
}
const toAccount = (a: AccountDraft): BootstrapAccount => ({
  ...a,
  openingBalanceCents:a.kind==="credit"?-Math.abs(parseMoney(a.balance)!):parseMoney(a.balance)!,
  balanceCents:a.kind==="credit"?-Math.abs(parseMoney(a.balance)!):parseMoney(a.balance)!,
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
  bootstrap:Bootstrap;
  projections: ReturnType<typeof ProjectionEngine.calculate>|null;
  navigate:(view:View)=>void;
}) {
  const currentNetWorth=bootstrap.accounts.reduce((sum,a)=>sum+a.balanceCents,0)+bootstrap.assets.reduce((sum,a)=>sum+a.valueCents,0)-bootstrap.liabilities.reduce((sum,a)=>sum+a.balanceCents,0);
  const year=String(new Date().getFullYear());
  const actual=bootstrap.activity.filter(x=>x.occurredOn.startsWith(year)&&x.kind!=="transfer");
  const income=actual.filter(x=>x.kind==="income").reduce((s,x)=>s+x.amountCents,0);
  const spending=-actual.filter(x=>x.kind==="expense").reduce((s,x)=>s+x.amountCents,0);
  return (
    <div className="content">
      <section className="hero">
        <div>
          <span className="label actual">Current balance</span>
          <p className="hero-label">Net worth</p>
          <h2>{money(currentNetWorth)}</h2>
          <p className="muted">Based on current account, asset, and liability balances.</p>
        </div>
        <div className="hero-chart"><p className="muted">Historical net-worth trend unavailable: no dated balance history has been recorded.</p></div>
      </section>
      <div className="metrics">
        <Metric
          title="Income"
          value={money(income)} change={`${year} actual`}
          icon={ArrowDownRight}
        />
        <Metric
          title="Spending"
          value={money(spending)} change={`${year} actual`}
          icon={ArrowUpRight}
          negative
        />
        <Metric
          title="Saved"
          value={money(income-spending)} change="Income minus spending"
          icon={PiggyBank}
        />
        <Metric
          title="Taxes"
          value={projections?money(projections[0]?.taxCents??0):"Unavailable"}
          change={projections?"Projected":"Tax profile required"}
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
            <button onClick={()=>navigate("Activity")}>
              View all <ChevronRight size={14} />
            </button>
          </div>
          <p className="empty">
            No transactions have been recorded.
          </p>
        </section>
        <section className="card">
          <div className="card-title">
            <div>
              <span className="label assumption">Assumption</span>
              <h3>Your plan at a glance</h3>
            </div>
            <button onClick={()=>navigate("Plan")}>
              Open plan <ChevronRight size={14} />
            </button>
          </div>
          {projections?<p>Projected values use your saved tax profile and planning assumptions. Open Plan for the monthly reconciliation.</p>:<p>Complete your tax profile before LifeLook calculates projections.</p>}
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

function ActivityView({activity,accounts}:{activity:ActivityPosting[];accounts:BootstrapAccount[]}) {
  const [query,setQuery]=useState(""); const [account,setAccount]=useState("all"); const [year,setYear]=useState(String(new Date().getFullYear()));
  const rows=activity.filter(x=>(account==="all"||x.accountId===account)&&(year==="all"||x.occurredOn.startsWith(year))&&`${x.description} ${x.accountName} ${x.categoryName??""}`.toLowerCase().includes(query.toLowerCase()));
  const total=rows.filter(x=>x.kind!=="transfer").reduce((sum,x)=>sum+x.amountCents,0);
  const years=[...new Set(activity.map(x=>x.occurredOn.slice(0,4)))].sort().reverse();
  return (
    <div className="content">
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Search activity"
            placeholder="Search transactions"
            value={query} onChange={e=>setQuery(e.target.value)}
          />
        </div>
        <label className="sr-only" htmlFor="activity-account">Account</label><select id="activity-account" value={account} onChange={e=>setAccount(e.target.value)}><option value="all">All accounts</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select>
        <label className="sr-only" htmlFor="activity-year">Year</label><select id="activity-year" value={year} onChange={e=>setYear(e.target.value)}><option value="all">All years</option>{years.map(y=><option key={y}>{y}</option>)}</select>
      </div>
      <section className="card wide">
        <div className="card-title">
          <div>
            <span className="label actual">Actual</span>
            <h3>Activity</h3>
          </div>
          <strong className={total<0?"negative":"positive"}>{money(total)}</strong>
        </div>
        {rows.map((row) => (
          <Transaction
            key={`${row.entryId}-${row.postingId}`}
            icon={row.kind==="income"?ArrowDownRight:row.kind==="transfer"?WalletCards:ArrowUpRight}
            name={row.description||row.kind}
            detail={`${row.accountName} · ${row.categoryName??"Transfer"} · ${row.occurredOn}`}
            amount={money(row.amountCents)} positive={row.amountCents>0}
          />
        ))}
        {!rows.length&&<p className="empty">{activity.length?"No activity matches these filters.":"No transactions have been recorded."}</p>}
      </section>
    </div>
  );
}

function PlanView({
  projections,
  expanded,
  setExpanded,
}: {
  projections: ReturnType<typeof ProjectionEngine.calculate>;
  expanded: number | null;
  setExpanded: (x: number | null) => void;
}) {
  return (
    <div className="content">
      <div className="scenario-bar">
        <div>
          <span className="label assumption">Assumptions</span>
          <h3>Baseline plan</h3>
        </div>
        <button disabled title="Scenario comparison editor is not yet available">Compare scenarios (unavailable)</button>
      </div>
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
                <div className="months" id={`plan-months-${year.year}`} role="region" aria-label={`${year.year} monthly detail`}>
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
function NetWorth({ snapshot }: { snapshot: FinancialSnapshot }) {
  const assets =
      snapshot.accounts.reduce((s, a) => s + Math.max(0,a.balanceCents), 0) +
      snapshot.assets.reduce((s, a) => s + a.valueCents, 0),
    debt = snapshot.liabilities.reduce((s, l) => s + l.balanceCents, 0)+snapshot.accounts.reduce((s,a)=>s+Math.max(0,-a.balanceCents),0),
    netWorth=snapshot.accounts.reduce((s,a)=>s+a.balanceCents,0)+snapshot.assets.reduce((s,a)=>s+a.valueCents,0)-snapshot.liabilities.reduce((s,l)=>s+l.balanceCents,0);
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
          <button disabled title="Account editing is not yet available">
            <Plus size={14} /> Add account (unavailable)
          </button>
        </div>
        {snapshot.accounts.filter(a=>a.balanceCents>=0).map((a) => (
          <div className="account" key={a.id}>
            <span className="transaction-icon">
              <WalletCards size={17} />
            </span>
            <div>
              <strong>{a.name}</strong>
              <small>{a.kind}</small>
            </div>
            <b>{money(a.balanceCents)}</b>
          </div>
        ))}
        {snapshot.assets.map((a) => (
          <div className="account" key={a.id}>
            <span className="transaction-icon">
              <Building2 size={17} />
            </span>
            <div>
              <strong>{a.name}</strong>
              <small>Asset</small>
            </div>
            <b>{money(a.valueCents)}</b>
          </div>
        ))}
        {!snapshot.accounts.length&&!snapshot.assets.length&&<p className="empty">No accounts or assets yet.</p>}
      </section>
      {(debt>0)&&<section className="card wide"><div className="card-title"><div><span className="label actual">Current balance</span><h3>Credit & liabilities</h3></div></div>{snapshot.accounts.filter(a=>a.balanceCents<0).map(a=><div className="account" key={a.id}><span className="transaction-icon"><WalletCards size={17}/></span><div><strong>{a.name}</strong><small>Credit balance</small></div><b>{money(-a.balanceCents)}</b></div>)}{snapshot.liabilities.map(l=><div className="account" key={l.id}><span className="transaction-icon"><Building2 size={17}/></span><div><strong>{l.name}</strong><small>Liability</small></div><b>{money(l.balanceCents)}</b></div>)}</section>}
    </div>
  );
}
function errorMessage(error:unknown,fallback:string){
  if(typeof error==="string")return error;
  if(error&&typeof error==="object"&&typeof (error as {message?:unknown}).message==="string")return (error as {message:string}).message;
  return fallback;
}
function SettingsView({
  settings,
  setSettings,
  bootstrap,
  repository,
  onSaved,
}: {
  settings: Bootstrap["settings"];
  setSettings: (x:Bootstrap["settings"]|((old:Bootstrap["settings"])=>Bootstrap["settings"])) => void;
  bootstrap: Bootstrap;
  repository: Repository;
  onSaved: () => void;
}) {
  const [people, setPeople] = useState<BootstrapPerson[]>(
    bootstrap.people.map((person) => ({
      ...person,
      birthDate: displayBirthDate(person.birthDate),
    })),
  );
  const [message, setMessage] = useState("");
  const [appearanceSaving,setAppearanceSaving]=useState(false);
  const [memberSaving,setMemberSaving]=useState(false);
  const [memberResult,setMemberResult]=useState<{kind:"error"|"success";message:string}|null>(null);
  const memberAlert=useRef<HTMLParagraphElement>(null);
  async function saveAppearance(patch:Partial<Bootstrap["settings"]>){
    const next={...settings,...patch};setAppearanceSaving(true);setMessage("");
    try{if(!repository.updateSettings)throw new Error("Settings persistence is unavailable.");const saved=await repository.updateSettings({theme:next.theme,reducedMotion:next.reducedMotion,expectedRevision:settings.revision});setSettings(saved);setMessage("Appearance saved.")}catch(e){setMessage((e as {message?:string}).message??"Could not save appearance.")}finally{setAppearanceSaving(false)}
  }
  async function savePeople() {
    if(memberSaving)return;
    setMemberResult(null);
    if (people.some((p) => !p.name.trim())) {
      setMemberResult({kind:"error",message:"Every household member needs a name."});
      queueMicrotask(()=>memberAlert.current?.focus());
      return;
    }
    const invalidDate = people.findIndex(
      (person) => parseBirthDate(person.birthDate) === undefined,
    );
    if (invalidDate >= 0) {
      setMemberResult({kind:"error",message:`Member ${invalidDate + 1}: enter a valid birth date as MM/DD/YYYY.`});
      queueMicrotask(()=>memberAlert.current?.focus());
      return;
    }
    setMemberSaving(true);
    try { await repository.saveOnboardingStep(8, {
      people: people.map((p) => ({
        ...p,
        name: p.name.trim(),
        birthDate: parseBirthDate(p.birthDate),
      })),
    });
    setMemberResult({kind:"success",message:"Household members saved."});
    onSaved();
    } catch(error) {
      setMemberResult({kind:"error",message:errorMessage(error,"Could not save household members.")});
      queueMicrotask(()=>memberAlert.current?.focus());
    } finally { setMemberSaving(false); }
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
          <button className="primary" disabled={memberSaving} onClick={savePeople}>
            {memberSaving?"Saving…":"Save members"}
          </button>
        </div>
        {memberResult?.kind==="error"&&<p ref={memberAlert} tabIndex={-1} role="alert" className="negative">{memberResult.message}</p>}
        {memberResult?.kind==="success"&&<p role="status">{memberResult.message}</p>}
        {message && <p role="status">{message}</p>}
      </section>
      <section className="card settings-card">
        <h3>Appearance</h3>
        <div className="setting">
          <fieldset><legend>Theme</legend>{(["system","light","dark"] as Theme[]).map(theme=><label key={theme}><input type="radio" name="theme" checked={settings.theme===theme} disabled={appearanceSaving} onChange={()=>saveAppearance({theme})}/>{theme[0].toUpperCase()+theme.slice(1)}</label>)}</fieldset>
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
            className={settings.reducedMotion?"switch on":"switch"}
            disabled={appearanceSaving} onClick={()=>saveAppearance({reducedMotion:!settings.reducedMotion})}
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
          <button disabled title="Backup file selection is not yet available">Back up data (unavailable)</button>
        </div>
        <div className="setting">
          <div>
            <strong>Restore</strong>
            <p>Replace local data from a LifeLook backup.</p>
          </div>
          <button disabled title="Restore is not yet available">Choose backup (unavailable)</button>
        </div>
      </section>
    </div>
  );
}
