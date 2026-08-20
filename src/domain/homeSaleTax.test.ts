import { describe, expect, it } from "vitest";
import { calculateIncrementalHomeSaleTax, type HomeSaleTaxItem } from "./homeSaleTax";

const baseline = {
  federalTaxableCents: 100_000_00,
  californiaTaxableCents: 100_000_00,
  modifiedAgiCents: 120_000_00,
};

const homeSale = (overrides: Partial<HomeSaleTaxItem> = {}): HomeSaleTaxItem => ({
  id: "home",
  name: "Home",
  use: "rental",
  acquiredOn: "2020-01-01",
  disposedOn: "2026-01-02",
  salePriceCents: 400_000_00,
  sellingCostCents: 0,
  federalBasisCents: 350_000_00,
  californiaBasisCents: 350_000_00,
  accumulatedFederalDepreciationCents: 0,
  accumulatedCaliforniaDepreciationCents: 0,
  primaryResidenceExclusionEligible: false,
  ...overrides,
});

const calculate = (
  sales: readonly HomeSaleTaxItem[],
  overrides: Partial<Parameters<typeof calculateIncrementalHomeSaleTax>[0]> = {},
) => calculateIncrementalHomeSaleTax({
  year: 2026,
  filingStatus: "single",
  thresholdInflationBps: 250,
  baseline,
  sales,
  ...overrides,
});

describe.each([
  {
    name: "uses gross sale price when there are no selling costs",
    sale: homeSale({ sellingCostCents: 0, federalBasisCents: 400_000_00, californiaBasisCents: 400_000_00 }),
    expectedNetCents: 500_000_00,
    expectedGainCents: 100_000_00,
  },
  {
    name: "subtracts selling costs from both proceeds and taxable gain",
    sale: homeSale({ sellingCostCents: 30_000_00, federalBasisCents: 400_000_00, californiaBasisCents: 400_000_00 }),
    expectedNetCents: 470_000_00,
    expectedGainCents: 70_000_00,
  },
  {
    name: "does not subtract an attached mortgage from taxable gain",
    sale: {
      ...homeSale({ sellingCostCents: 30_000_00, federalBasisCents: 400_000_00, californiaBasisCents: 400_000_00 }),
      mortgageBalanceCents: 350_000_00,
    },
    expectedNetCents: 470_000_00,
    expectedGainCents: 70_000_00,
  },
])("home-sale gain normalization", ({ name, sale, expectedNetCents, expectedGainCents }) => {
  it(name, () => {
    const result = calculate([{ ...sale, salePriceCents: 500_000_00 }]);

    expect(result.sales[0]).toEqual({
      id: "home",
      netSalePriceCents: expectedNetCents,
      federalGainCents: expectedGainCents,
      californiaGainCents: expectedGainCents,
      exclusionCents: 0,
    });
  });
});

describe.each([
  { filingStatus: "single", expectedExclusionCents: 250_000_00, expectedGainCents: 350_000_00 },
  { filingStatus: "married-joint", expectedExclusionCents: 500_000_00, expectedGainCents: 100_000_00 },
  { filingStatus: "married-separate", expectedExclusionCents: 250_000_00, expectedGainCents: 350_000_00 },
  { filingStatus: "head-of-household", expectedExclusionCents: 250_000_00, expectedGainCents: 350_000_00 },
] as const)("primary-residence exclusion for $filingStatus", ({ filingStatus, expectedExclusionCents, expectedGainCents }) => {
  it("caps the exclusion at the filing-status limit", () => {
    const result = calculate([
      homeSale({
        use: "personal",
        salePriceCents: 700_000_00,
        federalBasisCents: 100_000_00,
        californiaBasisCents: 100_000_00,
        primaryResidenceExclusionEligible: true,
      }),
    ], { filingStatus });

    expect(result.sales[0]).toEqual(expect.objectContaining({
      exclusionCents: expectedExclusionCents,
      federalGainCents: expectedGainCents,
      californiaGainCents: expectedGainCents,
    }));
  });
});

it("applies the primary-residence exclusion only to positive non-recapture gain", () => {
  const result = calculate([
    homeSale({
      use: "personal",
      salePriceCents: 400_000_00,
      federalBasisCents: 200_000_00,
      californiaBasisCents: 200_000_00,
      accumulatedFederalDepreciationCents: 40_000_00,
      accumulatedCaliforniaDepreciationCents: 40_000_00,
      primaryResidenceExclusionEligible: true,
    }),
  ], { filingStatus: "married-joint" });

  expect(result.sales[0]).toEqual({
    id: "home",
    netSalePriceCents: 400_000_00,
    federalGainCents: 40_000_00,
    californiaGainCents: 40_000_00,
    exclusionCents: 200_000_00,
  });
  expect(result.federalLongTermGainCents).toBe(40_000_00);
  expect(result.unrecaptured1250GainCents).toBe(40_000_00);
});

describe.each([
  {
    name: "treats a sale on the first anniversary as short-term ordinary income",
    disposedOn: "2026-01-01",
    expectedShortCents: 10_000_00,
    expectedLongCents: 0,
    expectedFederalTaxCents: 1_200_00,
    expectedTotalTaxCents: 1_461_59,
  },
  {
    name: "treats a sale one day after the first anniversary as long-term gain",
    disposedOn: "2026-01-02",
    expectedShortCents: 0,
    expectedLongCents: 10_000_00,
    expectedFederalTaxCents: 0,
    expectedTotalTaxCents: 261_59,
  },
])("holding-period boundary", ({ name, disposedOn, expectedShortCents, expectedLongCents, expectedFederalTaxCents, expectedTotalTaxCents }) => {
  it(name, () => {
    const result = calculate([
      homeSale({
        acquiredOn: "2025-01-01",
        disposedOn,
        salePriceCents: 110_000_00,
        federalBasisCents: 100_000_00,
        californiaBasisCents: 100_000_00,
      }),
    ], {
      baseline: {
        federalTaxableCents: 20_000_00,
        californiaTaxableCents: 20_000_00,
        modifiedAgiCents: 20_000_00,
      },
    });

    expect(result.federalShortTermGainCents).toBe(expectedShortCents);
    expect(result.federalLongTermGainCents).toBe(expectedLongCents);
    expect(result.federalIncomeTaxCents).toBe(expectedFederalTaxCents);
    expect(result.californiaIncomeTaxCents).toBe(261_59);
    expect(result.totalIncrementalTaxCents).toBe(expectedTotalTaxCents);
  });
});

it("taxes rental depreciation at applicable ordinary rates below the 25% cap", () => {
  const result = calculate([
    homeSale({
      salePriceCents: 110_000_00,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
      accumulatedFederalDepreciationCents: 10_000_00,
      accumulatedCaliforniaDepreciationCents: 10_000_00,
    }),
  ], {
    baseline: {
      federalTaxableCents: 40_000_00,
      californiaTaxableCents: 0,
      modifiedAgiCents: 40_000_00,
    },
  });

  expect(result.federalLongTermGainCents).toBe(20_000_00);
  expect(result.unrecaptured1250GainCents).toBe(10_000_00);
  expect(result.federalIncomeTaxCents).toBe(2_700_00);
  expect(result.californiaIncomeTaxCents).toBe(286_44);
  expect(result.totalIncrementalTaxCents).toBe(2_986_44);
});

it("caps rental depreciation tax at 25% when the applicable ordinary rate is higher", () => {
  const result = calculate([
    homeSale({
      salePriceCents: 110_000_00,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
      accumulatedFederalDepreciationCents: 10_000_00,
      accumulatedCaliforniaDepreciationCents: 10_000_00,
    }),
  ], {
    baseline: {
      federalTaxableCents: 300_000_00,
      californiaTaxableCents: 0,
      modifiedAgiCents: 0,
    },
  });

  expect(result.unrecaptured1250GainCents).toBe(10_000_00);
  expect(result.federalIncomeTaxCents).toBe(4_000_00);
});

it("taxes simultaneous homes against one household long-term-gain stack", () => {
  const primaryHomeSale = homeSale({
    id: "primary",
    name: "Primary home",
    use: "personal",
    salePriceCents: 356_000_00,
    federalBasisCents: 100_000_00,
    californiaBasisCents: 100_000_00,
    primaryResidenceExclusionEligible: true,
  });
  const rentalHomeSale = homeSale({
    id: "rental",
    name: "Rental home",
    salePriceCents: 106_000_00,
    federalBasisCents: 100_000_00,
    californiaBasisCents: 100_000_00,
  });

  const result = calculate([primaryHomeSale, rentalHomeSale], {
    baseline: {
      federalTaxableCents: 40_000_00,
      californiaTaxableCents: 0,
      modifiedAgiCents: 40_000_00,
    },
  });

  expect(result.sales).toHaveLength(2);
  expect(result.federalLongTermGainCents).toBe(12_000_00);
  expect(result.unrecaptured1250GainCents).toBe(0);
  expect(result.federalIncomeTaxCents).toBe(382_50);
  expect(result.californiaIncomeTaxCents).toBe(126_44);
  expect(result.totalIncrementalTaxCents).toBe(508_94);
  expect(result.totalIncrementalTaxCents).toBe(
    result.federalIncomeTaxCents + result.californiaIncomeTaxCents + result.niitCents,
  );
});

it("shares one filing-status exclusion cap across simultaneous eligible homes", () => {
  const result = calculate([
    homeSale({
      id: "first",
      name: "First eligible home",
      use: "personal",
      salePriceCents: 400_000_00,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
      primaryResidenceExclusionEligible: true,
    }),
    homeSale({
      id: "second",
      name: "Second eligible home",
      use: "personal",
      salePriceCents: 400_000_00,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
      primaryResidenceExclusionEligible: true,
    }),
  ], { filingStatus: "married-joint" });

  expect(result.sales.map((sale) => sale.exclusionCents)).toEqual([300_000_00, 200_000_00]);
  expect(result.sales.map((sale) => sale.federalGainCents)).toEqual([0, 100_000_00]);
  expect(result.federalLongTermGainCents).toBe(100_000_00);
  expect(result.californiaGainCents).toBe(100_000_00);
});

it("calculates the California delta from its own basis and ordinary brackets", () => {
  const result = calculate([
    homeSale({
      salePriceCents: 110_000_00,
      federalBasisCents: 110_000_00,
      californiaBasisCents: 100_000_00,
    }),
  ], {
    baseline: {
      federalTaxableCents: 0,
      californiaTaxableCents: 20_000_00,
      modifiedAgiCents: 0,
    },
  });

  expect(result.sales[0]).toEqual(expect.objectContaining({
    federalGainCents: 0,
    californiaGainCents: 10_000_00,
  }));
  expect(result.federalIncomeTaxCents).toBe(0);
  expect(result.californiaGainCents).toBe(10_000_00);
  expect(result.californiaIncomeTaxCents).toBe(261_59);
  expect(result.totalIncrementalTaxCents).toBe(261_59);
});

describe.each([
  { name: "ends exactly at the fixed threshold", modifiedAgiCents: 190_000_00, gainCents: 10_000_00, expectedNiitCents: 0 },
  { name: "taxes only the amount crossing the fixed threshold", modifiedAgiCents: 195_000_00, gainCents: 10_000_00, expectedNiitCents: 190_00 },
  { name: "taxes the full gain when baseline income already exceeds the threshold", modifiedAgiCents: 210_000_00, gainCents: 10_000_00, expectedNiitCents: 380_00 },
  { name: "rounds a sub-dollar NIIT result to integer cents", modifiedAgiCents: 200_000_00, gainCents: 14, expectedNiitCents: 1 },
])("NIIT in an inflation-projected year", ({ name, modifiedAgiCents, gainCents, expectedNiitCents }) => {
  it(name, () => {
    const result = calculate([
      homeSale({
        acquiredOn: "2030-01-01",
        disposedOn: "2035-01-02",
        salePriceCents: 100_000_00 + gainCents,
        federalBasisCents: 100_000_00,
        californiaBasisCents: 100_000_00,
      }),
    ], {
      year: 2035,
      thresholdInflationBps: 250,
      baseline: {
        federalTaxableCents: 0,
        californiaTaxableCents: 0,
        modifiedAgiCents,
      },
    });

    expect(result.niitCents).toBe(expectedNiitCents);
  });
});

it("ignores a personal-residence loss instead of creating a tax benefit", () => {
  const result = calculate([
    homeSale({
      use: "personal",
      salePriceCents: 100_000_00,
      federalBasisCents: 150_000_00,
      californiaBasisCents: 150_000_00,
      primaryResidenceExclusionEligible: true,
    }),
  ]);

  expect(result.sales[0]).toEqual(expect.objectContaining({
    federalGainCents: 0,
    californiaGainCents: 0,
  }));
  expect(result.federalShortTermGainCents).toBe(0);
  expect(result.federalLongTermGainCents).toBe(0);
  expect(result.californiaGainCents).toBe(0);
  expect(result.totalIncrementalTaxCents).toBe(0);
});

it("does not deduct a personal-residence loss when the home is exclusion-ineligible", () => {
  const result = calculate([
    homeSale({
      id: "personal-loss",
      name: "Ineligible personal home",
      use: "personal",
      salePriceCents: 70_000_00,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
      primaryResidenceExclusionEligible: false,
    }),
    homeSale({
      id: "rental-gain",
      name: "Rental gain",
      use: "rental",
      salePriceCents: 120_000_00,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
    }),
  ], {
    baseline: {
      federalTaxableCents: 100_000_00,
      californiaTaxableCents: 100_000_00,
      modifiedAgiCents: 100_000_00,
    },
  });

  expect(result.sales[0]).toEqual(expect.objectContaining({ federalGainCents: 0, californiaGainCents: 0 }));
  expect(result.federalLongTermGainCents).toBe(20_000_00);
  expect(result.totalIncrementalTaxCents).toBe(4_860_00);
});

it("allows an exclusion-eligible rental loss to offset simultaneous property gain", () => {
  const result = calculate([
    homeSale({
      id: "eligible-rental-loss",
      name: "Eligible rental loss",
      use: "rental",
      salePriceCents: 70_000_00,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
      primaryResidenceExclusionEligible: true,
    }),
    homeSale({
      id: "rental-gain",
      name: "Rental gain",
      use: "rental",
      salePriceCents: 120_000_00,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
    }),
  ]);

  expect(result.sales[0]).toEqual(expect.objectContaining({ federalGainCents: -30_000_00, californiaGainCents: -30_000_00 }));
  expect(result.federalLongTermGainCents).toBe(0);
  expect(result.californiaGainCents).toBe(0);
  expect(result.totalIncrementalTaxCents).toBe(0);
});

describe.each([
  { gainCents: 20_000_00, expectedNetGainCents: 0, expectedTaxCents: 0 },
  { gainCents: 50_000_00, expectedNetGainCents: 20_000_00, expectedTaxCents: 4_860_00 },
])("simultaneous rental-loss netting", ({ gainCents, expectedNetGainCents, expectedTaxCents }) => {
  it("uses a rental loss only against gains in this transaction and floors liability at zero", () => {
    const loss = homeSale({
      id: "loss",
      name: "Rental sold at a loss",
      salePriceCents: 70_000_00,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
    });
    const gain = homeSale({
      id: "gain",
      name: "Rental sold at a gain",
      salePriceCents: 100_000_00 + gainCents,
      federalBasisCents: 100_000_00,
      californiaBasisCents: 100_000_00,
    });

    const result = calculate([loss, gain], {
      baseline: {
        federalTaxableCents: 100_000_00,
        californiaTaxableCents: 100_000_00,
        modifiedAgiCents: 100_000_00,
      },
    });

    expect(result.federalLongTermGainCents).toBe(expectedNetGainCents);
    expect(result.californiaGainCents).toBe(expectedNetGainCents);
    expect(result.totalIncrementalTaxCents).toBe(expectedTaxCents);
    expect(result.totalIncrementalTaxCents).toBeGreaterThanOrEqual(0);
  });
});

it("returns a zero incremental liability when there are no home sales", () => {
  expect(calculate([])).toEqual({
    sales: [],
    federalShortTermGainCents: 0,
    federalLongTermGainCents: 0,
    unrecaptured1250GainCents: 0,
    californiaGainCents: 0,
    federalIncomeTaxCents: 0,
    californiaIncomeTaxCents: 0,
    niitCents: 0,
    totalIncrementalTaxCents: 0,
  });
});

describe.each([
  { name: "noncanonical acquisition date", override: { acquiredOn: "2020-1-01" } },
  { name: "invalid disposal date", override: { disposedOn: "not-a-date" } },
  { name: "impossible disposal date", override: { disposedOn: "2026-02-29" } },
  { name: "disposal before acquisition", override: { acquiredOn: "2026-02-01", disposedOn: "2026-01-31" } },
])("date validation", ({ name, override }) => {
  it(`rejects ${name}`, () => {
    expect(() => calculate([homeSale(override)])).toThrow(RangeError);
  });
});

it("rejects a disposal year that does not match the calculation year", () => {
  expect(() => calculate([homeSale({ disposedOn: "2025-12-31" })])).toThrow(/disposedOn.*year/i);
});

describe.each([
  { name: "negative sale price", run: () => calculate([homeSale({ salePriceCents: -1 })]), field: "salePriceCents" },
  { name: "fractional selling cost", run: () => calculate([homeSale({ sellingCostCents: 1.5 })]), field: "sellingCostCents" },
  { name: "unsafe federal basis", run: () => calculate([homeSale({ federalBasisCents: Number.MAX_SAFE_INTEGER + 1 })]), field: "federalBasisCents" },
  { name: "negative California basis", run: () => calculate([homeSale({ californiaBasisCents: -1 })]), field: "californiaBasisCents" },
  { name: "fractional federal depreciation", run: () => calculate([homeSale({ accumulatedFederalDepreciationCents: 1.5 })]), field: "accumulatedFederalDepreciationCents" },
  { name: "unsafe California depreciation", run: () => calculate([homeSale({ accumulatedCaliforniaDepreciationCents: Number.MAX_SAFE_INTEGER + 1 })]), field: "accumulatedCaliforniaDepreciationCents" },
  {
    name: "negative federal baseline",
    run: () => calculate([], { baseline: { ...baseline, federalTaxableCents: -1 } }),
    field: "baseline.federalTaxableCents",
  },
  {
    name: "fractional California baseline",
    run: () => calculate([], { baseline: { ...baseline, californiaTaxableCents: 1.5 } }),
    field: "baseline.californiaTaxableCents",
  },
  {
    name: "unsafe modified AGI baseline",
    run: () => calculate([], { baseline: { ...baseline, modifiedAgiCents: Number.MAX_SAFE_INTEGER + 1 } }),
    field: "baseline.modifiedAgiCents",
  },
])("cent validation", ({ name, run, field }) => {
  it(`rejects ${name}`, () => {
    expect(run).toThrow(RangeError);
    expect(run).toThrow(new RegExp(`${field}.*non-negative safe integer`, "i"));
  });
});

describe.each([
  {
    name: "selling costs above sale price",
    sale: homeSale({ salePriceCents: 100_000_00, sellingCostCents: 100_000_01 }),
    message: /sellingCostCents.*salePriceCents/i,
  },
  {
    name: "federal depreciation above basis",
    sale: homeSale({ federalBasisCents: 10_000_00, accumulatedFederalDepreciationCents: 10_000_01 }),
    message: /accumulatedFederalDepreciationCents.*federalBasisCents/i,
  },
  {
    name: "California depreciation above basis",
    sale: homeSale({ californiaBasisCents: 10_000_00, accumulatedCaliforniaDepreciationCents: 10_000_01 }),
    message: /accumulatedCaliforniaDepreciationCents.*californiaBasisCents/i,
  },
])("cross-field validation", ({ name, sale, message }) => {
  it(`rejects ${name}`, () => {
    expect(() => calculate([sale])).toThrow(message);
  });
});
