import { Fragment, useState } from "react";
import type {
  AvailableRetirementScenarioProjection,
  RetirementProjectionWarning,
  RetirementProjectionYear,
  RetirementScenario,
  UnavailableRetirementScenarioProjection,
} from "./domain";

export interface RetirementProjectionTableProps {
  selectedScenario: RetirementScenario;
  projection:
    | AvailableRetirementScenarioProjection<unknown>
    | UnavailableRetirementScenarioProjection;
  accountNames: Readonly<Record<string, string>>;
}

const scenarioLabel = (scenario: RetirementScenario) =>
  scenario === "keep-homes" ? "Keep homes" : "Sell all homes";

const absoluteMoney = (cents: number) => {
  const fractionDigits = Math.abs(cents) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 2,
  }).format(Math.abs(cents) / 100);
};

function MoneyValue({
  cents,
  label,
  negative = cents < 0,
}: {
  cents: number;
  label: string;
  negative?: boolean;
}) {
  const value = absoluteMoney(cents);
  const signed = negative && cents !== 0;
  return (
    <span
      className={signed ? "retirement-negative-value" : undefined}
      aria-label={signed ? `${label}: negative ${value}` : `${label}: ${value}`}
    >
      {signed ? "−" : ""}{value}
    </span>
  );
}

const warningTitle: Record<RetirementProjectionWarning["code"], string> = {
  "missing-destination": "Destination needed",
  "missing-home-data": "Home details needed",
  "early-withdrawal": "Early withdrawal penalty",
  "account-depleted": "Account depleted",
  "unfunded-spending": "Unfunded spending",
  "activity-ended": "Activity ended",
  "calculation-error": "Calculation needs attention",
  "unsupported-tax-character": "Unsupported tax character",
  "unsupported-rental-tax": "Rental tax needs attention",
  "conservative-taxable-basis": "Conservative taxable basis",
};

const formatWarningCents = (message: string) =>
  message.replace(/\b(\d+) cents\b/g, (_match, cents: string) =>
    absoluteMoney(Number(cents)));

function WarningCopy({
  warning,
  year,
  accountNames,
}: {
  warning: RetirementProjectionWarning;
  year?: number;
  accountNames: Readonly<Record<string, string>>;
}) {
  const warningYear = warning.year ?? year;
  const entity = warning.entityId == null
    ? null
    : accountNames[warning.entityId] ?? warning.entityId;
  return (
    <li className="retirement-projection-warning">
      <strong>{warningTitle[warning.code]}</strong>
      {": "}{formatWarningCents(warning.message)}
      <span className="retirement-warning-context">
        {`${warningYear == null ? "" : ` Year ${warningYear}`}${entity === null ? "" : ` · ${entity}`}`}
      </span>
    </li>
  );
}

function YearDetails({
  year,
  selectedScenario,
  accountNames,
  hidden,
}: {
  year: RetirementProjectionYear;
  selectedScenario: RetirementScenario;
  accountNames: Readonly<Record<string, string>>;
  hidden: boolean;
}) {
  return (
    <div className="retirement-year-details" id={`retirement-year-${year.year}`} hidden={hidden}>
      <dl>
        <div><dt>Rental income</dt><dd><MoneyValue label="Rental income" cents={year.rentalIncomeCents} /></dd></div>
        <div><dt>Mortgage principal</dt><dd><MoneyValue label="Mortgage principal" cents={year.housing.principalCents} /></dd></div>
        <div><dt>Mortgage interest</dt><dd><MoneyValue label="Mortgage interest" cents={year.housing.interestCents} /></dd></div>
        <div><dt>Property tax</dt><dd><MoneyValue label="Property tax" cents={year.housing.propertyTaxCents} /></dd></div>
        <div><dt>Home insurance</dt><dd><MoneyValue label="Home insurance" cents={year.housing.insuranceCents} /></dd></div>
        <div><dt>HOA</dt><dd><MoneyValue label="HOA" cents={year.housing.hoaCents} /></dd></div>
        <div><dt>Maintenance</dt><dd><MoneyValue label="Maintenance" cents={year.housing.maintenanceCents} /></dd></div>
        {selectedScenario === "sell-all-homes" && year.homeSale ? (
          <>
            <div><dt>Gross proceeds</dt><dd><MoneyValue label="Gross proceeds" cents={year.homeSale.grossSaleValueCents} /></dd></div>
            <div><dt>Selling costs</dt><dd><MoneyValue label="Selling costs" cents={year.homeSale.sellingCostsCents} negative /></dd></div>
            <div><dt>Mortgage payoff</dt><dd><MoneyValue label="Mortgage payoff" cents={year.homeSale.mortgagePayoffCents} negative /></dd></div>
            <div><dt>Incremental sale tax</dt><dd><MoneyValue label="Incremental sale tax" cents={year.homeSale.incrementalSaleTaxCents} negative /></dd></div>
          </>
        ) : null}
      </dl>
      {year.withdrawalSources.length > 0 ? (
        <section aria-label={`Withdrawal sources for ${year.year}`}>
          <h4>Withdrawal sources</h4>
          <ul>
            {year.withdrawalSources.map((source) => (
              <li key={`${source.accountId}-${source.taxYear}`}>
                {accountNames[source.accountId] ?? source.accountId}: {absoluteMoney(source.amountCents)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {year.warnings.length > 0 ? (
        <section aria-label={`Warnings for ${year.year}`}>
          <h4>Warnings</h4>
          <ul>
            {year.warnings.map((warning, index) => (
              <WarningCopy
                key={`${warning.code}-${warning.entityId ?? "household"}-${index}`}
                warning={warning}
                year={year.year}
                accountNames={accountNames}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function RetirementProjectionTable({
  selectedScenario,
  projection,
  accountNames,
}: RetirementProjectionTableProps) {
  const [expandedYears, setExpandedYears] = useState<ReadonlySet<number>>(new Set());
  const label = scenarioLabel(selectedScenario);

  if (!projection.available) {
    return (
      <section className="card retirement-projection retirement-projection-unavailable" aria-label={`${label} annual projection`}>
        <h3>{label} annual projection unavailable</h3>
        {projection.issues.length > 0 ? (
          <>
            <p>Complete the following home details to see annual results.</p>
            <ul>
              {projection.issues.map((issue, index) => (
                <li key={`${issue.assetId}-${issue.field}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </>
        ) : null}
        {projection.warnings.length > 0 ? (
          <section aria-label="Projection warnings">
            <h4>Projection warnings</h4>
            <ul>
              {projection.warnings.map((warning, index) => (
                <WarningCopy
                  key={`${warning.code}-${warning.entityId ?? "household"}-${index}`}
                  warning={warning}
                  accountNames={accountNames}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    );
  }

  const toggleYear = (year: number) => {
    setExpandedYears((current) => {
      const next = new Set(current);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  return (
    <section className="card retirement-projection" aria-label={`${label} annual projection`}>
      <div className="retirement-table-scroll">
        <table aria-label={`${label} annual projection`}>
          <caption>{label} annual projection — {projection.years.length}-year horizon</caption>
          <thead>
            <tr>
              <th scope="col">Year and ages</th>
              <th scope="col">Starting portfolio</th>
              <th scope="col">Pre-tax withdrawal</th>
              <th scope="col">Estimated taxes</th>
              <th scope="col">After-tax income</th>
              <th scope="col">Plan expenses</th>
              <th scope="col">Housing expenses</th>
              <th scope="col">Surplus / shortfall</th>
              <th scope="col">Ending destination balance</th>
              <th scope="col">Ending net worth</th>
            </tr>
          </thead>
          <tbody>
            {projection.years.map((year) => {
              const expanded = expandedYears.has(year.year);
              const shortfall = year.shortfallCents > 0;
              return (
                <Fragment key={year.year}>
                  <tr>
                    <th scope="row" className="retirement-projection-year">
                      <span>{year.year}</span>
                      <small>{year.ages.map((age) => `${age.name} ${age.age ?? "age unavailable"}`).join(", ")}</small>
                      <button
                        type="button"
                        aria-label={`View ${year.year} year details`}
                        aria-expanded={expanded}
                        aria-controls={`retirement-year-${year.year}`}
                        onClick={() => toggleYear(year.year)}
                      >
                        View year details
                      </button>
                    </th>
                    <td><MoneyValue label="Starting portfolio" cents={year.startingPortfolioCents} /></td>
                    <td><MoneyValue label="Pre-tax withdrawal" cents={year.withdrawalFundedCents} /></td>
                    <td><MoneyValue label="Estimated taxes" cents={year.estimatedTaxCents} /></td>
                    <td><MoneyValue label="After-tax income" cents={year.afterTaxIncomeCents} /></td>
                    <td><MoneyValue label="Plan expenses" cents={year.planExpenseCents} /></td>
                    <td><MoneyValue label="Housing expenses" cents={year.housingExpenseCents} /></td>
                    <td><MoneyValue label={shortfall ? "Shortfall" : "Surplus"} cents={shortfall ? year.shortfallCents : year.surplusCents} negative={shortfall} /></td>
                    <td><MoneyValue label="Ending destination balance" cents={year.destinationBalanceCents} /></td>
                    <td><MoneyValue label="Ending net worth" cents={year.endingNetWorthCents} /></td>
                  </tr>
                  <tr hidden={!expanded}>
                      <td colSpan={10}>
                        <YearDetails
                          year={year}
                          selectedScenario={selectedScenario}
                          accountNames={accountNames}
                          hidden={!expanded}
                        />
                      </td>
                    </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
