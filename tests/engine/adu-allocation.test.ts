import {describe,expect,it} from 'vitest';
import {allocateAduSharedExpense} from '../../src/engine/property/adu-allocation';
import {loanRentalShares} from '../../src/engine/property/allocation';
import type {Expense} from '../../src/engine/model/plan';
import {aduValue,makeAduPlan} from '../helpers/adu';
import {makeEstimatedMortgagePlan} from '../helpers/estimated-mortgage';
const plan=makeAduPlan(),unit={...plan.rentals[0]!,availableDate:'2027-07-16',rentStartDate:'2027-09-01'};
const expense:Expense={id:'original-expense',name:'Original cost',propertyId:'home',amountCents:9300,frequency:'monthly',startDate:'2026-01-01',annualGrowthBps:0,use:'personal',taxCategory:'operating'};
const property={...plan.properties[0]!,primaryArea:1600,aduProject:{...plan.properties[0]!.aduProject!,sharedExpenseOverrides:[{id:'prospective',expenseId:expense.id}]}};
describe('prospective monthly shared expense allocations',()=>{
  it('conserves July paid cents using readiness days and leaves prior months personal',()=>{
    const before=JSON.stringify(expense);const rows=aduValue(allocateAduSharedExpense(expense,property,unit,Array(12).fill(9300),2027));expect(rows).toHaveLength(12);expect(rows[5]).toEqual({personalCents:9300,rentalCentsByUnit:{'new-adu':0}});expect(rows[6]).toEqual({personalCents:7700,rentalCentsByUnit:{'new-adu':1600}});expect(rows[7]).toEqual({personalCents:6200,rentalCentsByUnit:{'new-adu':3100}});expect(rows.every(r=>r.personalCents+r.rentalCentsByUnit['new-adu']! ===9300)).toBe(true);expect(JSON.stringify(expense)).toBe(before);
  });
  it('does not share an original expense without an explicitly selected override',()=>{const p={...property,aduProject:{...property.aduProject,sharedExpenseOverrides:[]}};expect(aduValue(allocateAduSharedExpense(expense,p,unit,Array(12).fill(9300),2027))[8]).toEqual({personalCents:9300,rentalCentsByUnit:{'new-adu':0}});});
  it('keeps missing primary area local to a selected default share and honors an explicit third',()=>{
    const {primaryArea,...p}=property;expect(allocateAduSharedExpense(expense,p,unit,Array(12).fill(9300),2027).status).toBe('needs-data');const explicit={...p,aduProject:{...p.aduProject,sharedExpenseOverrides:[{id:'prospective',expenseId:expense.id,share:{numerator:1,denominator:3}}]}};expect(aduValue(allocateAduSharedExpense(expense,explicit,unit,Array(12).fill(9300),2027))[6]).toEqual({personalCents:7700,rentalCentsByUnit:{'new-adu':1600}});
    expect(allocateAduSharedExpense(expense,p,unit,Array(12).fill(9300),2026).status).toBe('available');expect(allocateAduSharedExpense({...expense,id:'unselected'},p,unit,Array(12).fill(9300),2027).status).toBe('available');
  });
  it('retains direct rental expense ownership before readiness rather than routing it to the personal home',()=>{expect(aduValue(allocateAduSharedExpense({...expense,use:'rental',rentalId:unit.id},property,unit,Array(12).fill(9300),2026))[0]).toEqual({personalCents:0,rentalCentsByUnit:{'new-adu':9300}});});
  it('resolves the traced personal mortgage without consulting missing areas',()=>{const {primaryArea,...p}=property;const loan=makeEstimatedMortgagePlan().properties[0]!.loans[0]!;expect(loanRentalShares(loan,p,[unit])[unit.id]!.toNumber()).toBe(0);});
});
