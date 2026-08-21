import type { FinancialSnapshot } from "./domain";
import type { Bootstrap } from "./repository";

export const financialSnapshotFromBootstrap = (
  bootstrap: Bootstrap,
): FinancialSnapshot => ({
  household: {
    id: bootstrap.household?.id ?? "local",
    name: bootstrap.household?.name ?? "Household",
    state: "CA",
    people: bootstrap.people.map((person) => ({
      id: person.id,
      name: person.name,
      birthDate: person.birthDate ?? undefined,
    })),
  },
  taxProfile: bootstrap.taxProfile!,
  accounts: bootstrap.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    kind: account.kind,
    balanceCents: account.balanceCents,
    annualReturnBps: account.annualReturnBps,
    liquid: account.liquid,
    ownerPersonId: account.ownerPersonId ?? null,
    subtype: account.subtype,
    taxableCostBasisCents: account.taxableCostBasisCents ?? null,
    rothContributionBasisCents: account.rothContributionBasisCents ?? null,
    rothOpeningYear: account.rothOpeningYear ?? null,
  })),
  recurring: bootstrap.recurring.map((entry) => ({
    ...entry,
    accountId: entry.accountId ?? undefined,
    endDate: entry.endDate ?? undefined,
    taxTreatment: entry.taxTreatment ?? "none",
    incomeType: entry.incomeType ?? "ordinary",
    kind: bootstrap.categories.find((category) => category.id === entry.categoryId)
      ?.kind === "income"
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
  actuals: bootstrap.activity.map((posting) => ({
    date: posting.occurredOn,
    kind: posting.kind,
    amountCents: posting.amountCents,
  })),
});
