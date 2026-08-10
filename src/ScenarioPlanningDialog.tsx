import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { GoalType, ScenarioEvent, ScenarioGoal, WithdrawalRule } from "./domain/types";
import type {
  Bootstrap,
  Repository,
  ScenarioAllocation,
  ScenarioRecord,
} from "./repository";

type Kind = ScenarioEvent["type"];
const labels: Record<Kind, string> = {
  "recurring-change": "Recurring amount change",
  "income-change": "Income amount change",
  "one-time-income": "One-time income",
  "one-time-expense": "One-time expense",
  "account-transfer": "Account transfer",
  "account-contribution": "Account contribution",
  "asset-purchase": "Asset purchase",
  "asset-sale": "Asset sale",
  "debt-origination": "Debt origination",
  "debt-payoff": "Debt payoff",
};
const cents = (value: string) =>
  (()=>{const match=/^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(value.trim());if(!match)return null;const exact=BigInt(match[1])*100n+BigInt((match[2]??"").padEnd(2,"0"));return exact<=99_999_999_999_999n?Number(exact):null})();
const bps = (value: string) =>
  /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())
    ? Math.round(Number(value) * 100)
    : null;
const dollars = (value: number | undefined) =>
  value === undefined ? "" : (value / 100).toFixed(2);
const rate = (value: number | undefined) =>
  value === undefined ? "" : (value / 100).toFixed(2);
const endDate = (months: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};
const sorted = (events: ScenarioEvent[]) =>
  [...events].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
function eventFields(value: ScenarioEvent | null) {
  if (!value) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value))
    if (typeof item !== "object")
      result[key] =
        typeof item === "number"
          ? key.endsWith("Bps")
            ? rate(item)
            : dollars(item)
          : String(item);
  if (value.type === "asset-purchase" && value.financing)
    for (const [key, item] of Object.entries(value.financing))
      result[`financing.${key}`] =
        typeof item === "number"
          ? key.endsWith("Bps")
            ? rate(item)
            : dollars(item)
          : String(item);
  if (value.type === "asset-sale" && value.payoff)
    for (const [key, item] of Object.entries(value.payoff))
      result[`payoff.${key}`] =
        typeof item === "number" ? dollars(item) : String(item);
  return result;
}

export function ScenarioPlanningDialog({
  record,
  bootstrap,
  repository,
  close,
  refresh,
}: {
  record: ScenarioRecord;
  bootstrap: Bootstrap;
  repository: Repository;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [events, setEvents] = useState(() => sorted(record.events)),
    [allocations, setAllocations] = useState<ScenarioAllocation[]>(() =>
      record.allocations.map((x, i) => ({ ...x, priority: i + 1 })),
    ),
    [withdrawals, setWithdrawals] = useState<WithdrawalRule[]>(() =>
      [...(record.withdrawals ?? [])]
        .sort((a, b) => a.priority - b.priority)
        .map((x, i) => ({ ...x, priority: i + 1 })),
    ),
    [goals,setGoals]=useState<ScenarioGoal[]>(()=>[...record.goals].sort((a,b)=>a.priority-b.priority)),
    [goalEditing,setGoalEditing]=useState<ScenarioGoal|null|undefined>(undefined),
    [editing, setEditing] = useState<ScenarioEvent | null | undefined>(
      undefined,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function save() {
    setError("");
    if (allocations.length && allocations.at(-1)!.percentBps !== 10000)
      return setError("The final allocation must be a 100% catch-all.");
    if (
      new Set(allocations.map((x) => x.accountId)).size !== allocations.length
    )
      return setError("Each allocation account can appear only once.");
    if (
      withdrawals.some((x) => !x.accountId) ||
      new Set(withdrawals.map((x) => x.accountId)).size !== withdrawals.length
    )
      return setError("Each deficit withdrawal account can appear only once.");
    setBusy(true);
    try {
      await repository.updateScenario?.({
        id: record.id,
        name: record.name,
        assumptions: record.assumptions,
        horizonMonths: record.horizonMonths,
        events: sorted(events),
        allocations: allocations.map((x, i) => ({ ...x, priority: i + 1 })),
        withdrawals: withdrawals.map((x, i) => ({ ...x, priority: i + 1 })),
        goals: goals.map((goal,index)=>({...goal,priority:index+1})),
        expectedRevision: record.revision,
      });
      await refresh();
      close();
    } catch (x) {
      setError(
        typeof x === "string"
          ? x
          : x &&
              typeof x === "object" &&
              typeof (x as { message?: unknown }).message === "string"
            ? (x as { message: string }).message
            : "Could not save scenario planning.",
      );
    } finally {
      setBusy(false);
    }
  }
  const move = (index: number, delta: number) =>
    setAllocations((xs) => {
      const next = [...xs],
        other = index + delta;
      if (other < 0 || other >= next.length) return xs;
      [next[index], next[other]] = [next[other], next[index]];
      return next.map((x, i) => ({ ...x, priority: i + 1 }));
    });
  return (
    <div className="modal-backdrop">
      <section
        className="card modal entry-modal scenario-planning-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="planning-title"
      >
        <h2 id="planning-title">Plan goals, events, allocations, and withdrawals</h2>
        {error && (
          <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        {editing !== undefined ? (
          <EventEditor
            value={editing}
            events={events}
            bootstrap={bootstrap}
            horizonMonths={record.horizonMonths}
            cancel={() => setEditing(undefined)}
            commit={(event) => {
              setEvents((xs) =>
                sorted([...xs.filter((x) => x.id !== event.id), event]),
              );
              setEditing(undefined);
            }}
          />
        ) : goalEditing !== undefined ? <GoalEditor value={goalEditing} goals={goals} bootstrap={bootstrap} scenarioId={record.id} cancel={()=>setGoalEditing(undefined)} commit={(goal)=>{setGoals(items=>[...items.filter(item=>item.id!==goal.id),goal].sort((a,b)=>a.priority-b.priority).map((item,index)=>({...item,priority:index+1})));setGoalEditing(undefined)}}/> : (
          <>
            <section aria-labelledby="goals-title">
              <div className="card-title"><h3 id="goals-title">Funding goals</h3><button onClick={()=>setGoalEditing(null)}>Add goal</button></div>
              <p className="muted">Goals reserve money for a target. Purchases, debt payments, and retirement changes happen only through separate dated events.</p>
              {goals.map((goal,index)=><div className="transaction" key={goal.id}><div><strong>{goal.name}</strong><small>{goal.type.replaceAll("-"," ")} · due {goal.targetDate} · {goal.enabled?"Enabled":"Disabled"}</small></div><div className="inline-actions"><button aria-label={`${goal.enabled?"Disable":"Enable"} ${goal.name}`} onClick={()=>setGoals(items=>items.map(item=>item.id===goal.id?{...item,enabled:!item.enabled}:item))}>{goal.enabled?"Disable":"Enable"}</button><button disabled={index===0} onClick={()=>setGoals(items=>moveRule(items,index,-1))}>Move up</button><button disabled={index===goals.length-1} onClick={()=>setGoals(items=>moveRule(items,index,1))}>Move down</button><button onClick={()=>setGoalEditing(goal)}>Edit</button><button className="danger-link" onClick={()=>setGoals(items=>items.filter(item=>item.id!==goal.id).map((item,i)=>({...item,priority:i+1})))}>Delete</button></div></div>)}
              {!goals.length&&<p className="empty">No funding goals yet.</p>}
            </section>
            <section aria-labelledby="events-title">
              <div className="card-title">
                <h3 id="events-title">Dated events</h3>
                <button onClick={() => setEditing(null)}>Add event</button>
              </div>
              {events.map((e) => (
                <div className="transaction" key={e.id}>
                  <div>
                    <strong>{labels[e.type]}</strong>
                    <small>{e.date}</small>
                  </div>
                  <div className="inline-actions">
                    <button
                      aria-label={`Edit ${labels[e.type]} on ${e.date}`}
                      onClick={() => setEditing(e)}
                    >
                      Edit
                    </button>
                    <button
                      className="danger-link"
                      aria-label={`Delete ${labels[e.type]} on ${e.date}`}
                      onClick={() =>
                        setEvents((xs) => xs.filter((x) => x.id !== e.id))
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {!events.length && <p className="empty">No dated events yet.</p>}
            </section>
            <section aria-labelledby="allocation-title">
              <div className="card-title">
                <h3 id="allocation-title">Surplus allocations</h3>
                <button
                  onClick={() =>
                    setAllocations((xs) => [
                      ...xs,
                      {
                        id: crypto.randomUUID(),
                        accountId:
                          bootstrap.accounts.find(
                            (a) => !xs.some((x) => x.accountId === a.id),
                          )?.id ?? "",
                        percentBps: xs.length ? 10000 : 10000,
                        priority: xs.length + 1,
                      },
                    ])
                  }
                >
                  Add rule
                </button>
              </div>
              {allocations.map((rule, i) => (
                <fieldset key={rule.id ?? i}>
                  <legend>
                    Allocation {i + 1}
                    {i === allocations.length - 1 ? " (final catch-all)" : ""}
                  </legend>
                  <label>
                    Account
                    <select
                      value={rule.accountId}
                      onChange={(e) =>
                        setAllocations((xs) =>
                          xs.map((x, j) =>
                            j === i ? { ...x, accountId: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      {bootstrap.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Percent of remaining surplus
                    <input
                      aria-label={`Allocation ${i + 1} percent`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      disabled={i === allocations.length - 1}
                      value={(rule.percentBps / 100).toString()}
                      onChange={(e) =>
                        setAllocations((xs) =>
                          xs.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  percentBps: Math.round(
                                    Number(e.target.value) * 100,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Target balance (optional)
                    <input
                      inputMode="decimal"
                      value={dollars(rule.targetBalanceCents ?? undefined)}
                      onChange={(e) => {
                        const v =
                          e.target.value === ""
                            ? undefined
                            : cents(e.target.value);
                        if (v !== null)
                          setAllocations((xs) =>
                            xs.map((x, j) =>
                              j === i ? { ...x, targetBalanceCents: v } : x,
                            ),
                          );
                      }}
                    />
                  </label>
                  <div className="inline-actions">
                    <button disabled={i === 0} onClick={() => move(i, -1)}>
                      Move up
                    </button>
                    <button
                      disabled={i === allocations.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      Move down
                    </button>
                    <button
                      className="danger-link"
                      onClick={() =>
                        setAllocations((xs) =>
                          xs
                            .filter((_, j) => j !== i)
                            .map((x, j, n) => ({
                              ...x,
                              priority: j + 1,
                              percentBps:
                                j === n.length - 1 ? 10000 : x.percentBps,
                            })),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </fieldset>
              ))}
            </section>
            <section aria-labelledby="withdrawal-title">
              <div className="card-title">
                <h3 id="withdrawal-title">Deficit withdrawals</h3>
                <button onClick={() => {
                  const account = bootstrap.accounts.find((candidate) => candidate.liquid && !withdrawals.some((rule) => rule.accountId === candidate.id));
                  if (account) setWithdrawals((rules) => [...rules, {id: crypto.randomUUID(), accountId: account.id, priority: rules.length + 1}]);
                }}>Add rule</button>
              </div>
              {withdrawals.map((rule, i) => <fieldset key={rule.id ?? i}>
                <legend>Withdrawal {i + 1}</legend>
                <label>Liquid account<select value={rule.accountId} onChange={(event) => setWithdrawals((rules) => rules.map((item, index) => index === i ? {...item, accountId:event.target.value} : item))}>{bootstrap.accounts.filter((account) => account.liquid).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                <div className="inline-actions">
                  <button disabled={i === 0} onClick={() => setWithdrawals((rules) => moveRule(rules, i, -1))}>Move up</button>
                  <button disabled={i === withdrawals.length - 1} onClick={() => setWithdrawals((rules) => moveRule(rules, i, 1))}>Move down</button>
                  <button className="danger-link" onClick={() => setWithdrawals((rules) => rules.filter((_, index) => index !== i).map((item, index) => ({...item,priority:index+1})))}>Remove</button>
                </div>
              </fieldset>)}
              {!withdrawals.length && <p className="empty">Deficits remain unfunded until a liquid account is added.</p>}
            </section>
            <div className="actions">
              <button disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save plan"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function moveRule<T extends {priority:number}>(rules:T[],index:number,delta:number){const target=index+delta;if(target<0||target>=rules.length)return rules;const next=[...rules];[next[index],next[target]]=[next[target],next[index]];return next.map((rule,priority)=>({...rule,priority:priority+1}));}

const goalLabels:Record<GoalType,string>={"emergency-fund":"Emergency fund","debt-payoff":"Debt payoff",education:"Education","major-purchase":"Major purchase",retirement:"Retirement"};
function GoalEditor({value,goals,bootstrap,scenarioId,cancel,commit}:{value:ScenarioGoal|null;goals:ScenarioGoal[];bootstrap:Bootstrap;scenarioId:string;cancel:()=>void;commit:(goal:ScenarioGoal)=>void}){
  const [kind,setKind]=useState<GoalType>(value?.type??"emergency-fund");
  const [name,setName]=useState(value?.name??"");
  const [targetDate,setTargetDate]=useState(value?.targetDate??endDate(12));
  const [destination,setDestination]=useState("destinationAccountId" in (value??{})?(value as {destinationAccountId:string}).destinationAccountId:(bootstrap.accounts[0]?.id??""));
  const [earmark,setEarmark]=useState(dollars(value?.startingEarmarkedCents));
  const [today,setToday]=useState(value?.todayDollarBasis??true),[shortfall,setShortfall]=useState(value?.allowCashShortfall??false);
  const [expenseIds,setExpenseIds]=useState<string[]>(value?.type==="emergency-fund"?[...value.expenseEntryIds]:[]),[coverage,setCoverage]=useState(value?.type==="emergency-fund"?String(value.coverageMonths):"3"),[minimum,setMinimum]=useState(value?.type==="emergency-fund"?dollars(value.minimumTargetCents):"");
  const [liability,setLiability]=useState(value?.type==="debt-payoff"?value.liabilityId:(bootstrap.liabilities[0]?.id??""));
  const [beneficiary,setBeneficiary]=useState(value?.type==="education"?value.beneficiary:""),[attendanceStart,setAttendanceStart]=useState(value?.type==="education"?value.attendanceStartDate:targetDate),[attendanceEnd,setAttendanceEnd]=useState(value?.type==="education"?value.attendanceEndDate:targetDate),[annualCost,setAnnualCost]=useState(value?.type==="education"?dollars(value.annualCostCents):""),[educationRate,setEducationRate]=useState(value?.type==="education"?rate(value.educationInflationBps):"3.00");
  const [cost,setCost]=useState(value?.type==="major-purchase"?dollars(value.costCents):"");
  const [participants,setParticipants]=useState<string[]>(value?.type==="retirement"?[...value.participantIds]:[]),[retirementDates,setRetirementDates]=useState<Record<string,string>>(value?.type==="retirement"?{...value.retirementDates}:{}),[ages,setAges]=useState<Record<string,number>>(value?.type==="retirement"?{...value.planningThroughAges}:{}),[spending,setSpending]=useState(value?.type==="retirement"?dollars(value.desiredSpendingCents):""),[healthcare,setHealthcare]=useState(value?.type==="retirement"?dollars(value.healthcareCents):""),[healthRate,setHealthRate]=useState(value?.type==="retirement"?rate(value.healthcareGrowthBps):"5.00"),[pensions,setPensions]=useState(value?.type==="retirement"?[...value.pensions]:[]);
  const [error,setError]=useState("");
  const money=(text:string,optional=false)=>{if(optional&&text==="")return undefined;const result=cents(text);if(result===null||result<0||result>99_999_999_999_999)throw new Error("Enter money amounts with at most two decimal places.");return result};
  function submit(event:FormEvent){event.preventDefault();try{
    if(!name.trim())throw new Error("Goal name is required.");if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))throw new Error("A valid target date is required.");if(!destination)throw new Error("A destination account is required.");
    const common={id:value?.id??crypto.randomUUID(),scenarioId,type:kind,name:name.trim(),priority:value?.priority??goals.length+1,enabled:value?.enabled??true,targetDate,todayDollarBasis:today,startingEarmarkedCents:money(earmark||"0")!,allowCashShortfall:shortfall,revision:value?.revision??1};let goal:ScenarioGoal;
    if(kind==="emergency-fund"){const months=Number(coverage);if(!expenseIds.length||!Number.isInteger(months)||months<1||months>120)throw new Error("Select expenses and enter 1–120 coverage months.");goal={...common,type:kind,destinationAccountId:destination,expenseEntryIds:expenseIds,coverageMonths:months,minimumTargetCents:money(minimum,true)}}
    else if(kind==="debt-payoff"){if(!liability)throw new Error("Choose a liability.");goal={...common,type:kind,destinationAccountId:destination,liabilityId:liability}}
    else if(kind==="education"){const inflation=bps(educationRate),annual=money(annualCost)!;if(!beneficiary.trim()||attendanceEnd<attendanceStart||annual<=0||inflation===null||inflation<0||inflation>100000)throw new Error("Enter a beneficiary, valid attendance dates, positive annual cost, and education inflation.");goal={...common,type:kind,destinationAccountId:destination,beneficiary:beneficiary.trim(),attendanceStartDate:attendanceStart,attendanceEndDate:attendanceEnd,annualCostCents:annual,educationInflationBps:inflation}}
    else if(kind==="major-purchase"){const purchaseCost=money(cost)!;if(purchaseCost<=0)throw new Error("Purchase cost must be positive.");goal={...common,type:kind,targetDate,purchaseDate:targetDate,costCents:purchaseCost,destinationAccountId:destination};}
    else {const growth=bps(healthRate),monthlySpending=money(spending)!,monthlyHealthcare=money(healthcare)!;if(!participants.length||monthlySpending+monthlyHealthcare<=0||growth===null||growth<0||growth>100000)throw new Error("Select participants and enter valid retirement costs.");for(const id of participants){if(!bootstrap.people.find(person=>person.id===id)?.birthDate)throw new Error("Each retirement participant needs a birth date.");if(!retirementDates[id]||!Number.isInteger(ages[id])||ages[id]<1||ages[id]>120)throw new Error("Each participant needs a retirement date and planning-through age.");}if(pensions.some(pension=>!pension.name.trim()||pension.monthlyCents<=0||!/^\d{4}-\d{2}-\d{2}$/.test(pension.startDate)))throw new Error("Each pension needs a name, positive amount, and valid start date.");const first=[...participants.map(id=>retirementDates[id])].sort()[0];goal={...common,type:kind,targetDate:first,destinationAccountId:destination,participantIds:participants,retirementDates,planningThroughAges:ages,desiredSpendingCents:monthlySpending,healthcareCents:monthlyHealthcare,healthcareGrowthBps:growth,pensions}}
    const total=goals.filter(item=>item.id!==goal.id&&item.destinationAccountId===destination).reduce((sum,item)=>sum+item.startingEarmarkedCents,0)+goal.startingEarmarkedCents;const balance=bootstrap.accounts.find(account=>account.id===destination)?.balanceCents??0;if(total>balance)throw new Error("Combined starting earmarks cannot exceed the destination account balance.");commit(goal);
  }catch(reason){setError(reason instanceof Error?reason.message:"Could not save goal.")}}
  const checkbox=(id:string,label:string,selected:string[],setSelected:(v:string[])=>void)=><label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={event=>setSelected(event.target.checked?[...selected,id]:selected.filter(item=>item!==id))}/>{label}</label>;
  return <form onSubmit={submit}><h3>{value?"Edit":"Add"} funding goal</h3>{error&&<p className="form-error" role="alert">{error}</p>}<label>Goal type<select value={kind} disabled={!!value} onChange={event=>setKind(event.target.value as GoalType)}>{Object.entries(goalLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Name<input autoFocus required value={name} onChange={event=>setName(event.target.value)}/></label>{kind!=="retirement"&&<label>Target date<input type="date" required value={targetDate} onChange={event=>setTargetDate(event.target.value)}/></label>}<label>Destination account<select required value={destination} onChange={event=>setDestination(event.target.value)}>{bootstrap.accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Starting earmarked balance<input inputMode="decimal" value={earmark} onChange={event=>setEarmark(event.target.value)}/></label><label><input type="checkbox" checked={today} onChange={event=>setToday(event.target.checked)}/>Amount is in today’s dollars</label><label><input type="checkbox" checked={shortfall} onChange={event=>setShortfall(event.target.checked)}/>Allow ordered account withdrawals when surplus is short</label>
  {kind==="emergency-fund"&&<fieldset><legend>Emergency coverage</legend>{bootstrap.recurring.filter(item=>bootstrap.categories.find(category=>category.id===item.categoryId)?.kind==="expense").map(item=>checkbox(item.id,item.name,expenseIds,setExpenseIds))}<label>Coverage months<input type="number" min="1" max="120" value={coverage} onChange={event=>setCoverage(event.target.value)}/></label><label>Minimum target (optional)<input inputMode="decimal" value={minimum} onChange={event=>setMinimum(event.target.value)}/></label></fieldset>}
  {kind==="debt-payoff"&&<label>Liability<select value={liability} onChange={event=>setLiability(event.target.value)}><option value="">Choose liability</option>{bootstrap.liabilities.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
  {kind==="education"&&<fieldset><legend>Education costs</legend><label>Beneficiary<input value={beneficiary} onChange={event=>setBeneficiary(event.target.value)}/></label><label>Attendance starts<input type="date" value={attendanceStart} onChange={event=>setAttendanceStart(event.target.value)}/></label><label>Attendance ends<input type="date" value={attendanceEnd} onChange={event=>setAttendanceEnd(event.target.value)}/></label><label>Annual cost<input inputMode="decimal" value={annualCost} onChange={event=>setAnnualCost(event.target.value)}/></label><label>Education inflation (%)<input inputMode="decimal" value={educationRate} onChange={event=>setEducationRate(event.target.value)}/></label></fieldset>}
  {kind==="major-purchase"&&<label>Purchase cost<input inputMode="decimal" value={cost} onChange={event=>setCost(event.target.value)}/></label>}
  {kind==="retirement"&&<fieldset><legend>Retirement plan</legend>{bootstrap.people.map(person=><div key={person.id}>{checkbox(person.id,person.name,participants,setParticipants)}{participants.includes(person.id)&&<><label>Retirement date for {person.name}<input type="date" value={retirementDates[person.id]??""} onChange={event=>setRetirementDates(current=>({...current,[person.id]:event.target.value}))}/></label><label>Plan through age for {person.name}<input type="number" min="1" max="120" value={ages[person.id]??""} onChange={event=>setAges(current=>({...current,[person.id]:Number(event.target.value)}))}/></label></>}</div>)}<label>Desired monthly spending<input inputMode="decimal" value={spending} onChange={event=>setSpending(event.target.value)}/></label><label>Monthly healthcare cost<input inputMode="decimal" value={healthcare} onChange={event=>setHealthcare(event.target.value)}/></label><label>Healthcare annual growth (%)<input inputMode="decimal" value={healthRate} onChange={event=>setHealthRate(event.target.value)}/></label><div className="card-title"><strong>Pensions</strong><button type="button" onClick={()=>setPensions(items=>[...items,{id:crypto.randomUUID(),name:"",monthlyCents:0,startDate:targetDate}])}>Add pension</button></div>{pensions.map((pension,index)=><fieldset key={pension.id}><label>Name<input value={pension.name} onChange={event=>setPensions(items=>items.map((item,i)=>i===index?{...item,name:event.target.value}:item))}/></label><label>Monthly amount<input inputMode="decimal" value={dollars(pension.monthlyCents)} onChange={event=>{const amount=cents(event.target.value);if(amount!==null)setPensions(items=>items.map((item,i)=>i===index?{...item,monthlyCents:amount}:item))}}/></label><label>Start date<input type="date" value={pension.startDate} onChange={event=>setPensions(items=>items.map((item,i)=>i===index?{...item,startDate:event.target.value}:item))}/></label><button type="button" className="danger-link" onClick={()=>setPensions(items=>items.filter((_,i)=>i!==index))}>Remove pension</button></fieldset>)}</fieldset>}
  <div className="actions"><button type="button" onClick={cancel}>Cancel</button><button className="primary" type="submit">Save goal</button></div></form>
}

function EventEditor({
  value,
  events,
  bootstrap,
  horizonMonths,
  cancel,
  commit,
}: {
  value: ScenarioEvent | null;
  events: ScenarioEvent[];
  bootstrap: Bootstrap;
  horizonMonths: number;
  cancel: () => void;
  commit: (event: ScenarioEvent) => void;
}) {
  const [kind, setKind] = useState<Kind>(value?.type ?? "one-time-income"),
    [date, setDate] = useState(
      value?.date ?? new Date().toISOString().slice(0, 10),
    ),
    [fields, setFields] = useState<Record<string, string>>(() =>
      eventFields(value),
    ),
    [error, setError] = useState("");
  const prior = useMemo(
    () => events.filter((e) => e.id !== value?.id && e.date < date),
    [events, date, value],
  );
  const assets = [
    ...bootstrap.assets.map((x) => ({ id: x.id, name: x.name })),
    ...prior
      .filter(
        (x): x is Extract<ScenarioEvent, { type: "asset-purchase" }> =>
          x.type === "asset-purchase",
      )
      .map((x) => ({ id: x.assetId, name: x.name })),
  ];
  const debts = [
    ...bootstrap.liabilities.map((x) => ({ id: x.id, name: x.name })),
    ...prior.flatMap((x) =>
      x.type === "debt-origination"
        ? [{ id: x.liabilityId, name: x.name }]
        : x.type === "asset-purchase" && x.financing
          ? [{ id: x.financing.liabilityId, name: x.financing.name }]
          : [],
    ),
  ];
  const f = (name: string) => fields[name] ?? "",
    set = (name: string, v: string) => setFields((x) => ({ ...x, [name]: v }));
  const account = (name: string, label: string) => (
    <label>
      {label}
      <select
        required
        value={f(name)}
        onChange={(e) => set(name, e.target.value)}
      >
        <option value="">Choose account</option>
        {bootstrap.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
  const money = (name: string, label: string, optional = false) => (
    <label>
      {label}
      <input
        required={!optional}
        inputMode="decimal"
        value={f(name)}
        onChange={(e) => set(name, e.target.value)}
      />
    </label>
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const m = (k: string, opt = false) => {
      if (opt && f(k) === "") return undefined;
      const n = cents(f(k));
      if (n === null || n <= 0)
        throw new Error(
          `${k} must be a positive amount with at most two decimals.`,
        );
      return n;
    };
    const r = (k: string) => {
      const n = bps(f(k));
      if (n === null || n < -10000 || n > 100000)
        throw new Error(`${k} is invalid.`);
      return n;
    };
    try {
      let event: ScenarioEvent;
      const base = { id: value?.id ?? crypto.randomUUID(), date };
      if (kind === "one-time-income" || kind === "one-time-expense")
        event = { ...base, type: kind, amountCents: m("amountCents")! };
      else if (kind === "recurring-change" || kind === "income-change")
        event = {
          ...base,
          type: kind,
          entryId: f("entryId"),
          amountCents: m("amountCents")!,
        };
      else if (kind === "account-contribution")
        event = {
          ...base,
          type: kind,
          accountId: f("accountId"),
          amountCents: m("amountCents")!,
        };
      else if (kind === "account-transfer") {
        if (f("fromAccountId") === f("toAccountId"))
          throw new Error("Transfer accounts must be different.");
        event = {
          ...base,
          type: kind,
          fromAccountId: f("fromAccountId"),
          toAccountId: f("toAccountId"),
          amountCents: m("amountCents")!,
        };
      } else if (kind === "debt-origination")
        event = {
          ...base,
          type: kind,
          liabilityId: f("liabilityId") || crypto.randomUUID(),
          name: f("name").trim(),
          principalCents: m("principalCents")!,
          annualRateBps: r("annualRateBps"),
          minimumPaymentCents: m("minimumPaymentCents")!,
          accountId: f("accountId"),
        };
      else if (kind === "debt-payoff")
        event = {
          ...base,
          type: kind,
          liabilityId: f("liabilityId"),
          accountId: f("accountId"),
          amountCents: m("amountCents", true),
        };
      else if (kind === "asset-purchase")
        event = {
          ...base,
          type: kind,
          assetId: f("assetId") || crypto.randomUUID(),
          name: f("name").trim(),
          valueCents: m("valueCents")!,
          annualGrowthBps: r("annualGrowthBps"),
          fundingAccountId: f("fundingAccountId"),
          downPaymentCents: m("downPaymentCents")!,
          costsCents: m("costsCents")!,
          financing:
            f("financing.enabled") || f("financing.liabilityId")
              ? {
                  liabilityId:
                    f("financing.liabilityId") || crypto.randomUUID(),
                  name: f("financing.name").trim(),
                  principalCents: m("financing.principalCents")!,
                  annualRateBps: r("financing.annualRateBps"),
                  minimumPaymentCents: m("financing.minimumPaymentCents")!,
                }
              : undefined,
        };
      else
        event = {
          ...base,
          type: "asset-sale",
          assetId: f("assetId"),
          proceedsCents: m("proceedsCents")!,
          costsCents: m("costsCents")!,
          destinationAccountId: f("destinationAccountId"),
          payoff:
            f("payoff.mode") && f("payoff.mode") !== "none"
              ? {
                  liabilityId: f("payoff.liabilityId"),
                  mode: f("payoff.mode") as "partial" | "full",
                  amountCents:
                    f("payoff.mode") === "partial"
                      ? m("payoff.amountCents")!
                      : undefined,
                }
              : undefined,
        };
      commit(event);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Invalid event.");
    }
  }
  return (
    <form onSubmit={submit}>
      <h3>{value ? "Edit dated event" : "Add dated event"}</h3>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <label>
        Event type
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as Kind);
            setFields({});
          }}
        >
          {Object.entries(labels).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Event date
        <input
          type="date"
          required
          min={new Date().toISOString().slice(0, 8) + "01"}
          max={endDate(horizonMonths)}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      {(kind === "one-time-income" || kind === "one-time-expense") &&
        money("amountCents", "Amount (USD)")}
      {(kind === "recurring-change" || kind === "income-change") && (
        <>
          <label>
            Recurring entry
            <select
              required
              value={f("entryId")}
              onChange={(e) => set("entryId", e.target.value)}
            >
              <option value="">Choose entry</option>
              {bootstrap.recurring.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {money("amountCents", "New amount (USD)")}
        </>
      )}
      {kind === "account-contribution" && (
        <>
          {account("accountId", "Account")}
          {money("amountCents", "Amount (USD)")}
        </>
      )}
      {kind === "account-transfer" && (
        <>
          {account("fromAccountId", "From account")}
          {account("toAccountId", "To account")}
          {money("amountCents", "Amount (USD)")}
        </>
      )}
      {kind === "debt-origination" && (
        <>
          <label>
            Name
            <input
              required
              value={f("name")}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          {money("principalCents", "Principal (USD)")}
          <label>
            Annual rate (%)
            <input
              required
              inputMode="decimal"
              value={f("annualRateBps")}
              onChange={(e) => set("annualRateBps", e.target.value)}
            />
          </label>
          {money("minimumPaymentCents", "Minimum payment (USD)")}
          {account("accountId", "Deposit account")}
        </>
      )}
      {kind === "debt-payoff" && (
        <>
          <label>
            Liability
            <select
              required
              value={f("liabilityId")}
              onChange={(e) => set("liabilityId", e.target.value)}
            >
              <option value="">Choose liability</option>
              {debts.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {account("accountId", "Payment account")}
          {money("amountCents", "Amount (optional; blank pays in full)", true)}
        </>
      )}
      {kind === "asset-purchase" && (
        <>
          <label>
            Name
            <input
              required
              value={f("name")}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          {money("valueCents", "Value (USD)")}
          <label>
            Annual growth (%)
            <input
              required
              inputMode="decimal"
              value={f("annualGrowthBps")}
              onChange={(e) => set("annualGrowthBps", e.target.value)}
            />
          </label>
          {account("fundingAccountId", "Funding account")}
          {money("downPaymentCents", "Down payment (USD)")}
          {money("costsCents", "Purchase costs (USD)")}
        </>
      )}
      {kind === "asset-sale" && (
        <>
          <label>
            Asset
            <select
              required
              value={f("assetId")}
              onChange={(e) => set("assetId", e.target.value)}
            >
              <option value="">Choose asset</option>
              {assets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {money("proceedsCents", "Proceeds (USD)")}
          {money("costsCents", "Sale costs (USD)")}
          {account("destinationAccountId", "Destination account")}
        </>
      )}
      {kind === "asset-purchase" && (
        <fieldset>
          <legend>Financing (optional)</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(
                f("financing.enabled") || f("financing.liabilityId"),
              )}
              onChange={(e) =>
                set("financing.enabled", e.target.checked ? "yes" : "")
              }
            />{" "}
            Finance this purchase
          </label>
          {(f("financing.enabled") || f("financing.liabilityId")) && (
            <>
              <label>
                Debt name
                <input
                  required
                  value={f("financing.name")}
                  onChange={(e) => set("financing.name", e.target.value)}
                />
              </label>
              {money("financing.principalCents", "Principal (USD)")}
              <label>
                Annual rate (%)
                <input
                  required
                  inputMode="decimal"
                  value={f("financing.annualRateBps")}
                  onChange={(e) =>
                    set("financing.annualRateBps", e.target.value)
                  }
                />
              </label>
              {money("financing.minimumPaymentCents", "Minimum payment (USD)")}
            </>
          )}
        </fieldset>
      )}
      {kind === "asset-sale" && (
        <fieldset>
          <legend>Debt payoff (optional)</legend>
          <label>
            Payoff mode
            <select
              value={f("payoff.mode") || "none"}
              onChange={(e) => set("payoff.mode", e.target.value)}
            >
              <option value="none">No payoff</option>
              <option value="partial">Partial payoff</option>
              <option value="full">Full payoff</option>
            </select>
          </label>
          {f("payoff.mode") && f("payoff.mode") !== "none" && (
            <label>
              Liability
              <select
                required
                value={f("payoff.liabilityId")}
                onChange={(e) => set("payoff.liabilityId", e.target.value)}
              >
                <option value="">Choose liability</option>
                {debts.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {f("payoff.mode") === "partial" &&
            money("payoff.amountCents", "Payoff amount (USD)")}
        </fieldset>
      )}
      <div className="actions">
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        <button className="primary">Save event</button>
      </div>
    </form>
  );
}
