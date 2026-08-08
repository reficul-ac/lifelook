import type { Cents, FilingStatus, TaxBracket, TaxEstimate, TaxRulePack } from "./types";

const brackets = (values: [number | null, number][]): TaxBracket[] => values.map(([dollars, rateBps]) => ({ upToCents: dollars === null ? null : dollars * 100, rateBps }));
const federalSingle = brackets([[11925,1000],[48475,1200],[103350,2200],[197300,2400],[250525,3200],[626350,3500],[null,3700]]);
const federalJoint = brackets([[23850,1000],[96950,1200],[206700,2200],[394600,2400],[501050,3200],[751600,3500],[null,3700]]);
const federalSeparate = brackets([[11925,1000],[48475,1200],[103350,2200],[197300,2400],[250525,3200],[375800,3500],[null,3700]]);
const federalHead = brackets([[17000,1000],[64850,1200],[103350,2200],[197300,2400],[250500,3200],[626350,3500],[null,3700]]);
const caSingle = brackets([[11079,100],[26264,200],[41452,400],[57528,600],[72724,800],[371479,930],[445771,1030],[742953,1130],[null,1230]]);
const caJoint = brackets([[22158,100],[52528,200],[82904,400],[115056,600],[145448,800],[742958,930],[891542,1030],[1485906,1130],[null,1230]]);

export const TAX_RULES_2025: TaxRulePack = {
  year: 2025,
  federal: {
    single: { standardDeductionCents: 15000_00, brackets: federalSingle },
    "married-joint": { standardDeductionCents: 30000_00, brackets: federalJoint },
    "married-separate": { standardDeductionCents: 15000_00, brackets: federalSeparate },
    "head-of-household": { standardDeductionCents: 22500_00, brackets: federalHead }
  },
  california: {
    single: { standardDeductionCents: 5540_00, brackets: caSingle },
    "married-joint": { standardDeductionCents: 11080_00, brackets: caJoint },
    "married-separate": { standardDeductionCents: 5540_00, brackets: caSingle },
    "head-of-household": { standardDeductionCents: 11080_00, brackets: caSingle }
  },
  socialSecurityWageBaseCents: 176100_00,
  additionalMedicareThresholdCents: { single: 200000_00, "married-joint": 250000_00, "married-separate": 125000_00, "head-of-household": 200000_00 }
};

export const TAX_RULES_2026: TaxRulePack = { ...TAX_RULES_2025, year: 2026 };

function progressive(amount: Cents, taxBrackets: readonly TaxBracket[]): Cents {
  let tax = 0, previous = 0;
  for (const bracket of taxBrackets) {
    const ceiling = bracket.upToCents ?? amount;
    const taxable = Math.max(0, Math.min(amount, ceiling) - previous);
    tax += Math.round(taxable * bracket.rateBps / 10_000);
    if (amount <= ceiling) break;
    previous = ceiling;
  }
  return tax;
}

export function estimateTax(grossCents: Cents, status: FilingStatus, pack: TaxRulePack, pretaxCents = 0, projected = false): TaxEstimate {
  const wages = Math.max(0, grossCents - pretaxCents);
  const fed = pack.federal[status], ca = pack.california[status];
  const federalCents = progressive(Math.max(0, wages - fed.standardDeductionCents), fed.brackets);
  const californiaCents = progressive(Math.max(0, wages - ca.standardDeductionCents), ca.brackets);
  const socialSecurityCents = Math.round(Math.min(wages, pack.socialSecurityWageBaseCents) * 620 / 10_000);
  const medicareCents = Math.round(wages * 145 / 10_000) + Math.round(Math.max(0, wages - pack.additionalMedicareThresholdCents[status]) * 90 / 10_000);
  const totalCents = federalCents + californiaCents + socialSecurityCents + medicareCents;
  return { federalCents, californiaCents, socialSecurityCents, medicareCents, totalCents, effectiveRateBps: wages ? Math.round(totalCents * 10_000 / wages) : 0, sourceYear: pack.year, projected };
}
