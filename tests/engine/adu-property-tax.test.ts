import {describe,expect,it} from 'vitest';
import {estimateAduPropertyTax,planAduTaxPayment} from '../../src/engine/property/adu-property-tax';
import {aduValue,makeAduPlan} from '../helpers/adu';
const property=makeAduPlan().properties[0]!;
describe('ADU assessments and explicitly entered planned payments',()=>{
  it('estimates the independent added assessment and grows only after enrollment',()=>{
    expect(aduValue(estimateAduPropertyTax(property,2028))).toEqual({assessedValueCents:22_000_000,recurringAnnualTaxCents:264_000});
    expect(aduValue(estimateAduPropertyTax(property,2029))).toEqual({assessedValueCents:22_440_000,recurringAnnualTaxCents:269_280});
    expect(property.openingValueCents).toBe(100_000_000);
  });
  it('uses January 1 progress assessments without estimating supplemental payment timing',()=>{
    const p={...property,aduProject:{...property.aduProject!,propertyTax:{...property.aduProject!.propertyTax,additionalAnnualChargesCents:10_000,constructionAssessments:[{year:2027,valueCents:{known:true as const,value:5_000_000}}]}}};expect(aduValue(estimateAduPropertyTax(p,2027))).toEqual({assessedValueCents:5_000_000,recurringAnnualTaxCents:70_000});expect(p.aduProject.propertyTax.paymentYears[1]!.payments).toEqual([]);
  });
  it('requires the relevant January 1 assessment, while a preconstruction estimate is zero',()=>{
    expect(estimateAduPropertyTax(property,2027).status).toBe('needs-data');expect(aduValue(estimateAduPropertyTax(property,2026))).toEqual({assessedValueCents:0,recurringAnnualTaxCents:0});
  });
  it('rejects a growth assumption beyond the sourced 200-bps cap',()=>{const p={...property,aduProject:{...property.aduProject!,propertyTax:{...property.aduProject!.propertyTax,annualAssessmentGrowthBps:201}}};expect(estimateAduPropertyTax(p,2029).status).toBe('unsupported-case');});
  it.each(['regular','supplemental','construction-in-progress'] as const)('constructs a %s row without mutating inputs or inventing tax eligibility',kind=>{
    const before=JSON.stringify(property);const row=planAduTaxPayment(property,2028,'2028-11',kind,264_000,'entered-payment');expect(row).toMatchObject({id:'entered-payment',month:'2028-11',kind,amountCents:264_000});expect(Object.values(row.treatments)).toEqual([{known:false},{known:false},{known:false},{known:false}]);expect(JSON.stringify(property)).toBe(before);
  });
});
