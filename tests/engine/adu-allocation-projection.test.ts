import {describe,expect,it} from 'vitest';
import {calculateProjection} from '../../src/engine/projection';
import {cashFlowBeforeInvestments} from '../../src/engine/property/adu-projection';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {makeAduPlan,makeAduTreatments,aduValue} from '../helpers/adu';
import {mustValidate} from '../helpers/plans';
import {makeAllocationPolicy} from '../helpers/allocations';
const brokerage={id:'brokerage',name:'Investment',ownerId:'owner-a',type:'taxable-brokerage' as const,openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:true as const,value:0}};
function fixture(){const p=makeAduPlan({openingCashCents:0,horizonYears:2,accounts:[brokerage],otherIncome:[{id:'income',name:'Cash income',amountCents:1_000_000,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,classification:'non-taxable'}],cashFlowAllocation:makeAllocationPolicy({entries:[{id:'invest',priority:1,destination:{kind:'account',accountId:'brokerage'},amount:{kind:'percent',percentBps:10000}}]})},{constructionStartDate:'2026-01-01',completionDate:'2026-03-31',productionPeriod:{known:true,value:{startDate:'2026-01-01',endDate:'2026-03-31',uninterrupted:true}},costs:[{id:'stage-one',name:'January',amountCents:800_000,paymentDate:'2026-01-01',category:'building',treatments:makeAduTreatments(800_000)},{id:'stage-two',name:'March',amountCents:400_000,paymentDate:'2026-03-01',category:'building',treatments:makeAduTreatments(400_000)}],financing:{id:'loan',name:'Loan',aprBps:0,firstAmortizingPaymentMonth:'2027-01',termMonths:120,collateralPropertyId:'home',draws:[{id:'draw',month:'2026-01',amountCents:1_200_000,costAllocations:[{costId:'stage-one',amountCents:800_000},{costId:'stage-two',amountCents:400_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:true,value:true},rentalInterestQualified:{known:true,value:true},financingAtRiskQualification:{known:true,value:true}}});return{...p,rentals:[{...p.rentals[0]!,availableDate:'2026-04-01',rentStartDate:'2026-04-01'}]};}
describe('ADU earned cash allocation budget',()=>{
 it('releases financed costs into B without allocating loan proceeds or future earmarks',()=>{
  const result=calculateProjection(mustValidate(fixture()),loadRuleSet()),jan=result.months[0]!,mar=result.months[2]!,year=result.years[0]!,report=aduValue(year.cashFlowAllocation!);
  expect(aduValue(cashFlowBeforeInvestments(jan))).toBe(200_000);expect(aduValue(jan.adu!.allocationCashFlowCents)).toBe(1_000_000);expect(aduValue(jan.eligibleContributionCents)).toBe(1_000_000);expect(aduValue(jan.reserveCents)).toBe(400_000);expect(aduValue(jan.adu!.earmarkedCashCents)).toBe(400_000);expect(aduValue(jan.adu!.unrestrictedCashCents)).toBe(0);
  expect(aduValue(mar.reserveCents)).toBe(0);expect(aduValue(mar.adu!.earmarkedCashCents)).toBe(0);expect(aduValue(year.eligibleContributionCents)).toBe(12_000_000);expect(report.originalCashFlowCents).toBe(12_000_000);expect(report.aduBudget).toEqual({reportedCashFlowCents:10_800_000,financedConstructionCents:1_200_000,allocationCashFlowCents:12_000_000});expect(aduValue(jan.grossIncomeCents)).toBe(1_000_000);expect(aduValue(year.cashFlowCents)).toBe(-1_200_000);
 });
 it('repairs an earlier owner cash gap before investing later earned cash',()=>{
  const p=fixture();const {financing,...project}=p.properties[0]!.aduProject!;const gap={...p,otherIncome:[{...p.otherIncome[0]!,startDate:'2027-01-01'}],properties:[{...p.properties[0]!,aduProject:project}]};
  const result=calculateProjection(mustValidate(gap),loadRuleSet());expect(aduValue(result.years[0]!.adu!.unrestrictedCashCents)).toBe(-1_200_000);expect(aduValue(result.years[1]!.eligibleContributionCents)).toBe(10_800_000);expect(aduValue(result.years[1]!.adu!.unrestrictedCashCents)).toBe(0);
 });
 it('does not turn positive opening savings into earned allocation capacity',()=>{
  const p=fixture(),result=calculateProjection(mustValidate({...p,openingCashCents:2_000_000}),loadRuleSet());expect(aduValue(result.years[0]!.eligibleContributionCents)).toBe(12_000_000);expect(aduValue(result.years[0]!.adu!.unrestrictedCashCents)).toBe(2_000_000);
 });
});
