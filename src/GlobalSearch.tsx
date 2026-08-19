import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search } from "lucide-react";
import type { Bootstrap } from "./repository";

export type SearchKind =
  "Activity" | "Account" | "Asset" | "Debt" | "Recurring" | "Scenario";
export type SearchResult = {
  id: string;
  kind: SearchKind;
  label: string;
  meta: string;
  terms: string;
  view: "Activity" | "Plan" | "Net Worth";
};

export function buildSearchIndex(data: Bootstrap): SearchResult[] {
  const out: SearchResult[] = [];
  const groups = new Map<string, typeof data.activity>();
  data.activity.forEach((row) =>
    groups.set(row.entryId, [...(groups.get(row.entryId) ?? []), row]),
  );
  groups.forEach((rows, id) => {
    const row = rows[0],
      accounts = [...new Set(rows.map((x) => x.accountName))].join(" to "),
      label =
        row.description || (row.kind === "transfer" ? "Transfer" : row.kind);
    out.push({
      id,
      kind: "Activity",
      label,
      meta: `${accounts} · ${row.categoryName ?? row.kind} · ${row.occurredOn}`,
      terms: rows
        .map(
          (x) =>
            `${x.note ?? ""} ${x.accountName} ${x.categoryName ?? ""} ${x.kind} ${x.occurredOn}`,
        )
        .join(" "),
      view: "Activity",
    });
  });
  data.accounts.forEach((x) =>
    out.push({
      id: x.id,
      kind: "Account",
      label: x.name,
      meta: `${x.kind} · account`,
      terms: `${x.kind} account ${x.balanceCents}`,
      view: "Net Worth",
    }),
  );
  data.assets.forEach((x) =>
    out.push({
      id: x.id,
      kind: "Asset",
      label: x.name,
      meta: "Asset",
      terms: `asset ${x.valueCents} growth ${x.annualGrowthBps}`,
      view: "Net Worth",
    }),
  );
  data.liabilities.forEach((x) =>
    out.push({
      id: x.id,
      kind: "Debt",
      label: x.name,
      meta: x.mortgage ? "Mortgage debt" : "Debt",
      terms: `debt liability ${x.balanceCents} ${x.annualRateBps} ${x.mortgage?.startDate ?? ""}`,
      view: "Net Worth",
    }),
  );
  data.recurring.forEach((x) => {
    const category = data.categories.find((c) => c.id === x.categoryId),
      account = data.accounts.find((a) => a.id === x.accountId);
    out.push({
      id: x.id,
      kind: "Recurring",
      label: x.name,
      meta: `${category?.name ?? "Uncategorized"}${account ? ` · ${account.name}` : ""} · ${x.frequency}`,
      terms: `recurring planning ${category?.kind ?? ""} ${category?.name ?? ""} ${account?.name ?? ""} ${x.frequency} ${x.startDate} ${x.endDate ?? ""}`,
      view: "Plan",
    });
  });
  data.scenarios.forEach((x) =>
    out.push({
      id: x.id,
      kind: "Scenario",
      label: x.name,
      meta: `Scenario · ${x.horizonMonths} months`,
      terms: `scenario plan ${x.isBaseline ? "baseline" : ""} ${x.horizonMonths}`,
      view: "Plan",
    }),
  );
  return out;
}
export function searchIndex(index: SearchResult[], query: string, limit = 12) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  return index
    .map((result, order) => {
      const label = result.label.toLocaleLowerCase(),
        all = `${label} ${result.meta} ${result.terms}`.toLocaleLowerCase(),
        score =
          label === q
            ? 0
            : label.startsWith(q)
              ? 1
              : label.includes(q)
                ? 2
                : all.includes(q)
                  ? 3
                  : 99;
      return { result, order, score };
    })
    .filter((x) => x.score < 99)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.result);
}

export function GlobalSearch({
  index,
  invoker,
  onClose,
  onActivate,
}: {
  index: SearchResult[];
  invoker: HTMLElement | null;
  onClose: () => void;
  onActivate: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    panel = useRef<HTMLElement>(null),
    results = useMemo(() => searchIndex(index, query), [index, query]);
  useEffect(() => {
    input.current?.focus();
    return () => invoker?.focus();
  }, [invoker]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!results.length) return;
    const option = document.getElementById(`search-result-${active}`);
    option?.scrollIntoView?.({ block: "nearest" });
  }, [active, results.length]);
  function keyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setActive((x) => (x + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setActive((x) => (x - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      onActivate(results[active]);
    } else if (e.key === "Tab" && panel.current) {
      const f = [
        ...panel.current.querySelectorAll<HTMLElement>("input,button"),
      ];
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
        e.preventDefault();
        f[0]?.focus();
      }
    }
  }
  return (
    <div
      className="modal-backdrop search-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className="card global-search"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-title"
        onKeyDown={keyDown}
      >
        <h2 id="global-search-title" className="sr-only">
          Search workspace
        </h2>
        <div className="global-search-input">
          <Search size={19} />
          <input
            ref={input}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-haspopup="listbox"
            aria-label="Search workspace"
            placeholder="Search your workspace"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-controls="global-search-results"
            aria-activedescendant={
              results[active] ? `search-result-${active}` : undefined
            }
          />
          <kbd>Esc</kbd>
        </div>
        <p className="sr-only" role="status">
          {query
            ? `${results.length} result${results.length === 1 ? "" : "s"}`
            : "Type to search accounts, activity, assets, debts, recurring entries, and scenarios."}
        </p>
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
        >
          {!query.trim() && (
            <p className="search-guidance">
              Search accounts, activity, assets, debts, recurring entries, and
              scenarios.
            </p>
          )}
          {query.trim() && !results.length && (
            <p className="search-guidance">No results found.</p>
          )}
          {results.map((r, i) => (
            <button
              id={`search-result-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              key={`${r.kind}-${r.id}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onActivate(r)}
            >
              <span>{r.kind}</span>
              <strong>{r.label}</strong>
              <small>{r.meta}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
