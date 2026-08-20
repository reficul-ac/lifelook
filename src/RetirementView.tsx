import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateRetirementOutlook,
  ProjectionEngine,
  defaultRetirementPlan,
  defaultRetirementTaxAssumptions,
  type AnnualProjection,
  type FinancialSnapshot,
  type RetirementExpenseBucket,
  type RetirementIncome,
  type RetirementPlanRecord,
  type Scenario,
} from "./domain";
import type { Bootstrap, Repository } from "./repository";
import { AnchoredMenu, DetailDisclosure, OverflowMenu } from "./ui";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n / 100);
const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `ret-${Date.now()}-${Math.random()}`;
export function RetirementView({
  initial,
  repository,
  bootstrap,
  snapshot,
  scenarios,
  projections,
  onPlanChange,
}: {
  initial?: RetirementPlanRecord | null;
  repository: Repository;
  bootstrap: Bootstrap;
  snapshot: FinancialSnapshot;
  scenarios: Scenario[];
  projections: readonly AnnualProjection[];
  onPlanChange?: (p: RetirementPlanRecord) => void;
}) {
  const loaded = {
    ...defaultRetirementPlan(),
    ...initial,
    taxAssumptions: {
      ...defaultRetirementTaxAssumptions(),
      ...initial?.taxAssumptions,
    },
    householdId: initial?.householdId ?? bootstrap.household?.id ?? "local",
    selectedScenarioId: initial?.selectedScenarioId || scenarios[0]?.id || "",
  } as RetirementPlanRecord;
  const [plan, setPlan] = useState<RetirementPlanRecord>(() => ({
    ...loaded,
    retirementYears:
      loaded.retirementYears ??
      Object.fromEntries(
        bootstrap.people.map((p) => [p.id, loaded.retirementYear]),
      ),
    scheduledIncome: loaded.scheduledIncome ?? [],
    withdrawalAccountOrder:
      loaded.withdrawalAccountOrder ??
      [...snapshot.accounts]
        .sort(
          (a, b) =>
            ({
              checking: 0,
              savings: 0,
              investment: 1,
              retirement: 2,
              credit: 3,
            })[a.kind] -
            {
              checking: 0,
              savings: 0,
              investment: 1,
              retirement: 2,
              credit: 3,
            }[b.kind],
        )
        .map((a) => a.id),
  }));
  const [save, setSave] = useState("idle");
  const revision = useRef(plan.revision),
    first = useRef(true);
  const scenario =
      scenarios.find((s) => s.id === plan.selectedScenarioId) ?? scenarios[0],
    cutoffYear=Math.max(plan.retirementYear,...Object.values(plan.retirementYears??{})),
    handoffProjections=useMemo(()=>{if(!scenario)return projections;const existing=projections.find(p=>p.year===cutoffYear)?.months.some(month=>month.month===`${cutoffYear}-12`&&month.balances);if(existing)return projections;const now=new Date(),months=Math.max(1,(cutoffYear-now.getFullYear()+1)*12-now.getMonth());try{return ProjectionEngine.calculate(snapshot,{...scenario,retirementExtension:true,horizon:{...scenario.horizon,months:Math.min(1200,months)}} as Scenario&{retirementExtension:true},now.toISOString().slice(0,10))}catch{return projections}},[scenario,projections,snapshot,cutoffYear]),
    result = useMemo(
      () =>
        scenario
          ? calculateRetirementOutlook({
              plan,
              accounts: snapshot.accounts,
              assets: snapshot.assets,
              liabilities: snapshot.liabilities,
              scenario,
              projections:handoffProjections,
              currentYear: new Date().getFullYear(),
              filingStatus: snapshot?.taxProfile?.filingStatus??"single",
              people: bootstrap.people,
              recurring: snapshot.recurring,
            })
          : null,
      [plan, snapshot, scenario, handoffProjections, bootstrap.people],
    );
  useEffect(() => {
    onPlanChange?.(plan);
    if (first.current) {
      first.current = false;
      return;
    }
    if (!repository.updateRetirementPlan) return;
    setSave("saving");
    repository
      .updateRetirementPlan({ ...plan, expectedRevision: revision.current })
      .then((x) => {
        revision.current = x.revision;
        setSave("saved");
      })
      .catch(() => setSave("error"));
  }, [plan]);
  const update = <K extends keyof RetirementPlanRecord>(
    key: K,
    value: RetirementPlanRecord[K],
  ) => setPlan((p) => ({ ...p, [key]: value }));
  if (!scenario || !result)
    return (
      <div className="content">
        <section className="card">
          <h2>Create a Plan scenario first</h2>
        </section>
      </div>
    );
  const row = result.years[0],
    legacy = plan.portfolioItems.length && !plan.legacyReviewDismissed;
  return (
    <div className="content retirement-view">
      <section className="card retirement-header">
        <div>
          <p className="eyebrow">Uses the active Plan scenario</p>
          <h2>Retirement outlook</h2>
          <p>
            {scenario.name} · activity included through December 31 of each
            selected retirement year
          </p>
        </div>
        <span className={`save-state ${save}`}>
          {save === "saving"
            ? "Saving…"
            : save === "saved"
              ? "Saved"
              : save === "error"
                ? "Save failed"
                : ""}
        </span>
        <label>
            Household retires together
            <select
              value={plan.retirementYear}
              onChange={(e) => {const year=+e.target.value;setPlan(p=>({...p,retirementYear:year,retirementYears:Object.fromEntries(bootstrap.people.map(person=>[person.id,year]))}))}}
            >
              {Array.from(
                { length: 61 },
                (_, i) => new Date().getFullYear() + i,
              ).map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
        <label>Spending<select value={plan.spendingMode??"manual"} onChange={e=>update("spendingMode",e.target.value as "manual"|"plan")}><option value="manual">Manual budget</option><option value="plan">Use Plan expenses</option></select></label>
        <label>Scenario<select value={plan.selectedScenarioId} onChange={e=>update("selectedScenarioId",e.target.value)}>{scenarios.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </section>
      <section className="card">
        <details>
          <summary>Retirement tax assumptions</summary>
          <p className="muted">Optional annual planning inputs. Dollar amounts grow with scenario inflation.</p>
          <div className="form-grid">
            {([['annualQcdCents','Annual QCD target'],['charitableCents','Charitable expenses'],['medicalCents','Medical expenses'],['federalShortLossCents','Federal short-term loss carryforward'],['federalLongLossCents','Federal long-term loss carryforward'],['californiaShortLossCents','California short-term loss carryforward'],['californiaLongLossCents','California long-term loss carryforward']] as const).map(([key,label])=><label key={key}>{label}<input type="number" min="0" step="1" value={(plan.taxAssumptions?.[key]??0)/100} onChange={e=>update("taxAssumptions",{annualQcdCents:0,charitableCents:0,medicalCents:0,federalShortLossCents:0,federalLongLossCents:0,californiaShortLossCents:0,californiaLongLossCents:0,mfsLivedApartAllYear:false,...plan.taxAssumptions,[key]:Math.max(0,Math.round(Number(e.target.value)*100))})}/></label>)}
            {snapshot.taxProfile?.filingStatus==="married-separate"&&<label><input type="checkbox" checked={plan.taxAssumptions?.mfsLivedApartAllYear??false} onChange={e=>update("taxAssumptions",{annualQcdCents:0,charitableCents:0,medicalCents:0,federalShortLossCents:0,federalLongLossCents:0,californiaShortLossCents:0,californiaLongLossCents:0,...plan.taxAssumptions,mfsLivedApartAllYear:e.target.checked})}/> Lived apart from spouse all year</label>}
          </div>
        </details>
      </section>
      {legacy && (
        <section className="card" role="alert">
          <strong>Legacy retirement portfolio needs review</strong>
          <p>
            These items were preserved but are not projected. Add dated, funded
            purchases to Plan or dismiss this notice.
          </p>
          <button onClick={() => update("legacyReviewDismissed", true)}>
            Dismiss legacy items
          </button>
        </section>
      )}
      {result.warnings.map((w) => (
        <p className="card muted" role="status" key={w}>
          {w}
        </p>
      ))}
      {true && (
        <>
          <section
            className={`card retirement-readiness ${result.ready === false ? "metric-bad" : ""}`}
          >
            <p className="eyebrow">Retirement readiness</p>
            <h2>
              {result.ready === null
                ? "Complete setup to see readiness"
                : result.ready
                ? "Your portfolio lasts through the plan"
                : "Your portfolio runs out"}
            </h2>
            <strong>
              {result.ready === null
                ? "Verdict withheld—use the actions above"
                : result.ready
                ? `${money(result.endingBalanceCents)} remains`
                : `Depletion begins in ${result.firstDepletionYear}`}
            </strong>
          </section>
          <BalanceChart rows={result.years} />
          <section className="retirement-cards">
            <Metric
              label={`Gross income · ${row.year}`}
              value={row.grossIncomeCents}
            />
            <Metric label={`After-tax income · ${row.year}`} value={row.afterTaxIncomeCents} />
            <Metric label={`Spending · ${row.year}`} value={row.spendingCents} />
            <Metric
              label={`${row.excessCents >= 0 ? "Excess" : "Shortfall"} · ${row.year}`}
              value={Math.abs(row.excessCents)}
              bad={row.excessCents < 0}
            />
            <Metric label={`Spendable ending balance · ${row.year}`} value={row.endingSpendableCents} />
            <Metric label={`Total net worth · ${row.year}`} value={row.netWorthCents} />
          </section>
          <DetailDisclosure
            label="View funding sources"
            householdId={plan.householdId}
            preferenceKey="retirement:funding"
          >
            <p className="muted">The complete balance-sheet handoff from the active Plan on December 31, {result.cutoffYear}: accounts plus property and other assets, less remaining debt.</p>
            <dl>
              <div><dt>Accounts</dt><dd>{money(result.cutoffAccountBalanceCents)}</dd></div>
              <div><dt>Property and other assets</dt><dd>{money(result.cutoffAssetValueCents)}</dd></div>
              <div><dt>Mortgages and other debt</dt><dd>−{money(result.cutoffLiabilityBalanceCents)}</dd></div>
            </dl>
            <ul>
              {result.portfolioParts.map((part) => (
                <li key={`${part.kind}-${part.id}`}>
                  {part.name} ({part.kind}): {money(part.valueCents)}
                </li>
              ))}
            </ul>
          </DetailDisclosure>
          <DetailDisclosure
            label="View exact yearly data"
            householdId={plan.householdId}
            preferenceKey="retirement:years"
          >
            <YearTable rows={result.years} />
          </DetailDisclosure>
        </>
      )}
      {true && (
        <>
          <AnchoredMenu
            label="Add retirement item"
            primary
            items={[
              {
                label: "Expense",
                onSelect: () =>
                  update("expenseBuckets", [
                    ...plan.expenseBuckets,
                    {
                      id: uid(),
                      name: "New expense",
                      mode: "monthly",
                      monthlyCents: 0,
                    },
                  ]),
              },
              {
                label: "Income",
                onSelect: () =>
                  update("scheduledIncome", [
                    ...(plan.scheduledIncome ?? []),
                    {
                      id: uid(),
                      name: "Social Security",
                      ownerPersonId: bootstrap.people[0]?.id ?? "",
                      startYear: new Date().getFullYear(),
                      annualAmountCents: 0,
                      annualGrowthBps: 200,
                      classification: "social-security",
                    },
                  ]),
              },
            ]}
          />
          <Editor title="Retirement budget">
            {plan.expenseBuckets.map((b) => (
              <Bucket
                key={b.id}
                bucket={b}
                change={(next) =>
                  update(
                    "expenseBuckets",
                    plan.expenseBuckets.map((x) => (x.id === b.id ? next : x)),
                  )
                }
                remove={() =>
                  update(
                    "expenseBuckets",
                    plan.expenseBuckets.filter((x) => x.id !== b.id),
                  )
                }
              />
            ))}
          </Editor>
          <Editor title="Scheduled retirement income">
            {(plan.scheduledIncome ?? []).map((x) => (
              <Income
                key={x.id}
                value={x}
                people={bootstrap.people}
                change={(next) =>
                  update(
                    "scheduledIncome",
                    plan.scheduledIncome?.map((y) =>
                      y.id === x.id ? next : y,
                    ),
                  )
                }
              />
            ))}
          </Editor>
        </>
      )}
      {true && (
        <Editor title="Account withdrawal order">
          <p className="muted">
            Only actual Plan accounts are used. Move accounts to set the order.
          </p>
          {(plan.withdrawalAccountOrder ?? []).map((id, i) => {
            const a = snapshot.accounts.find((x) => x.id === id);
            return (
              a && (
                <div className="bucket-row" key={id}>
                  <strong>
                    {i + 1}. {a.name}
                  </strong>
                  <span>{a.subtype ?? "Metadata required"}</span>
                  <OverflowMenu label={`More actions for ${a.name}`} items={[{
                    label: "Move up",
                    disabled: !i,
                    onSelect: () => {
                      const n = [...(plan.withdrawalAccountOrder ?? [])];
                      [n[i - 1], n[i]] = [n[i], n[i - 1]];
                      update("withdrawalAccountOrder", n);
                    },
                  }]}/>
                </div>
              )
            );
          })}
          <p className="muted">
            Models the 59½ rule, employer-plan age-55 separation exception, Roth
            basis/five-year treatment, and RMDs using rule pack 2026.1. Special
            exceptions are not modeled.
          </p>
          <h3>Other assets available for retirement withdrawals</h3>
          <p className="muted">
            Select stock or other non-property assets that may be liquidated after
            the listed accounts are exhausted. Property is never sold automatically.
          </p>
          <div className="source-grid">
            {snapshot.assets.filter((asset) => result.portfolioParts.some((part) => part.kind === "asset" && part.id === asset.id)).map((asset) => (
              <label className="check-row" key={asset.id}>
                <input
                  type="checkbox"
                  checked={(plan.liquidatableAssetIds??plan.selectedSourceIds).includes(asset.id)}
                  onChange={(e) =>
                    update(
                      "liquidatableAssetIds",
                      e.target.checked
                        ? [...new Set([...(plan.liquidatableAssetIds??plan.selectedSourceIds), asset.id])]
                        : (plan.liquidatableAssetIds??plan.selectedSourceIds).filter((id) => id !== asset.id),
                    )
                  }
                />
                {asset.name}
              </label>
            ))}
          </div>
          <h3>Early Roth access</h3>
          <p className="muted">Leave disabled unless contribution and conversion history supports access before the owner reaches 59½.</p>
          <div className="source-grid">{snapshot.accounts.filter(account=>account.subtype==="roth-ira"||account.subtype==="employer-roth").map(account=><label className="check-row" key={account.id}><input type="checkbox" checked={(plan.earlyRothAccountIds??[]).includes(account.id)} onChange={event=>update("earlyRothAccountIds",event.target.checked?[...new Set([...(plan.earlyRothAccountIds??[]),account.id])]:(plan.earlyRothAccountIds??[]).filter(id=>id!==account.id))}/>{account.name}</label>)}</div>
        </Editor>
      )}
    </div>
  );
}
const Metric = ({
  label,
  value,
  bad,
}: {
  label: string;
  value: number;
  bad?: boolean;
}) => (
  <article className={`card ${bad ? "metric-bad" : ""}`}>
    <small>{label}</small>
    <strong>{money(value)}</strong>
  </article>
);
const Editor = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <details className="card" open>
    <summary>
      <h2>{title}</h2>
    </summary>
    {children}
  </details>
);
function Bucket({
  bucket,
  change,
  remove,
}: {
  bucket: RetirementExpenseBucket;
  change: (b: RetirementExpenseBucket) => void;
  remove: () => void;
}) {
  return (
    <div className="bucket-row">
      <input
        aria-label="Bucket name"
        value={bucket.name}
        onChange={(e) => change({ ...bucket, name: e.target.value })}
      />
      <select
        value={bucket.mode}
        onChange={(e) =>
          change(
            e.target.value === "monthly"
              ? {
                  id: bucket.id,
                  name: bucket.name,
                  mode: "monthly",
                  monthlyCents: 0,
                }
              : {
                  id: bucket.id,
                  name: bucket.name,
                  mode: "annual",
                  annualCents: 0,
                },
          )
        }
      >
        <option value="monthly">Monthly</option>
        <option value="annual">Annual</option>
      </select>
      <input
        aria-label={`${bucket.name} amount`}
        type="number"
        value={
          (bucket.mode === "monthly"
            ? bucket.monthlyCents
            : bucket.mode === "annual"
              ? bucket.annualCents
              : 0) / 100
        }
        onChange={(e) =>
          change(
            bucket.mode === "monthly"
              ? { ...bucket, monthlyCents: +e.target.value * 100 }
              : bucket.mode === "annual"
                ? { ...bucket, annualCents: +e.target.value * 100 }
                : bucket,
          )
        }
      />
      <OverflowMenu
        label={`More options for ${bucket.name}`}
        items={[{ label: "Remove", danger: true, onSelect: remove }]}
      />
    </div>
  );
}
function Income({
  value,
  people,
  change,
}: {
  value: RetirementIncome;
  people: Bootstrap["people"];
  change: (x: RetirementIncome) => void;
}) {
  return (
    <div className="portfolio-editor">
      <input
        aria-label="Income name"
        value={value.name}
        onChange={(e) => change({ ...value, name: e.target.value })}
      />
      <select
        aria-label="Income owner"
        value={value.ownerPersonId}
        onChange={(e) => change({ ...value, ownerPersonId: e.target.value })}
      >
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label>
        Tax classification
        <select value={value.classification??"unclassified"} onChange={e=>change({...value,classification:e.target.value as RetirementIncome["classification"]})}>
          <option value="unclassified">Review required</option><option value="social-security">Social Security</option><option value="ordinary">Pension / ordinary</option><option value="nontaxable">Nontaxable</option>
        </select>
      </label>
      <label>
        Start year
        <input
          type="number"
          value={value.startYear}
          onChange={(e) => change({ ...value, startYear: +e.target.value })}
        />
      </label>
      <label>
        Annual amount
        <input
          type="number"
          value={value.annualAmountCents / 100}
          onChange={(e) =>
            change({ ...value, annualAmountCents: +e.target.value * 100 })
          }
        />
      </label>
      <label>
        Growth %
        <input
          type="number"
          value={value.annualGrowthBps / 100}
          onChange={(e) =>
            change({ ...value, annualGrowthBps: +e.target.value * 100 })
          }
        />
      </label>
      <label>
        Taxable %
        <input
          type="number"
          value={(value.taxableBps ?? 0) / 100}
          onChange={(e) =>
            change({ ...value, taxableBps: +e.target.value * 100 })
          }
        />
      </label>
    </div>
  );
}
const BalanceChart = ({
  rows,
}: {
  rows: { year: number; endingBalanceCents: number }[];
}) => {
  const [active, setActive] = useState(0);
  const max = Math.max(
      1,
      ...rows.map((r) => Math.max(0, r.endingBalanceCents)),
    ),
    w = 720,
    h = 220,
    points = rows
      .map(
        (r, i) =>
          `${(i / Math.max(1, rows.length - 1)) * w},${h - (Math.max(0, r.endingBalanceCents) / max) * (h - 20)}`,
      )
      .join(" "),
    depletion = rows.find((r) => r.endingBalanceCents <= 0);
  return (
    <section className="card">
      <h2>Portfolio runway</h2>
      <div role="slider" tabIndex={0} aria-label="Explore yearly portfolio balance" aria-valuemin={0} aria-valuemax={Math.max(0, rows.length - 1)} aria-valuenow={active} aria-valuetext={rows[active] ? `${rows[active].year}, ${money(rows[active].endingBalanceCents)}` : undefined} onPointerMove={event => { const rect=event.currentTarget.getBoundingClientRect(); setActive(Math.max(0,Math.min(rows.length-1,Math.round((event.clientX-rect.left)/Math.max(1,rect.width)*(rows.length-1))))); }} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive(value => Math.max(0, Math.min(rows.length - 1, value + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Year-by-year portfolio balance${depletion ? `; depletion begins in ${depletion.year}` : "; no depletion in the projection"}`}
      >
        <line x1="0" y1={h} x2={w} y2={h} stroke="currentColor" />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
        />
        {depletion && (
          <>
            <line
              x1={(rows.indexOf(depletion) / Math.max(1, rows.length - 1)) * w}
              y1="0"
              x2={(rows.indexOf(depletion) / Math.max(1, rows.length - 1)) * w}
              y2={h}
              stroke="currentColor"
              strokeDasharray="7 5"
            />
            <text
              x={
                (rows.indexOf(depletion) / Math.max(1, rows.length - 1)) * w + 5
              }
              y="18"
            >
              Depleted {depletion.year}
            </text>
          </>
        )}
      </svg>
      {rows[active] && <output className="chart-tooltip retirement-chart-tooltip">{rows[active].year}<strong>{money(rows[active].endingBalanceCents)}</strong></output>}
      </div>
      <p>
        {rows[0]?.year}–{rows.at(-1)?.year}:{" "}
        {money(rows.at(-1)?.endingBalanceCents ?? 0)}
      </p>
    </section>
  );
};
const YearTable = ({
  rows,
}: {
  rows: ReturnType<typeof calculateRetirementOutlook>["years"];
}) => (
  <section className="card table-scroll">
    <table>
      <thead>
        <tr>
          <th>Year</th>
          <th>Income</th>
          <th>Withdrawals</th>
          <th>Tax and penalties</th>
          <th>Spending</th>
          <th>Excess / shortfall</th>
          <th>Ending spendable balance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.year}>
            <th><details><summary>{r.year} {r.taxStatement&&<span className="badge">Estimate</span>}</summary>{r.taxStatement&&<div className="tax-year-detail"><p><strong>{r.taxStatement.projectedFrozen?`Projected from ${r.taxStatement.rulePackYear} rule pack`:`Official ${r.taxStatement.rulePackYear} rule pack`}</strong></p><dl><div><dt>Federal / California / NIIT / penalties</dt><dd>{money(r.taxStatement.federalIncomeTaxCents)} / {money(r.taxStatement.californiaIncomeTaxCents)} / {money(r.taxStatement.niitCents)} / {money(r.taxStatement.penaltiesCents)}</dd></div><div><dt>Effective rate</dt><dd>{(r.taxStatement.effectiveRateBps/100).toFixed(2)}%</dd></div><div><dt>Federal AGI → deduction → taxable</dt><dd>{money(r.taxStatement.federalAgiCents)} → {money(r.taxStatement.federalDeductionCents)} → {money(r.taxStatement.federalTaxableIncomeCents)}</dd></div><div><dt>Taxable Social Security</dt><dd>{money(r.taxStatement.taxableSocialSecurityCents)}</dd></div><div><dt>Capital gains (short / long / California)</dt><dd>{money(r.taxStatement.federalShortGainCents)} / {money(r.taxStatement.federalLongGainCents)} / {money(r.taxStatement.californiaNetGainCents)}</dd></div></dl><p>Limitations: {r.taxStatement.limitations.join('; ')}.</p><ul>{r.taxStatement.sources.map((source,i)=><li key={`${source.url}-${i}`}><a href={source.url} target="_blank" rel="noreferrer">{source.jurisdiction} {source.sourceYear}</a> · {source.status}</li>)}</ul></div>}</details></th>
            <td>{money(r.grossIncomeCents)}</td>
            <td>{money(r.withdrawalsCents)}</td>
            <td>{money(r.taxAndPenaltyCents)}</td>
            <td>{money(r.spendingCents)}</td>
            <td>{money(r.excessCents)}</td>
            <td>{money(r.endingSpendableCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);
