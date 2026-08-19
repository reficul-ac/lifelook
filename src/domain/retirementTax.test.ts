import { describe,expect,it } from "vitest";
import { calculateRetirementTax,lotTerm,selectTaxLots } from "./retirementTax";

describe("retirement return tax ledger",()=>{
  it("taxes Social Security through the 0/50/85 percent tiers",()=>{
    const at=(pensionsCents:number)=>calculateRetirementTax({year:2026,filingStatus:"single",income:{pensionsCents,socialSecurityBenefitsCents:20_000_00}}).taxableSocialSecurityCents;
    expect(at(0)).toBe(0);expect(at(20_000_00)).toBeGreaterThan(0);expect(at(100_000_00)).toBe(17_000_00);
  });
  it("stacks preferential gains above ordinary taxable income and treats them as ordinary in California",()=>{
    const result=calculateRetirementTax({year:2026,filingStatus:"single",income:{pensionsCents:60_000_00,longTermGainsCents:20_000_00,qualifiedDividendsCents:5_000_00}});
    expect(result.bracketSlices.some(x=>x.kind==="preferential"&&x.rateBps===1500)).toBe(true);expect(result.californiaNetGainCents).toBe(20_000_00);expect(result.californiaIncomeTaxCents).toBeGreaterThan(0);
  });
  it("keeps jurisdictional loss carryforwards independent and applies the ordinary loss limit",()=>{
    const result=calculateRetirementTax({year:2026,filingStatus:"single",income:{shortTermGainsCents:1_000_00},losses:{federalShortCents:10_000_00,californiaShortCents:2_000_00}});
    expect(result.carryforwards.federalShortCents).toBe(6_000_00);expect(result.carryforwards.californiaShortCents).toBe(0);
  });
  it("uses prior-year safe harbor and reconciles the remainder",()=>{
    const result=calculateRetirementTax({year:2027,filingStatus:"single",income:{pensionsCents:300_000_00},priorYearTaxCents:30_000_00,priorYearAgiCents:200_000_00});
    expect(result.quarterlyPaymentsCents.reduce((a,b)=>a+b,0)).toBe(33_000_00);expect(result.yearEndTrueUpCents).toBe(result.totalLiabilityCents-33_000_00);expect(result.projectedFrozen).toBe(true);
  });
});

describe("specific-lot disposal",()=>{
  it("requires disposal strictly more than one year after acquisition",()=>{expect(lotTerm("2025-06-15","2026-06-14")).toBe("short");expect(lotTerm("2025-06-15","2026-06-15")).toBe("short");expect(lotTerm("2025-06-15","2026-06-16")).toBe("long")});
  it("selects losses first and partially depletes a lot with separate bases",()=>{const sold=selectTaxLots([{id:"gain",acquiredOn:"2020-01-01",marketValueCents:10_000,federalBasisCents:5_000,californiaBasisCents:4_000},{id:"loss",acquiredOn:"2020-01-01",marketValueCents:8_000,federalBasisCents:9_000,californiaBasisCents:10_000}],10_000,"2026-01-02");expect(sold.map(x=>x.lotId)).toEqual(["loss","gain"]);expect(sold[1]).toMatchObject({proceedsCents:2_000,federalBasisCents:1_000,californiaBasisCents:800})});
});
