import type {PlanDocument,Property} from '../../src/engine/model/plan';
import {makePlan} from './plans';

/** Synthetic acquisition; all figures are fictional and hand-checkable. */
export function makeFuturePurchasePlan(overrides:Partial<PlanDocument>={},propertyOverrides:Partial<Property>={}):PlanDocument {
 const property:Property={id:'future-home',name:'Future home',role:'primary',purchaseDate:'2027-06-15',purchasePriceCents:80_000_000,downPaymentCents:16_000_000,openingValueCents:80_000_000,appreciationBps:0,appreciationOverrides:[],
  loans:[{id:'purchase-mortgage',name:'Purchase mortgage',originalPrincipalCents:64_000_000,aprBps:600,originationDate:'2027-06-15',acquisitionDate:'2027-06-15',termMonths:360,firstPaymentDate:'2027-07-31',openingBalance:{known:false},openingPayment:{known:false},collateralPropertyId:'future-home',
   proceedsQualification:{kind:'acquisition',qualifiedAcquisitionDebt:{known:true,value:true},qualifiedPrincipalCents:{known:true,value:64_000_000},historyComplete:{known:true,value:true}},proceedsAllocations:[{propertyId:'future-home',use:'personal',share:{numerator:1,denominator:1}}],financingAtRiskQualification:{known:true,value:true}}],...propertyOverrides};
 return makePlan({horizonYears:3,openingCashCents:20_000_000,properties:[property],...overrides});
}
