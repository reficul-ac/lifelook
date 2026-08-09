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
  type BootstrapAccount,
  type BootstrapPerson,
  type Repository,
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

export function App({
  repository = tauriRepository,
}: {
  repository?: Repository;
}) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    repository
      .bootstrap()
      .then(setBootstrap)
      .catch((error) =>
        setLoadError(error?.message ?? "Could not open the local database"),
      );
  }, [repository]);
  if (loadError)
    return (
      <main className="standalone">
        <section className="card">
          <h1>LifeLook couldn’t open your data</h1>
          <p role="alert">{loadError}</p>
          <button onClick={() => location.reload()}>Try again</button>
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
        onComplete={() => repository.bootstrap().then(setBootstrap)}
      />
    );
  return (
    <Workspace
      bootstrap={bootstrap}
      repository={repository}
      onRefresh={() => repository.bootstrap().then(setBootstrap)}
    />
  );
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
  const [dark, setDark] = useState(false);
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
      taxProfile: {
        filingStatus: "single",
        state: "CA",
        taxYear: 2025,
        thresholdInflationBps: 250,
      },
      accounts: bootstrap.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        balanceCents: a.openingBalanceCents,
        annualReturnBps: a.annualReturnBps,
        liquid: a.liquid,
      })),
      recurring: [],
      assets: [],
      liabilities: [],
    }),
    [bootstrap],
  );
  const projections = useMemo(
    () => ProjectionEngine.calculate(snapshot, baseline),
    [snapshot],
  );
  return (
    <div className={dark ? "app dark" : "app"}>
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
              onClick={() => setView(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Activity" && <i>12</i>}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <button className="profile">
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
            <button className="icon" aria-label="Search">
              <Search size={18} />
            </button>
            <button
              className="icon"
              onClick={() => setDark(!dark)}
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="add">
              <Plus size={17} /> Add <ChevronDown size={14} />
            </button>
          </div>
        </header>
        {view === "Overview" && <Overview projections={projections} />}
        {view === "Activity" && <ActivityView />}
        {view === "Plan" && (
          <PlanView
            projections={projections}
            expanded={expanded}
            setExpanded={setExpanded}
          />
        )}
        {view === "Net Worth" && <NetWorth snapshot={snapshot} />}
        {view === "Settings" && (
          <SettingsView
            dark={dark}
            setDark={setDark}
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
              {accounts.map((a, i) => (
                <fieldset className="repeat-row" key={a.id}>
                  <legend>Account {i + 1}</legend>
                  <div
                    className="account-types"
                    role="radiogroup"
                    aria-label={`Account ${i + 1} type`}
                  >
                    {accountKinds.map((k) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={a.kind === k.value}
                        className={a.kind === k.value ? "selected" : ""}
                        key={k.value}
                        onClick={() =>
                          setAccounts(updateAt(accounts, i, { kind: k.value }))
                        }
                      >
                        <strong>{k.label}</strong>
                        <small>{k.help}</small>
                      </button>
                    ))}
                  </div>
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
                      ? "Enter an amount you owe as a negative number (for example, -125.40)."
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
  annualReturnBps: 0,
  liquid: true,
  revision: 1,
});
const updateAt = <T,>(items: T[], index: number, patch: Partial<T>) =>
  items.map((item, i) => (i === index ? { ...item, ...patch } : item));
const validMoney = (value: string) =>
  /^-?(?:\d+|\d*\.\d{1,2})$/.test(value.trim());
const toAccount = (a: AccountDraft): BootstrapAccount => ({
  ...a,
  openingBalanceCents: Math.round(Number(a.balance) * 100),
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
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
          onChange={(event) => onChange(event.target.value)}
        />
        <label className="calendar-control" title="Choose from calendar">
          <Calendar size={18} />
          <span className="sr-only">Choose {label} from calendar</span>
          <input
            aria-label={`Choose ${label} from calendar`}
            type="date"
            value={parseBirthDate(value) ?? ""}
            onChange={(event) => onChange(displayBirthDate(event.target.value))}
          />
        </label>
      </div>
    </div>
  );
}

function Overview({
  projections,
}: {
  projections: ReturnType<typeof ProjectionEngine.calculate>;
}) {
  const current = projections[0];
  return (
    <div className="content">
      <section className="hero">
        <div>
          <span className="label projected">Projected · Dec 2025</span>
          <p className="hero-label">Net worth</p>
          <h2>{money(current.endingNetWorthCents)}</h2>
          <p className="positive">
            <ArrowUpRight size={16} /> {money(2948200)} this year
          </p>
        </div>
        <div className="hero-chart" aria-label="Net worth trend chart">
          <svg viewBox="0 0 500 150" preserveAspectRatio="none">
            <defs>
              <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#6d7965" stopOpacity=".22" />
                <stop offset="1" stopColor="#6d7965" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              className="area"
              d="M0 134 C70 124 80 105 140 108 S220 84 270 89 S350 58 390 63 S455 25 500 18 V150 H0Z"
            />
            <path
              className="line"
              d="M0 134 C70 124 80 105 140 108 S220 84 270 89 S350 58 390 63 S455 25 500 18"
            />
          </svg>
          <div className="axis">
            <span>Jan</span>
            <span>Apr</span>
            <span>Jul</span>
            <span>Oct</span>
            <span>Dec</span>
          </div>
        </div>
      </section>
      <div className="metrics">
        <Metric
          title="Income"
          value={money(current.incomeCents)}
          change="3.2%"
          icon={ArrowDownRight}
        />
        <Metric
          title="Spending"
          value={money(current.expenseCents)}
          change="1.8%"
          icon={ArrowUpRight}
          negative
        />
        <Metric
          title="Saved"
          value={money(current.surplusCents)}
          change="24.6% rate"
          icon={PiggyBank}
        />
        <Metric
          title="Taxes"
          value={money(current.taxCents)}
          change="Estimated"
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
            <button>
              View all <ChevronRight size={14} />
            </button>
          </div>
          <p className="empty">
            No transactions yet. Use Add to record your first activity.
          </p>
        </section>
        <section className="card">
          <div className="card-title">
            <div>
              <span className="label assumption">Assumption</span>
              <h3>Your plan at a glance</h3>
            </div>
            <button>
              Open plan <ChevronRight size={14} />
            </button>
          </div>
          <div className="plan-row">
            <span>Retirement target</span>
            <strong>2048</strong>
          </div>
          <div className="plan-row">
            <span>Annual return</span>
            <strong>6.5%</strong>
          </div>
          <div className="plan-row">
            <span>Inflation</span>
            <strong>2.5%</strong>
          </div>
          <div className="callout">
            <Sparkles size={17} />
            <div>
              <strong>You’re on track</strong>
              <p>At this pace, your plan funds 92% of your target lifestyle.</p>
            </div>
          </div>
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

function ActivityView() {
  return (
    <div className="content">
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Search activity"
            placeholder="Search transactions"
          />
        </div>
        <button>
          All accounts <ChevronDown size={14} />
        </button>
        <button>
          This year <ChevronDown size={14} />
        </button>
      </div>
      <section className="card wide">
        <div className="card-title">
          <div>
            <span className="label actual">Actual</span>
            <h3>August 2025</h3>
          </div>
          <strong className="negative">−$4,916.80</strong>
        </div>
        {[
          [Building2, "Mortgage payment", "Home · Today", "−$3,120.00"],
          [WalletCards, "Payroll deposit", "Income · Aug 1", "+$8,125.00"],
          [Command, "Whole Foods Market", "Groceries · Jul 30", "−$184.32"],
          [
            CircleDollarSign,
            "Pacific Gas & Electric",
            "Utilities · Jul 28",
            "−$162.48",
          ],
        ].map(([i, n, d, a], x) => (
          <Transaction
            key={n as string}
            icon={i as typeof Activity}
            name={n as string}
            detail={d as string}
            amount={a as string}
            positive={x === 1}
          />
        ))}
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
        <button>Compare scenarios</button>
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
                <div className="months">
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
      snapshot.accounts.reduce((s, a) => s + a.balanceCents, 0) +
      snapshot.assets.reduce((s, a) => s + a.valueCents, 0),
    debt = snapshot.liabilities.reduce((s, l) => s + l.balanceCents, 0);
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
          value={money(assets - debt)}
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
          <button>
            <Plus size={14} /> Add account
          </button>
        </div>
        {snapshot.accounts.map((a) => (
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
      </section>
    </div>
  );
}
function SettingsView({
  dark,
  setDark,
  bootstrap,
  repository,
  onSaved,
}: {
  dark: boolean;
  setDark: (x: boolean) => void;
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
  async function savePeople() {
    if (people.some((p) => !p.name.trim())) {
      setMessage("Every household member needs a name.");
      return;
    }
    const invalidDate = people.findIndex(
      (person) => parseBirthDate(person.birthDate) === undefined,
    );
    if (invalidDate >= 0) {
      setMessage(
        `Member ${invalidDate + 1}: enter a valid birth date as MM/DD/YYYY.`,
      );
      return;
    }
    await repository.saveOnboardingStep(8, {
      people: people.map((p) => ({
        ...p,
        name: p.name.trim(),
        birthDate: parseBirthDate(p.birthDate),
      })),
    });
    setMessage("Household members saved.");
    onSaved();
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
              onChange={(e) =>
                setPeople(updateAt(people, i, { name: e.target.value }))
              }
            />
            <BirthDateField
              label={`Member ${i + 1} birth date`}
              value={p.birthDate ?? ""}
              onChange={(birthDate) =>
                setPeople(updateAt(people, i, { birthDate }))
              }
            />
            {people.length > 1 && (
              <button
                onClick={() => setPeople(people.filter((_, x) => x !== i))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="form-actions">
          <button
            onClick={() =>
              setPeople([...people, newPerson(bootstrap.household!.id)])
            }
          >
            <Plus size={14} /> Add person
          </button>
          <button className="primary" onClick={savePeople}>
            Save members
          </button>
        </div>
        {message && <p role="status">{message}</p>}
      </section>
      <section className="card settings-card">
        <h3>Appearance</h3>
        <div className="setting">
          <div>
            <strong>Dark theme</strong>
            <p>Use a darker, low-glare appearance.</p>
          </div>
          <button
            role="switch"
            aria-checked={dark}
            className={dark ? "switch on" : "switch"}
            onClick={() => setDark(!dark)}
          >
            <span />
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Reduced motion</strong>
            <p>Minimize interface animation.</p>
          </div>
          <button role="switch" aria-checked="false" className="switch">
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
          <button>Back up data</button>
        </div>
        <div className="setting">
          <div>
            <strong>Restore</strong>
            <p>Replace local data from a LifeLook backup.</p>
          </div>
          <button>Choose backup</button>
        </div>
      </section>
    </div>
  );
}
