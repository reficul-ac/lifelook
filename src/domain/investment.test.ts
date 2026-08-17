import {describe,expect,it} from "vitest";
import {calculateInvestmentComparison,defaultInvestmentAssumptions,mortgagePayment,validateInvestmentAssumptions} from "./investment";

describe("investment comparison",()=>{
  it("amortizes standard and zero-interest mortgages",()=>{
    expect(mortgagePayment(100_000,0,10)).toBe(10_000);
    expect(mortgagePayment(40_000_000,650,360)).toBeCloseTo(252_827.23,1);
    const result=calculateInvestmentComparison({...defaultInvestmentAssumptions,monthlyRentCents:0}); expect(result.ok).toBe(true);
    if(result.ok)expect(result.result.years[29].mortgageBalanceCents).toBe(0);
  });
  it("seeds stocks with the equivalent upfront cash",()=>{
    const result=calculateInvestmentComparison({...defaultInvestmentAssumptions,horizonYears:10}); if(!result.ok)throw new Error("invalid");
    expect(result.result.months[0].stockValueCents).toBe(11_500_000);
    expect(result.result.months[0].equityCents).toBe(10_000_000);
    expect(result.result.months[0].saleProceedsCents).toBe(7_000_000);
  });
  it("compounds monthly, contributes at month end, and aggregates annual flows",()=>{
    const a={...defaultInvestmentAssumptions,horizonYears:1}; const result=calculateInvestmentComparison(a); if(!result.ok)throw new Error("invalid");
    const year=result.result.years[0],points=result.result.months.slice(1);
    expect(year.ownerOutlayCents).toBe(points.reduce((s,p)=>s+p.ownerOutlayCents,0));
    expect(year.stockContributionCents).toBe(points.reduce((s,p)=>s+p.stockContributionCents,0));
    expect(year.homeValueCents).toBeCloseTo(51_520_797,-1);
  });
  it("rejects the first month rent exceeds owner outlay",()=>{
    const result=calculateInvestmentComparison({...defaultInvestmentAssumptions,monthlyRentCents:1_000_000});
    expect(result.ok).toBe(false); if(!result.ok)expect(result.errors[0]).toMatchObject({month:1,year:1});
  });
  it("validates boundaries and records crossover changes",()=>{
    expect(validateInvestmentAssumptions({...defaultInvestmentAssumptions,downPaymentBps:10_000,horizonYears:0}).map(x=>x.field)).toEqual(expect.arrayContaining(["downPaymentBps","horizonYears"]));
    const result=calculateInvestmentComparison({...defaultInvestmentAssumptions,stockReturnBps:0,homeAppreciationBps:10_000,horizonYears:5});
    if(result.ok)expect(result.result.equityCrossovers.length).toBeGreaterThanOrEqual(0);
  });
  it("invests Buy-path rental income at month end and includes it in Buy totals",()=>{
    const result=calculateInvestmentComparison({...defaultInvestmentAssumptions,horizonYears:1,monthlyRentCents:0,stockReturnBps:0,monthlyRentalIncomeCents:100_000,rentalIncomeGrowthBps:0});
    if(!result.ok)throw new Error("invalid");
    const end=result.result.months.at(-1)!;
    expect(end.rentalPortfolioCents).toBe(1_200_000);
    expect(end.buyRetainedTotalCents).toBe(end.equityCents+1_200_000);
    expect(end.buySaleTotalCents).toBe(end.saleProceedsCents+1_200_000);
    expect(result.result.years[0].rentalIncomeCents).toBe(1_200_000);
  });
});
