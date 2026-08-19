import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  ContributionRule,
  ScenarioEvent,
  WithdrawalRule,
} from "./domain/types";
import { effectiveContributionBps } from "./domain/projection";
import type { Bootstrap, Repository, ScenarioRecord } from "./repository";
import { ActionButton, OverflowMenu } from "./ui";

type Kind = ScenarioEvent["type"];
const labels: Record<Kind, string> = {
  "recurring-change": "Recurring amount change",
  "income-change": "Income amount change",
  "one-time-income": "One-time income",
  "one-time-expense": "One-time expense",
  "account-transfer": "Account transfer",
  "account-contribution": "Account contribution",
  "asset-purchase": "Asset purchase",
  "adu-build": "ADU build",
  "asset-sale": "Asset sale",
  "debt-origination": "Debt origination",
  "debt-payoff": "Debt payoff",
};
const cents = (value: string) =>
  (() => {
    const match = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!match) return null;
    const exact =
      BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
    return exact <= 99_999_999_999_999n ? Number(exact) : null;
  })();
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
const investableAsset = (
  asset: Bootstrap["assets"][number],
  bootstrap: Bootstrap,
) =>
  !asset.privateStock &&
  !asset.purchasePriceCents &&
  !asset.purchaseDate &&
  !bootstrap.liabilities.some((item) => item.mortgage?.assetId === asset.id) &&
  !(
    asset.housingCosts &&
    (asset.housingCosts.propertyTaxRateBps ||
      asset.housingCosts.insuranceMonthlyCents ||
      asset.housingCosts.hoaMonthlyCents)
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
  projectedMonthlySurplusCents = 0,
  focusedEntry,
  close,
  refresh,
}: {
  record: ScenarioRecord;
  bootstrap: Bootstrap;
  repository: Repository;
  projectedMonthlySurplusCents?: number;
  focusedEntry?: "event" | "contribution";
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [events, setEvents] = useState(() => sorted(record.events)),
    [defaultAccountId, setDefaultAccountId] = useState(
      record.defaultContributionAccountId ?? "",
    ),
    [contributions, setContributions] = useState<ContributionRule[]>(() => [
      ...(record.contributions ?? []),
    ]),
    [amountDrafts, setAmountDrafts] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        (record.contributions ?? [])
          .filter((rule) => rule.monthlyAmountCents !== undefined)
          .map((rule) => [rule.id, dollars(rule.monthlyAmountCents)]),
      ),
    ),
    [withdrawals, setWithdrawals] = useState<WithdrawalRule[]>(() =>
      [...(record.withdrawals ?? [])]
        .sort((a, b) => a.priority - b.priority)
        .map((x, i) => ({ ...x, priority: i + 1 })),
    ),
    [editing, setEditing] = useState<ScenarioEvent | null | undefined>(
      focusedEntry === "event" ? null : undefined,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null),
    panelRef = useRef<HTMLElement>(null),
    invokerRef = useRef<HTMLElement | null>(
      document.activeElement as HTMLElement | null,
    );
  useEffect(() => {
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("input,select,button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab" && panel) {
        const nodes = [
          ...panel.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
          ),
        ];
        if (!nodes.length) return;
        const first = nodes[0],
          last = nodes.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      invokerRef.current?.focus();
    };
  }, [close]);
  useEffect(() => {
    if (focusedEntry !== "contribution" || contributions.length) return;
    const destination = bootstrap.accounts[0];
    if (destination)
      setContributions([
        {
          id: crypto.randomUUID(),
          destinationType: "account",
          destinationId: destination.id,
          percentBps: 1000,
          frequency: "monthly",
        },
      ]);
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const effectiveAssignedBps = effectiveContributionBps(
    contributions.map((rule) =>
      rule.monthlyAmountCents === undefined
        ? rule
        : {
            ...rule,
            monthlyAmountCents:
              cents(
                amountDrafts[rule.id] ?? dollars(rule.monthlyAmountCents),
              ) ?? 0,
          },
    ),
    projectedMonthlySurplusCents,
  );
  async function save() {
    setError("");
    if (!defaultAccountId)
      return setError("Select a default liquid cash account.");
    if (
      contributions.some(
        (rule) =>
          rule.monthlyAmountCents !== undefined &&
          !(
            cents(amountDrafts[rule.id] ?? dollars(rule.monthlyAmountCents)) ??
            0
          ),
      )
    )
      return setError(
        "Each fixed monthly contribution needs a positive amount.",
      );
    if (
      contributions.some(
        (rule) =>
          (rule.percentBps === undefined) ===
            (rule.monthlyAmountCents === undefined) ||
          (rule.percentBps !== undefined && rule.percentBps <= 0) ||
          (rule.monthlyAmountCents !== undefined &&
            rule.monthlyAmountCents <= 0),
      ) ||
      contributions.reduce((sum, rule) => sum + (rule.percentBps ?? 0), 0) >
        10000
    )
      return setError(
        "Each contribution needs one positive percentage or monthly amount, and percentages may total no more than 100%.",
      );
    if (
      new Set(
        contributions.map(
          (rule) => `${rule.destinationType}:${rule.destinationId}`,
        ),
      ).size !== contributions.length
    )
      return setError("Each contribution destination can appear only once.");
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
        defaultContributionAccountId: defaultAccountId,
        contributions,
        withdrawals: withdrawals.map((x, i) => ({ ...x, priority: i + 1 })),
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
  return (
    <div
      className="modal-backdrop sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={panelRef}
        className="card entry-modal scenario-planning-modal side-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="planning-title"
      >
        <h2 id="planning-title">Plan events and withdrawals</h2>
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
        ) : (
          <>
            <section aria-labelledby="events-title">
              <div className="card-title">
                <h3 id="events-title">Dated events</h3>
                <ActionButton tier="primary" onClick={() => setEditing(null)}>
                  Add event
                </ActionButton>
              </div>
              {events.map((e) => (
                <div className="transaction" key={e.id}>
                  <div>
                    <strong>{labels[e.type]}</strong>
                    <small>{e.date}</small>
                  </div>
                  <OverflowMenu
                    label={`More options for ${labels[e.type]} on ${e.date}`}
                    items={[
                      { label: "Edit", onSelect: () => setEditing(e) },
                      {
                        label: "Delete",
                        danger: true,
                        onSelect: () =>
                          setEvents((xs) => xs.filter((x) => x.id !== e.id)),
                      },
                    ]}
                  />
                </div>
              ))}
              {!events.length && <p className="empty">No dated events yet.</p>}
            </section>
            <section aria-labelledby="contribution-title">
              <div className="card-title">
                <h3 id="contribution-title">Contributions</h3>
                <ActionButton
                  onClick={() => {
                    const used = new Set(
                      contributions.map(
                        (rule) =>
                          `${rule.destinationType}:${rule.destinationId}`,
                      ),
                    );
                    const destination = bootstrap.accounts
                      .map((item) => ({
                        type: "account" as const,
                        id: item.id,
                      }))
                      .find((item) => !used.has(`${item.type}:${item.id}`));
                    if (destination)
                      setContributions((items) => [
                        ...items,
                        {
                          id: crypto.randomUUID(),
                          destinationType: destination.type,
                          destinationId: destination.id,
                          percentBps: 1000,
                          frequency: "monthly",
                        },
                      ]);
                  }}
                >
                  Add rule
                </ActionButton>
              </div>
              <p className="muted">
                Divide positive post-tax surplus among investments and extra
                mortgage principal. Unassigned or capped amounts stay in default
                cash.
              </p>
              <label>
                Default cash account
                <select
                  required
                  value={defaultAccountId}
                  onChange={(event) => setDefaultAccountId(event.target.value)}
                >
                  <option value="">Select an account</option>
                  {bootstrap.accounts
                    .filter(
                      (item) =>
                        item.liquid &&
                        (item.kind === "checking" || item.kind === "savings"),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                <strong>
                  {effectiveAssignedBps / 100}% of projected surplus assigned
                </strong>{" "}
                · {(10000 - effectiveAssignedBps) / 100}% remaining
              </p>
              {contributions.map((rule, index) => {
                const destinations = [
                  ...bootstrap.accounts.map((item) => ({
                    value: `account:${item.id}`,
                    label: item.name,
                  })),
                  ...bootstrap.assets
                    .filter((item) => investableAsset(item, bootstrap))
                    .map((item) => ({
                      value: `asset:${item.id}`,
                      label: item.name,
                    })),
                  ...bootstrap.liabilities
                    .filter((item) => item.mortgage?.assetId)
                    .map((item) => ({
                      value: `mortgage:${item.id}`,
                      label: `${item.name} — extra principal`,
                    })),
                ];
                const overflow = [
                  ...bootstrap.accounts
                    .filter(
                      (item) =>
                        item.kind === "investment" ||
                        item.kind === "retirement",
                    )
                    .map((item) => ({
                      value: `account:${item.id}`,
                      label: item.name,
                    })),
                  ...bootstrap.assets
                    .filter((item) => investableAsset(item, bootstrap))
                    .map((item) => ({
                      value: `asset:${item.id}`,
                      label: item.name,
                    })),
                ];
                return (
                  <fieldset key={rule.id}>
                    <legend>Contribution {index + 1}</legend>
                    <label>
                      Destination
                      <select
                        value={`${rule.destinationType}:${rule.destinationId}`}
                        onChange={(event) => {
                          const [destinationType, destinationId] =
                            event.target.value.split(":");
                          setContributions((items) =>
                            items.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    destinationType:
                                      destinationType as ContributionRule["destinationType"],
                                    destinationId,
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        {destinations.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Contribution method
                      <select
                        aria-label={`Contribution ${index + 1} method`}
                        value={
                          rule.monthlyAmountCents !== undefined
                            ? "amount"
                            : "percent"
                        }
                        onChange={(event) =>
                          setContributions((items) =>
                            items.map((item, i) =>
                              i === index
                                ? event.target.value === "amount"
                                  ? (setAmountDrafts((drafts) => ({
                                      ...drafts,
                                      [item.id]: "100.00",
                                    })),
                                    {
                                      ...item,
                                      percentBps: undefined,
                                      monthlyAmountCents: 100_00,
                                    })
                                  : {
                                      ...item,
                                      monthlyAmountCents: undefined,
                                      percentBps: 1000,
                                    }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="percent">
                          Percentage of remaining surplus
                        </option>
                        <option value="amount">Fixed amount per month</option>
                      </select>
                    </label>
                    {rule.monthlyAmountCents !== undefined ? (
                      <label>
                        Amount per month
                        <input
                          aria-label={`Contribution ${index + 1} monthly amount`}
                          inputMode="decimal"
                          value={
                            amountDrafts[rule.id] ??
                            dollars(rule.monthlyAmountCents)
                          }
                          onChange={(event) => {
                            const draft = event.target.value;
                            setAmountDrafts((items) => ({
                              ...items,
                              [rule.id]: draft,
                            }));
                            const value = cents(draft);
                            if (value !== null)
                              setContributions((items) =>
                                items.map((item, i) =>
                                  i === index
                                    ? { ...item, monthlyAmountCents: value }
                                    : item,
                                ),
                              );
                          }}
                        />
                        <small>
                          Effective percentage is calculated automatically from
                          each month’s surplus.
                        </small>
                      </label>
                    ) : (
                      <label>
                        Percent of remaining surplus
                        <input
                          aria-label={`Contribution ${index + 1} percent`}
                          type="number"
                          min="0.01"
                          max="100"
                          step="0.01"
                          value={(rule.percentBps ?? 0) / 100}
                          onChange={(event) =>
                            setContributions((items) =>
                              items.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      percentBps: Math.round(
                                        Number(event.target.value) * 100,
                                      ),
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    )}
                    <label>
                      Frequency
                      <select
                        value={rule.frequency}
                        onChange={(event) =>
                          setContributions((items) =>
                            items.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    frequency: event.target
                                      .value as ContributionRule["frequency"],
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        {[
                          "weekly",
                          "biweekly",
                          "monthly",
                          "quarterly",
                          "annual",
                        ].map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Target balance (optional)
                      <input
                        inputMode="decimal"
                        value={dollars(rule.targetBalanceCents)}
                        onChange={(event) => {
                          const value =
                            event.target.value === ""
                              ? undefined
                              : cents(event.target.value);
                          if (value !== null)
                            setContributions((items) =>
                              items.map((item, i) =>
                                i === index
                                  ? { ...item, targetBalanceCents: value }
                                  : item,
                              ),
                            );
                        }}
                      />
                    </label>
                    <label>
                      Overflow investment (optional)
                      <select
                        value={
                          rule.overflowDestinationId
                            ? `${rule.overflowDestinationType}:${rule.overflowDestinationId}`
                            : ""
                        }
                        onChange={(event) => {
                          const [type, id] = event.target.value.split(":");
                          setContributions((items) =>
                            items.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    overflowDestinationType:
                                      type as ContributionRule["overflowDestinationType"],
                                    overflowDestinationId: id || undefined,
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        <option value="">Default cash</option>
                        {overflow
                          .filter(
                            (item) =>
                              item.value !==
                              `${rule.destinationType}:${rule.destinationId}`,
                          )
                          .map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <OverflowMenu
                      label={`More actions for contribution ${index + 1}`}
                      items={[{
                        label: "Remove contribution",
                        destructive: true,
                        onSelect: () => setContributions((items) => items.filter((_, i) => i !== index)),
                      }]}
                    />
                  </fieldset>
                );
              })}
            </section>
            <section aria-labelledby="withdrawal-title">
              <div className="card-title">
                <h3 id="withdrawal-title">Deficit withdrawals</h3>
                <ActionButton
                  onClick={() => {
                    const account = bootstrap.accounts.find(
                      (candidate) =>
                        candidate.liquid &&
                        !withdrawals.some(
                          (rule) => rule.accountId === candidate.id,
                        ),
                    );
                    if (account)
                      setWithdrawals((rules) => [
                        ...rules,
                        {
                          id: crypto.randomUUID(),
                          accountId: account.id,
                          priority: rules.length + 1,
                        },
                      ]);
                  }}
                >
                  Add rule
                </ActionButton>
              </div>
              {withdrawals.map((rule, i) => (
                <fieldset key={rule.id ?? i}>
                  <legend>Withdrawal {i + 1}</legend>
                  <label>
                    Liquid account
                    <select
                      value={rule.accountId}
                      onChange={(event) =>
                        setWithdrawals((rules) =>
                          rules.map((item, index) =>
                            index === i
                              ? { ...item, accountId: event.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      {bootstrap.accounts
                        .filter((account) => account.liquid)
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <OverflowMenu
                    label={`More actions for withdrawal ${i + 1}`}
                    items={[
                      { label: "Move up", disabled: i === 0, onSelect: () => setWithdrawals((rules) => moveRule(rules, i, -1)) },
                      { label: "Move down", disabled: i === withdrawals.length - 1, onSelect: () => setWithdrawals((rules) => moveRule(rules, i, 1)) },
                      {
                        label: "Remove withdrawal",
                        destructive: true,
                        onSelect: () => setWithdrawals((rules) => rules.filter((_, index) => index !== i).map((item, index) => ({ ...item, priority: index + 1 }))),
                      },
                    ]}
                  />
                </fieldset>
              ))}
              {!withdrawals.length && (
                <p className="empty">
                  Deficits remain unfunded until a liquid account is added.
                </p>
              )}
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

function moveRule<T extends { priority: number }>(
  rules: T[],
  index: number,
  delta: number,
) {
  const target = index + delta;
  if (target < 0 || target >= rules.length) return rules;
  const next = [...rules];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((rule, priority) => ({ ...rule, priority: priority + 1 }));
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
      else if (kind === "adu-build")
        event = {
          ...base,
          type: kind,
          assetId: f("assetId"),
          name: f("name").trim(),
          costCents: m("costCents")!,
          addedValueCents: m("addedValueCents", true),
          monthlyRentalIncomeCents: m("monthlyRentalIncomeCents", true),
          rentalIncomeGrowthBps: r("rentalIncomeGrowthBps"),
          fundingAccountId: f("fundingAccountId"),
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
      {kind === "adu-build" && (
        <>
          <label>
            Name
            <input
              required
              value={f("name")}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <label>
            Property
            <select
              required
              value={f("assetId")}
              onChange={(e) => set("assetId", e.target.value)}
            >
              <option value="">Choose property</option>
              {assets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {account("fundingAccountId", "Funding account")}
          {money("costCents", "Build cost (USD)")}
          {money("addedValueCents", "Added property value (optional)", true)}
          {money(
            "monthlyRentalIncomeCents",
            "Monthly rental income (optional)",
            true,
          )}
          <label>
            Rent growth (%)
            <input
              inputMode="decimal"
              value={f("rentalIncomeGrowthBps")}
              onChange={(e) => set("rentalIncomeGrowthBps", e.target.value)}
            />
          </label>
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
