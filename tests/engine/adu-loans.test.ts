import {describe,expect,it} from 'vitest';
import {calculateAduLoanSchedule,resolveAduFunding} from '../../src/engine/property/adu-loans';
import type {AduCostStage,AduFinancing,AduProject,Property} from '../../src/engine/model/plan';
import {MAX_CENTS} from '../../src/engine/money';
import {aduValue,makeAduPlan,makeAduTreatments} from '../helpers/adu';
import {assertReference,loadReferences} from '../helpers/references';
function property(financingOverrides:Partial<AduFinancing>={},projectOverrides:Partial<AduProject>={}):Property{
  const p=makeAduPlan().properties[0]!;
  return {...p,aduProject:{...p.aduProject!,financing:{id:'construction-loan',name:'Dedicated construction loan',aprBps:0,firstAmortizingPaymentMonth:'2028-01',termMonths:120,collateralPropertyId:'home',draws:[{id:'draw-july',month:'2027-07',amountCents:12_000_000,costAllocations:[{costId:'building-stage',amountCents:12_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true},...financingOverrides},...projectOverrides}};
}
function stage(id:string,date:string,amount:number):AduCostStage{return{id,name:id,paymentDate:date,amountCents:amount,category:'building',treatments:makeAduTreatments(amount)};}
describe('draw-aware ADU debt and restricted cash',()=>{
  it.each(loadReferences<{kind:string},{closing2027Cents:number;closing2028Cents:number;finalPaymentMonth:string;monthlyPaymentCents:number}>('adu-build').filter(c=>c.input.kind==='loan'))('$id',c=>{
    const s=aduValue(calculateAduLoanSchedule(property(),2026,13));const last=s.months.filter(m=>m.paymentCents!==0).at(-1)!;
    assertReference({closing2027Cents:s.months[23]!.closingPrincipalCents,closing2028Cents:s.months[35]!.closingPrincipalCents,finalPaymentMonth:last.date.slice(0,7),monthlyPaymentCents:s.months[24]!.paymentCents},c.expected,c.toleranceCents);
    expect(last.closingPrincipalCents).toBe(0);expect(s.months.slice(0,18).every(m=>m.interestCents===0&&m.openingPrincipalCents===0&&m.drawCents===0)).toBe(true);
  });
  it('pays the contractual residual cent at zero APR',()=>{
    const p=property({firstAmortizingPaymentMonth:'2027-08',termMonths:3,draws:[{id:'small-draw',month:'2027-07',amountCents:10000,costAllocations:[{costId:'building-stage',amountCents:10000}]}]});const s=aduValue(calculateAduLoanSchedule(p,2027,1));expect(s.months.slice(7,10).map(m=>m.paymentCents)).toEqual([3333,3333,3334]);expect(s.months[9]!.closingPrincipalCents).toBe(0);expect(s.months[10]!.paymentCents).toBe(0);
  });
  it('charges interest on beginning-of-month draws and none before the first draw',()=>{
    const p=property({aprBps:600,draws:[{id:'june',month:'2027-06',amountCents:7_500_000,costAllocations:[{costId:'building-stage',amountCents:7_500_000}]},{id:'july',month:'2027-07',amountCents:7_500_000,costAllocations:[{costId:'building-stage',amountCents:7_500_000}]}]});const s=aduValue(calculateAduLoanSchedule(p,2027,1));expect(s.months[5]!.interestCents).toBe(37500);expect(s.months[6]!.interestCents).toBe(75000);expect(s.months.reduce((n,m)=>n+m.interestCents,0)).toBe(487500);expect(s.months.slice(0,5).every(m=>m.paymentCents===0)).toBe(true);expect(s).not.toHaveProperty('qualification');expect(s.averageBalanceEvidence).toEqual([]);
  });
  it('conserves same-month draws and counts each partial owner payment once',()=>{
    const p=property({draws:[{id:'one',month:'2027-07',amountCents:10_000_000,costAllocations:[{costId:'building-stage',amountCents:10_000_000}]},{id:'two',month:'2027-07',amountCents:10_000_000,costAllocations:[{costId:'building-stage',amountCents:10_000_000}]}]});const funding=aduValue(resolveAduFunding(p,2027,1));expect(funding[6]).toMatchObject({drawCents:20_000_000,financedCostPaidCents:20_000_000,ownerConstructionCents:10_000_000,closingEarmarkedCents:0});expect(funding.reduce((n,m)=>n+m.ownerConstructionCents,0)).toBe(10_000_000);
  });
  it('holds earmarked proceeds across December until their January staged payment',()=>{
    const p=property({draws:[{id:'advance',month:'2027-12',amountCents:10_000_000,costAllocations:[{costId:'later-stage',amountCents:10_000_000}]}],firstAmortizingPaymentMonth:'2028-02'}, {completionDate:'2028-01-31',costs:[stage('later-stage','2028-01-15',15_000_000)]});const funding=aduValue(resolveAduFunding(p,2027,2));expect(funding[11]).toMatchObject({drawCents:10_000_000,financedCostPaidCents:0,closingEarmarkedCents:10_000_000});expect(funding[12]).toMatchObject({openingEarmarkedCents:10_000_000,financedCostPaidCents:10_000_000,ownerConstructionCents:5_000_000,closingEarmarkedCents:0});
  });
  it('does not use future earmarks to hide the owner cash needed for paid interest',()=>{
    const p=property({aprBps:600,draws:[{id:'advance',month:'2027-06',amountCents:10_000_000,costAllocations:[{costId:'building-stage',amountCents:10_000_000}]}]});const m=aduValue(calculateAduLoanSchedule(p,2027,1)).months[5]!;expect(m.drawCents-m.paymentCents).toBe(9_950_000);expect(m.drawCents-m.paymentCents-m.closingEarmarkedCents).toBe(-50_000);
  });
  it('returns full owner funding for a cash-only project without inventing a loan',()=>{
    const p=makeAduPlan().properties[0]!;const funding=aduValue(resolveAduFunding(p,2026,3));expect(funding[18]).toMatchObject({ownerConstructionCents:30_000_000,drawCents:0,closingEarmarkedCents:0});expect(calculateAduLoanSchedule(p,2026,3)).toMatchObject({status:'needs-data',issues:[expect.objectContaining({code:'required-adu-financing'})]});
  });
  it('preserves the contractual term across shorter forecast prefixes and future draws',()=>{
    const short=aduValue(calculateAduLoanSchedule(property(),2026,1));expect(short.months.every(m=>m.closingPrincipalCents===0&&m.paymentCents===0)).toBe(true);const longer=aduValue(calculateAduLoanSchedule(property(),2026,3));expect(longer.months.slice(0,12)).toEqual(short.months);expect(longer.months[35]!.closingPrincipalCents).toBe(10_800_000);
  });
  it('keeps debt mechanically available when tax qualification is unknown',()=>{expect(calculateAduLoanSchedule(property({rentalInterestQualified:{known:false},financingAtRiskQualification:{known:false}}),2026,3).status).toBe('available');});
  it('does not let overflow in a later prefix erase an earlier independent year',()=>{
    const p=property({aprBps:100000,draws:[{id:'big',month:'2027-07',amountCents:MAX_CENTS,costAllocations:[{costId:'building-stage',amountCents:MAX_CENTS}]}]},{costs:[stage('building-stage','2027-07-01',MAX_CENTS)]});expect(calculateAduLoanSchedule(p,2026,1).status).toBe('available');expect(calculateAduLoanSchedule(p,2026,2).status).toBe('needs-data');
  });
  it.each([
    ['reimbursement',(p:any):void=>{p.aduProject.costs[0].paymentDate='2027-03-01';}],
    ['nonconserving attribution',(p:any):void=>{p.aduProject.financing.draws[0].costAllocations[0].amountCents=1;}],
    ['foreign cost',(p:any):void=>{p.aduProject.financing.draws[0].costAllocations[0].costId='foreign';}],
    ['duplicate financed cent',(p:any):void=>{p.aduProject.financing.draws.push({...p.aduProject.financing.draws[0],id:'duplicate',amountCents:30_000_000,costAllocations:[{costId:'building-stage',amountCents:30_000_000}]});}],
    ['unused at completion',(p:any):void=>{p.aduProject.costs[0].paymentDate='2027-08-01';}],
    ['draw at amortization',(p:any):void=>{p.aduProject.financing.firstAmortizingPaymentMonth='2027-07';}],
  ] as const)('rejects %s before posting any cash',(_,edit)=>{const p=structuredClone(property());edit(p);const before=JSON.stringify(p);expect(calculateAduLoanSchedule(p,2026,3).status).toBe('needs-data');expect(JSON.stringify(p)).toBe(before);});
});
