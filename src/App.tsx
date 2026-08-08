import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Building2, ChevronDown, ChevronRight, CircleDollarSign, Command, Landmark, LayoutDashboard, Moon, MoreHorizontal, PiggyBank, Plus, Search, Settings, Sparkles, Sun, WalletCards } from "lucide-react";
import { ProjectionEngine, type FinancialSnapshot, type Scenario } from "./domain";

type View = "Overview" | "Activity" | "Plan" | "Net Worth" | "Settings";
const nav: [View, typeof LayoutDashboard][] = [["Overview", LayoutDashboard], ["Activity", Activity], ["Plan", PiggyBank], ["Net Worth", Landmark], ["Settings", Settings]];
const money = (cents: number, compact = false) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: compact ? 0 : 2, notation: compact ? "compact" : "standard" }).format(cents / 100);

const snapshot: FinancialSnapshot = {
  household: { id: "h1", name: "The Parkers", state: "CA", people: [{ id: "p1", name: "Alex" }] },
  taxProfile: { filingStatus: "married-joint", state: "CA", taxYear: 2025, thresholdInflationBps: 250 },
  accounts: [
    { id: "checking", name: "Everyday checking", kind: "checking", balanceCents: 1845020, annualReturnBps: 0, liquid: true },
    { id: "savings", name: "High-yield savings", kind: "savings", balanceCents: 4268000, annualReturnBps: 420, liquid: true },
    { id: "401k", name: "401(k)", kind: "retirement", balanceCents: 12840000, annualReturnBps: 650, liquid: false }
  ],
  recurring: [
    { id: "salary", name: "Household income", kind: "income", amountCents: 1625000, startDate: "2025-01-01", annualGrowthBps: 300 },
    { id: "living", name: "Living expenses", kind: "expense", amountCents: 785000, startDate: "2025-01-01", annualGrowthBps: 250 }
  ],
  assets: [{ id: "home", name: "Primary home", valueCents: 78000000, annualGrowthBps: 300 }],
  liabilities: [{ id: "mortgage", name: "Mortgage", balanceCents: 48620000, annualRateBps: 625, minimumPaymentCents: 312000 }]
};
const baseline: Scenario = { id: "base", name: "Baseline", assumptions: { inflationBps: 250, thresholdInflationBps: 250 }, events: [], allocations: [{ accountId: "savings", percentBps: 10000, priority: 1 }], horizon: { start: "2025-01", months: 120 } };

export function App() {
  const [view, setView] = useState<View>("Overview");
  const [dark, setDark] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const projections = useMemo(() => ProjectionEngine.calculate(snapshot, baseline), []);
  return <div className={dark ? "app dark" : "app"}>
    <aside>
      <div className="brand"><span className="brandmark"><Sparkles size={17}/></span><span>LifeLook</span></div>
      <nav aria-label="Primary navigation">{nav.map(([name, Icon]) => <button key={name} className={view === name ? "active" : ""} onClick={() => setView(name)}><Icon size={18}/><span>{name}</span>{name === "Activity" && <i>12</i>}</button>)}</nav>
      <div className="aside-bottom"><button className="profile"><span>AP</span><div><strong>Alex Parker</strong><small>Local workspace</small></div><MoreHorizontal size={17}/></button></div>
    </aside>
    <main>
      <header><div><p className="eyebrow">{snapshot.household.name}</p><h1>{view}</h1></div><div className="header-actions"><button className="icon" aria-label="Search"><Search size={18}/></button><button className="icon" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="add"><Plus size={17}/> Add <ChevronDown size={14}/></button></div></header>
      {view === "Overview" && <Overview projections={projections}/>} 
      {view === "Activity" && <ActivityView/>}
      {view === "Plan" && <PlanView projections={projections} expanded={expanded} setExpanded={setExpanded}/>} 
      {view === "Net Worth" && <NetWorth/>}
      {view === "Settings" && <SettingsView dark={dark} setDark={setDark}/>} 
    </main>
  </div>;
}

function Overview({ projections }: { projections: ReturnType<typeof ProjectionEngine.calculate> }) {
  const current = projections[0];
  return <div className="content">
    <section className="hero"><div><span className="label projected">Projected · Dec 2025</span><p className="hero-label">Net worth</p><h2>{money(current.endingNetWorthCents)}</h2><p className="positive"><ArrowUpRight size={16}/> {money(2948200)} this year</p></div><div className="hero-chart" aria-label="Net worth trend chart"><svg viewBox="0 0 500 150" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d7965" stopOpacity=".22"/><stop offset="1" stopColor="#6d7965" stopOpacity="0"/></linearGradient></defs><path className="area" d="M0 134 C70 124 80 105 140 108 S220 84 270 89 S350 58 390 63 S455 25 500 18 V150 H0Z"/><path className="line" d="M0 134 C70 124 80 105 140 108 S220 84 270 89 S350 58 390 63 S455 25 500 18"/></svg><div className="axis"><span>Jan</span><span>Apr</span><span>Jul</span><span>Oct</span><span>Dec</span></div></div></section>
    <div className="metrics"><Metric title="Income" value={money(current.incomeCents)} change="3.2%" icon={ArrowDownRight}/><Metric title="Spending" value={money(current.expenseCents)} change="1.8%" icon={ArrowUpRight} negative/><Metric title="Saved" value={money(current.surplusCents)} change="24.6% rate" icon={PiggyBank}/><Metric title="Taxes" value={money(current.taxCents)} change="Estimated" icon={CircleDollarSign} neutral/></div>
    <div className="two-col"><section className="card"><div className="card-title"><div><span className="label actual">Actual</span><h3>Recent activity</h3></div><button>View all <ChevronRight size={14}/></button></div><Transaction icon={Building2} name="Mortgage payment" detail="Home · Today" amount="−$3,120.00"/><Transaction icon={WalletCards} name="Payroll deposit" detail="Income · Aug 1" amount="+$8,125.00" positive/><Transaction icon={Command} name="Whole Foods Market" detail="Groceries · Jul 30" amount="−$184.32"/></section>
      <section className="card"><div className="card-title"><div><span className="label assumption">Assumption</span><h3>Your plan at a glance</h3></div><button>Open plan <ChevronRight size={14}/></button></div><div className="plan-row"><span>Retirement target</span><strong>2048</strong></div><div className="plan-row"><span>Annual return</span><strong>6.5%</strong></div><div className="plan-row"><span>Inflation</span><strong>2.5%</strong></div><div className="callout"><Sparkles size={17}/><div><strong>You’re on track</strong><p>At this pace, your plan funds 92% of your target lifestyle.</p></div></div></section></div>
  </div>;
}
function Metric({ title, value, change, icon: Icon, negative, neutral }: {title:string,value:string,change:string,icon:typeof Activity,negative?:boolean,neutral?:boolean}) { return <section className="metric"><div className="metric-head"><span>{title}</span><Icon size={17}/></div><strong>{value}</strong><small className={neutral ? "neutral" : negative ? "negative" : "positive"}>{change}</small></section> }
function Transaction({icon:Icon,name,detail,amount,positive}:{icon:typeof Activity,name:string,detail:string,amount:string,positive?:boolean}) { return <div className="transaction"><span className="transaction-icon"><Icon size={17}/></span><div><strong>{name}</strong><small>{detail}</small></div><b className={positive ? "positive" : ""}>{amount}</b></div> }

function ActivityView() { return <div className="content"><div className="toolbar"><div className="search"><Search size={17}/><input aria-label="Search activity" placeholder="Search transactions"/></div><button>All accounts <ChevronDown size={14}/></button><button>This year <ChevronDown size={14}/></button></div><section className="card wide"><div className="card-title"><div><span className="label actual">Actual</span><h3>August 2025</h3></div><strong className="negative">−$4,916.80</strong></div>{[[Building2,"Mortgage payment","Home · Today","−$3,120.00"],[WalletCards,"Payroll deposit","Income · Aug 1","+$8,125.00"],[Command,"Whole Foods Market","Groceries · Jul 30","−$184.32"],[CircleDollarSign,"Pacific Gas & Electric","Utilities · Jul 28","−$162.48"]].map(([i,n,d,a],x)=><Transaction key={n as string} icon={i as typeof Activity} name={n as string} detail={d as string} amount={a as string} positive={x===1}/>)}</section></div> }

function PlanView({projections,expanded,setExpanded}:{projections:ReturnType<typeof ProjectionEngine.calculate>,expanded:number|null,setExpanded:(x:number|null)=>void}) { return <div className="content"><div className="scenario-bar"><div><span className="label assumption">Assumptions</span><h3>Baseline plan</h3></div><button>Compare scenarios</button></div><section className="card wide"><div className="card-title"><div><span className="label projected">Projected</span><h3>10-year outlook</h3></div><small>Click a year for monthly detail</small></div><div className="year-table"><div className="year-row table-head"><span>Year</span><span>Income</span><span>Spending</span><span>Taxes</span><span>Net worth</span></div>{projections.map(year => <div key={year.year}><button className="year-row" onClick={()=>setExpanded(expanded===year.year?null:year.year)}><span>{expanded===year.year?<ChevronDown size={15}/>:<ChevronRight size={15}/>} {year.year}</span><span>{money(year.incomeCents,true)}</span><span>{money(year.expenseCents,true)}</span><span>{money(year.taxCents,true)}</span><strong>{money(year.endingNetWorthCents,true)}</strong></button>{expanded===year.year&&<div className="months">{year.months.map(m=><div key={m.month}><span>{new Date(m.month+"-02").toLocaleDateString("en",{month:"short"})}</span><span>{money(m.incomeCents,true)}</span><span>{money(m.expenseCents,true)}</span><span>{money(m.taxCents,true)}</span><strong>{money(m.netWorthCents,true)}</strong></div>)}</div>}</div>)}</div></section></div> }
function NetWorth() { const assets=1845020+4268000+12840000+78000000, debt=48620000; return <div className="content"><div className="metrics"><Metric title="Total assets" value={money(assets)} change="4 accounts" icon={WalletCards} neutral/><Metric title="Total debt" value={money(debt)} change="1 liability" icon={Building2} neutral/><Metric title="Net worth" value={money(assets-debt)} change="+$29,482 this year" icon={Landmark}/></div><section className="card wide"><div className="card-title"><div><span className="label actual">Current balance</span><h3>Accounts & assets</h3></div><button><Plus size={14}/> Add account</button></div>{snapshot.accounts.map(a=><div className="account" key={a.id}><span className="transaction-icon"><WalletCards size={17}/></span><div><strong>{a.name}</strong><small>{a.kind}</small></div><b>{money(a.balanceCents)}</b></div>)}<div className="account"><span className="transaction-icon"><Building2 size={17}/></span><div><strong>Primary home</strong><small>Real estate</small></div><b>{money(78000000)}</b></div></section></div> }
function SettingsView({dark,setDark}:{dark:boolean,setDark:(x:boolean)=>void}) { return <div className="content"><section className="card settings-card"><h3>Appearance</h3><div className="setting"><div><strong>Dark theme</strong><p>Use a darker, low-glare appearance.</p></div><button role="switch" aria-checked={dark} className={dark?"switch on":"switch"} onClick={()=>setDark(!dark)}><span/></button></div><div className="setting"><div><strong>Reduced motion</strong><p>Minimize interface animation.</p></div><button role="switch" aria-checked="false" className="switch"><span/></button></div></section><section className="card settings-card"><h3>Data & privacy</h3><div className="setting"><div><strong>Local database</strong><p>Your financial data stays on this device.</p></div><button>Back up data</button></div><div className="setting"><div><strong>Restore</strong><p>Replace local data from a LifeLook backup.</p></div><button>Choose backup</button></div></section></div> }
