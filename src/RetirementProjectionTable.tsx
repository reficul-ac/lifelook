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
      <section className="retirement-tax-breakdown" aria-label={`Tax breakdown for ${year.year}`}>
        <h4>Tax breakdown</h4>
        <dl>
          <div><dt>Ordinary retirement distributions</dt><dd><MoneyValue label="Ordinary retirement distributions" cents={year.taxBreakdown.ordinaryDistributionsCents} /></dd></div>
          <div><dt>Short-term stock gains</dt><dd><MoneyValue label="Short-term stock gains" cents={year.taxBreakdown.shortTermGainsCents} /></dd></div>
          <div><dt>Long-term stock gains</dt><dd><MoneyValue label="Long-term stock gains" cents={year.taxBreakdown.longTermGainsCents} /></dd></div>
          <div><dt>Gross rental income</dt><dd><MoneyValue label="Gross rental income" cents={year.taxBreakdown.grossRentalIncomeCents} /></dd></div>
          <div><dt>Federal rental deductions</dt><dd><MoneyValue label="Federal rental deductions" cents={year.taxBreakdown.federalRentalDeductionsCents} /></dd></div>
          <div><dt>Federal taxable rental income</dt><dd><MoneyValue label="Federal taxable rental income" cents={year.taxBreakdown.federalTaxableRentalIncomeCents} /></dd></div>
          <div><dt>California rental deductions</dt><dd><MoneyValue label="California rental deductions" cents={year.taxBreakdown.californiaRentalDeductionsCents} /></dd></div>
          <div><dt>California taxable rental income</dt><dd><MoneyValue label="California taxable rental income" cents={year.taxBreakdown.californiaTaxableRentalIncomeCents} /></dd></div>
          <div><dt>Federal deductible mortgage interest</dt><dd><MoneyValue label="Federal deductible mortgage interest" cents={year.taxBreakdown.federalMortgageInterestDeductionCents??0} /></dd></div>
          <div><dt>California deductible mortgage interest</dt><dd><MoneyValue label="California deductible mortgage interest" cents={year.taxBreakdown.californiaMortgageInterestDeductionCents??0} /></dd></div>
          <div><dt>Federal deduction</dt><dd><MoneyValue label="Federal deduction" cents={year.taxBreakdown.federalDeductionCents} /></dd></div>
          <div><dt>Federal taxable income</dt><dd><MoneyValue label="Federal taxable income" cents={year.taxBreakdown.federalTaxableIncomeCents} /></dd></div>
          <div><dt>California deduction</dt><dd><MoneyValue label="California deduction" cents={year.taxBreakdown.californiaDeductionCents} /></dd></div>
          <div><dt>California taxable income</dt><dd><MoneyValue label="California taxable income" cents={year.taxBreakdown.californiaTaxableIncomeCents} /></dd></div>
          <div><dt>Federal income tax</dt><dd><MoneyValue label="Federal income tax" cents={year.taxBreakdown.federalIncomeTaxCents} /></dd></div>
          <div><dt>California income tax</dt><dd><MoneyValue label="California income tax" cents={year.taxBreakdown.californiaIncomeTaxCents} /></dd></div>
          <div><dt>Net investment income tax</dt><dd><MoneyValue label="Net investment income tax" cents={year.taxBreakdown.netInvestmentIncomeTaxCents} /></dd></div>
          <div><dt>Home-sale tax</dt><dd><MoneyValue label="Home-sale tax" cents={year.taxBreakdown.homeSaleTaxCents} /></dd></div>
          <div><dt>Early-withdrawal penalties</dt><dd><MoneyValue label="Early-withdrawal penalties" cents={year.earlyPenaltyCents} /></dd></div>
          <div><dt>Total taxes</dt><dd><MoneyValue label="Total taxes" cents={year.totalTaxCents} /></dd></div>
        </dl>
      </section>
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
              <th scope="col" rowSpan={2}>Year and ages</th>
              <th scope="colgroup" colSpan={5}>Financial position</th>
              <th scope="colgroup" colSpan={4}>Retirement income</th>
            </tr>
            <tr>
              <th scope="col">Net worth</th>
              <th scope="col">Liquid accounts</th>
              <th scope="col">Retirement accounts</th>
              <th scope="col">Home equity</th>
              <th scope="col">Debt</th>
              <th scope="col">Withdrawal amount</th>
              <th scope="col">Rental income</th>
              <th scope="col">Taxes</th>
              <th scope="col">After-tax income</th>
            </tr>
          </thead>
          <tbody>
            {projection.years.map((year) => {
              const expanded = expandedYears.has(year.year);
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
                    <td><MoneyValue label="Net worth" cents={year.endingNetWorthCents} /></td>
                    <td><MoneyValue label="Liquid accounts" cents={year.endingLiquidAccountsCents} /></td>
                    <td><MoneyValue label="Retirement accounts" cents={year.endingRetirementAccountsCents} /></td>
                    <td><MoneyValue label="Home equity" cents={year.endingHomeEquityCents} /></td>
                    <td><MoneyValue label="Debt" cents={year.endingDebtCents} /></td>
                    <td><MoneyValue label="Withdrawal amount" cents={year.withdrawalFundedCents} /></td>
                    <td><MoneyValue label="Rental income" cents={year.rentalIncomeCents} /></td>
                    <td><MoneyValue label="Taxes" cents={year.totalTaxCents} /></td>
                    <td><MoneyValue label="After-tax income" cents={year.afterTaxIncomeCents} /></td>
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
