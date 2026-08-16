# Joint-income and equity tax audit

The committed audit case is anonymized in `fixtures/joint-income-private-equity.json`. It reproduces the confirmed monetary inputs without household or employer identity.

The corrected calculator differs from the legacy model in four material ways: income tax is aggregated by tax unit while Social Security is capped by employee; Medicare and California SDI remain uncapped; non-wage income is not silently included in payroll wages; and RSU wages arise from fixed-point units on explicit vest dates. Annual liability is reported separately from the amount accrued into future cash flow, and refund or balance due remains unknown because withholding inputs are not modeled.

For 2026, before income-tax deductions, the fixture pins household wages of $317,043.75, RSU wages of $112,043.75, Social Security of $14,539.00, Medicare plus Additional Medicare of $5,200.52, and California SDI of $4,121.57. The promotion grant contributes no 2026 wages. The 8,313-unit holding is $573,181.35 at the pinned $68.95 price.

Sources and assumptions are carried in the rule pack and yearly ledger. California 2026 return thresholds are projected from the official 2025 schedule; future indexed thresholds use scenario inflation, while the Additional Medicare threshold stays fixed and the latest known SDI rate is held constant.
