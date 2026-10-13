import type { CashFlowAllocationEntry, Cents } from '../model/plan';
import { assertMonetaryRange, CalculationRangeError, Decimal, settleCents, settleSeries } from '../money';

export interface SettledAllocationTarget {
  readonly entryId: string;
  readonly targetCents: Cents;
}
export interface FundingTarget {
  readonly ruleId: string;
  readonly stage: 'percent' | 'max' | 'overflow';
  readonly priority: number;
  readonly requestedCents: Cents;
  /** Eligible calendar months, numbered 1 through 12. */
  readonly allowedMonths: readonly number[];
  readonly employerKey?: string;
}
export interface EmployerFundingBudget {
  readonly key: string;
  readonly monthlyCents: readonly Cents[];
}
export interface FundingSchedule {
  readonly requestsByRule: ReadonlyMap<string, readonly Cents[]>;
  readonly fundedByRule: ReadonlyMap<string, Cents>;
}

function checkCents(value: Cents, nonnegative = false): void {
  assertMonetaryRange(new Decimal(value));
  if (!Number.isSafeInteger(value)) throw new CalculationRangeError();
  if (nonnegative && value < 0) throw new RangeError('Funding capacity must be nonnegative.');
}

function checkMonths(values: readonly Cents[], nonnegative = false): void {
  if (values.length !== 12) throw new RangeError('Funding requires twelve monthly amounts.');
  values.forEach(value => checkCents(value, nonnegative));
}

const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** All percentages share one denominator and one cumulative cent settlement. */
export function settleAllocationTargets(total: Cents, entries: readonly CashFlowAllocationEntry[]): readonly SettledAllocationTarget[] {
  checkCents(total);
  const percentages = entries.filter(entry => entry.amount.kind === 'percent')
    .sort((a, b) => a.priority - b.priority || compareId(a.id, b.id));
  const targets = settleSeries(percentages.map(entry => new Decimal(Math.max(0, total))
    .mul(entry.amount.kind === 'percent' ? entry.amount.percentBps : 0).div(10000)));
  return percentages.map((entry, index) => ({ entryId: entry.id, targetCents: targets[index]! }));
}

/** Cumulative new-deposit limits; the solver separately reports funded explicit cash. */
export function allocationFundingCeilings(cashAfterExisting: readonly Cents[], explicitCash: Cents): readonly Cents[] {
  checkMonths(cashAfterExisting);
  checkCents(explicitCash, true);
  let sum = new Decimal(0);
  const cumulative = cashAfterExisting.map(cash => {
    sum = sum.plus(cash);
    return settleCents(sum);
  });
  const december = cumulative[11]!;
  const actualCash = Math.min(explicitCash, Math.max(0, december));
  let futureMinimum = december - actualCash;
  const ceilings = Array<Cents>(12).fill(0);
  for (let month = 11; month >= 0; month--) {
    futureMinimum = Math.min(futureMinimum, cumulative[month]!);
    ceilings[month] = Math.max(0, futureMinimum);
  }
  return ceilings;
}

interface Edge {
  readonly to: number;
  readonly reverseIndex: number;
  capacity: Cents;
  remaining: Cents;
}

/** Integer residual routing, using shortest augmenting paths for bounded progress. */
class FundingNetwork {
  private readonly nodes: Edge[][] = [];

  node(): number {
    this.nodes.push([]);
    return this.nodes.length - 1;
  }

  connect(from: number, to: number, capacity: Cents): Edge {
    const forward: Edge = { to, reverseIndex: this.nodes[to]!.length, capacity, remaining: capacity };
    const reverse: Edge = { to: from, reverseIndex: this.nodes[from]!.length, capacity: 0, remaining: 0 };
    this.nodes[from]!.push(forward);
    this.nodes[to]!.push(reverse);
    return forward;
  }

  fund(source: number, sink: number, requested: Cents): Cents {
    let funded = 0;
    while (funded < requested) {
      const previous = Array<{ from: number; edge: Edge } | undefined>(this.nodes.length);
      const visited = new Set([source]);
      const queue = [source];
      for (let head = 0; head < queue.length && !visited.has(sink); head++) {
        const from = queue[head]!;
        for (const edge of this.nodes[from]!) {
          if (edge.remaining <= 0 || visited.has(edge.to)) continue;
          visited.add(edge.to);
          previous[edge.to] = { from, edge };
          queue.push(edge.to);
          if (edge.to === sink) break;
        }
      }
      if (!visited.has(sink)) break;
      let amount = requested - funded;
      for (let node = sink; node !== source;) {
        const step = previous[node]!;
        amount = Math.min(amount, step.edge.remaining);
        node = step.from;
      }
      for (let node = sink; node !== source;) {
        const step = previous[node]!;
        step.edge.remaining -= amount;
        this.nodes[node]![step.edge.reverseIndex]!.remaining += amount;
        node = step.from;
      }
      funded += amount;
    }
    return funded;
  }
}

const stageOrder = { percent: 0, max: 1, overflow: 2 } as const;

/**
 * Fund targets lexicographically by stage, priority and ID. Each month's chain
 * edge caps all deposits through that month. Employer/month edges additionally
 * share authoritative wage capacity among every target for that employer.
 *
 * Each new target is the only flow source. Reverse edges can move earlier
 * deposits, but conservation at earlier target nodes preserves their annual
 * funded totals. No saved contribution requests or legal rules are changed here.
 * A second pass spreads those accepted annual totals evenly across eligible
 * months. Only constraints that prevent this cadence relax the monthly quotas.
 */
export function scheduleAllocationFunding(targets: readonly FundingTarget[], ceilings: readonly Cents[], employers: readonly EmployerFundingBudget[]): FundingSchedule {
  checkMonths(ceilings, true);
  if (ceilings.some((ceiling, index) => index > 0 && ceiling < ceilings[index - 1]!)) {
    throw new RangeError('Cumulative funding ceilings must be nondecreasing.');
  }
  const sorted = [...targets].sort((a, b) => stageOrder[a.stage] - stageOrder[b.stage]
    || a.priority - b.priority || compareId(a.ruleId, b.ruleId));
  const ruleIds = new Set<string>();
  for (const target of sorted) {
    checkCents(target.requestedCents, true);
    if (ruleIds.has(target.ruleId)) throw new RangeError('Funding rule IDs must be unique.');
    ruleIds.add(target.ruleId);
    if (target.allowedMonths.some(month => !Number.isInteger(month) || month < 1 || month > 12)) {
      throw new RangeError('Eligible funding months must be between 1 and 12.');
    }
  }

  function route(annualTargets: readonly FundingTarget[], balance: boolean): FundingSchedule {
    const network = new FundingNetwork();
    const monthNodes = Array.from({ length: 12 }, () => network.node());
    const sink = network.node();
    monthNodes.forEach((node, month) => network.connect(node, monthNodes[month + 1] ?? sink, ceilings[month]!));
    const employerNodes = new Map<string, readonly number[]>();
    for (const employer of [...employers].sort((a, b) => compareId(a.key, b.key))) {
      checkMonths(employer.monthlyCents, true);
      if (employerNodes.has(employer.key)) throw new RangeError('Employer budget keys must be unique.');
      const nodes = employer.monthlyCents.map((capacity, month) => {
        const node = network.node();
        network.connect(node, monthNodes[month]!, capacity);
        return node;
      });
      employerNodes.set(employer.key, nodes);
    }

    const fundedByRule = new Map<string, Cents>();
    const edgesByRule = new Map<string, ReadonlyMap<number, Edge>>();
    const addedTargets: FundingTarget[] = [];
    for (const target of annualTargets) {
      const source = network.node();
      const edges = new Map<number, Edge>();
      const eligible = [...new Set(target.allowedMonths)].sort((a, b) => a - b);
      // Round exact cumulative fractions rather than repeatedly adding a rounded
      // repeating decimal (for example, six installments of 13 / 12 cents).
      const monthly = balance ? eligible.map((_, index) =>
        settleCents(new Decimal(target.requestedCents).mul(index + 1).div(eligible.length))
        - settleCents(new Decimal(target.requestedCents).mul(index).div(eligible.length))) : [];
      for (const [index, month] of eligible.entries()) {
        const destination = target.employerKey === undefined ? monthNodes[month - 1]
          : employerNodes.get(target.employerKey)?.[month - 1];
        if (destination !== undefined) edges.set(month, network.connect(source, destination, balance ? monthly[index]! : target.requestedCents));
      }
      edgesByRule.set(target.ruleId, edges);
      addedTargets.push(target);
      let funded = network.fund(source, sink, target.requestedCents);
      if (balance && funded < target.requestedCents) {
        // A later restricted payroll window can require moving earlier flexible
        // funding. Relax all existing targets, preserving the quota flow already
        // achieved and their independently established annual funded totals.
        for (const prior of addedTargets) {
          for (const edge of edgesByRule.get(prior.ruleId)!.values()) {
            edge.remaining += prior.requestedCents - edge.capacity;
            edge.capacity = prior.requestedCents;
          }
        }
        funded += network.fund(source, sink, target.requestedCents - funded);
      }
      fundedByRule.set(target.ruleId, funded);
    }
    // Read schedules only after every stage has had the opportunity to reroute.
    const requestsByRule = new Map<string, readonly Cents[]>();
    for (const target of annualTargets) {
      const edges = edgesByRule.get(target.ruleId)!;
      requestsByRule.set(target.ruleId, Array.from({ length: 12 }, (_, index) => {
        const edge = edges.get(index + 1);
        return edge ? edge.capacity - edge.remaining : 0;
      }));
    }
    return { requestsByRule, fundedByRule };
  }

  // Establish priorities without monthly quotas first: cadence must never
  // reduce the annual funding that the cash and employer constraints permit.
  const annual = route(sorted, false);
  return route(sorted.map(target => ({ ...target, requestedCents: annual.fundedByRule.get(target.ruleId)! })), true);
}
