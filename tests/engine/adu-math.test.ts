import { describe, expect, it } from 'vitest';
import { calculateAduValueAdded, aduAreaRatios } from '../../src/engine/property/adu-valuation';
import { calculateAduDepreciation } from '../../src/engine/property/adu-depreciation';
import { resolveYearRules } from '../../src/engine/rules/projection';
import { loadRuleSet } from '../../src/engine/rules/registry';
import { MAX_CENTS } from '../../src/engine/money';
import type { RentalBookState } from '../../src/engine/model/plan';
import { aduValue, makeAduPlan, zeroAduBook } from '../helpers/adu';
import { loadReferences, assertReference } from '../helpers/references';
const plan=makeAduPlan(), property=plan.properties[0]!, unit={...plan.rentals[0]!,availableDate:'2027-07-15'};
function depreciation(basis:number,year=2027,opening:RentalBookState={...zeroAduBook,recoveryBasisCents:basis,adjustedBuildingBasisCents:basis}) {
  return calculateAduDepreciation({unit,year,book:'federal',opening:{status:'available',value:opening},rules:aduValue(resolveYearRules(loadRuleSet(),year,plan.taxPolicy))});
}
describe('independent ADU market value and cumulative recovery worksheets',()=>{
  it.each(loadReferences<{kind:string;area:number;rateCents:number;openingValueCents:number;primaryArea:number},{valueAddedCents:number;referencePerSquareFootCents:number}>('adu-build').filter(c=>c.input.kind==='valuation'))('$id',c=>{
    const p={...property,aduArea:c.input.area,primaryArea:c.input.primaryArea,openingValueCents:c.input.openingValueCents,aduProject:{...property.aduProject!,valuation:{kind:'adu-value-per-square-foot' as const,valuePerSquareFootCents:c.input.rateCents}}};
    const actual={valueAddedCents:aduValue(calculateAduValueAdded(p)),referencePerSquareFootCents:aduValue(aduAreaRatios(p,{status:'available',value:c.input.openingValueCents}).existingWholePropertyValuePerSquareFootCents)};
    assertReference(actual,c.expected,c.toleranceCents);
  });
  it.each(loadReferences<{basisCents:number},{firstYearCents:number;secondYearCents:number;firstClosingBasisCents:number;firstMonthsCents:readonly number[]}>('adu-depreciation'))('$id',c=>{
    const first=aduValue(depreciation(c.input.basisCents));const second=aduValue(depreciation(c.input.basisCents,2028,first.closing));
    assertReference({firstYearCents:first.depreciationCents,secondYearCents:second.depreciationCents,firstClosingBasisCents:first.closing.adjustedBuildingBasisCents,firstMonthsCents:first.monthlyDepreciationCents},c.expected,0);
  });
  it.each([33_000_000,33_000_100,33_000_001])('recovers exactly %s cents and stops after the final half month',basis=>{
    let opening={...zeroAduBook,recoveryBasisCents:basis,adjustedBuildingBasisCents:basis},total=0;
    for(let year=2027;year<=2056;year++){
      const result=aduValue(depreciation(basis,year,opening));total+=result.depreciationCents;opening=result.closing;
      if(basis===33_000_000 && year>=2028 && year<=2054)expect(result.depreciationCents).toBe(1_200_000);
      if(basis===33_000_000 && year===2055)expect(result.monthlyDepreciationCents).toEqual([50_000,0,0,0,0,0,0,0,0,0,0,0]);
      if(year===2056)expect(result.depreciationCents).toBe(0);
    }
    expect(total).toBe(basis);expect(opening.adjustedBuildingBasisCents).toBe(0);expect(opening.cumulativeDepreciationCents).toBe(basis);
  });
  it.each(['2027-07-01','2027-07-15','2027-07-31'])('uses the same mid-month convention for %s',date=>{
    const result=aduValue(calculateAduDepreciation({unit:{...unit,availableDate:date},year:2027,book:'california-amt',opening:{status:'available',value:{...zeroAduBook,recoveryBasisCents:33_000_000,adjustedBuildingBasisCents:33_000_000}},rules:aduValue(resolveYearRules(loadRuleSet(),2027,plan.taxPolicy))}));expect(result.depreciationCents).toBe(550_000);
  });
  it('preserves known direct valuation while a missing primary area affects only its ratios',()=>{
    const {primaryArea,...p}=property;const direct={...p,aduProject:{...p.aduProject!,valuation:{kind:'value-added' as const,valueAddedCents:22_000_000}}};
    expect(calculateAduValueAdded(direct)).toEqual({status:'available',value:22_000_000});const ratios=aduAreaRatios(direct,{status:'available',value:122_000_000});expect(ratios.constructionCostPerSquareFootCents).toEqual({status:'available',value:37_500});expect(ratios.valueAddedPerSquareFootCents).toEqual({status:'available',value:27_500});expect(ratios.combinedValuePerSquareFootCents.status).toBe('needs-data');expect(ratios.existingWholePropertyValuePerSquareFootCents.status).toBe('needs-data');
  });
  it('keeps market rate independent of building recovery',()=>{expect(calculateAduValueAdded({...property,aduProject:{...property.aduProject!,valuation:{kind:'value-added',valueAddedCents:0}}})).toEqual({status:'available',value:0});expect(aduValue(depreciation(33_000_000)).depreciationCents).toBe(550_000);});
  it('returns unavailable on value overflow without hiding unrelated area ratios',()=>{
    const p={...property,aduProject:{...property.aduProject!,valuation:{kind:'adu-value-per-square-foot' as const,valuePerSquareFootCents:MAX_CENTS}}};expect(calculateAduValueAdded(p).status).toBe('needs-data');expect(aduAreaRatios(p,{status:'available',value:100_000_000}).existingWholePropertyValuePerSquareFootCents.status).toBe('available');
  });
  it('ignores future qualifications before service without inventing future basis',()=>{
    const r=aduValue(calculateAduDepreciation({unit:{...unit,qualifications:{...unit.qualifications,ordinaryResidential:{known:false}}},year:2026,book:'federal',opening:{status:'available',value:zeroAduBook},rules:aduValue(resolveYearRules(loadRuleSet(),2026,plan.taxPolicy))}));expect(r.depreciationCents).toBe(0);expect(r.closing.recoveryBasisCents).toBe(0);
  });
  it('preserves unknown basis and rejects unsupported recovery methods after readiness',()=>{
    const rules=aduValue(resolveYearRules(loadRuleSet(),2027,plan.taxPolicy));expect(calculateAduDepreciation({unit,year:2027,book:'federal',opening:{status:'needs-data',issues:[]},rules}).status).toBe('needs-data');expect(calculateAduDepreciation({unit,year:2027,book:'federal',opening:{status:'available',value:zeroAduBook},rules:{...rules,federal:{...rules.federal,rental:{...rules.federal.rental,recoveryPeriodMonths:480}}}}).status).toBe('unsupported-case');
  });
});
