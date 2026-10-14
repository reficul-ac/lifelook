import {calendarDate,daysInMonth} from '../dates';
import {CalculationRangeError,Decimal} from '../money';
import type {Cents,Expense,Property,RentalUnit} from '../model/plan';
import type {Available} from '../model/results';
import {allocateExpense,allocateShares} from './allocation';
import type {ExpenseAllocation} from './allocation';
/** Original rows remain personal until their selected prospective share is active. */
export function allocateAduSharedExpense(expense:Expense,property:Property,unit:RentalUnit,paidByMonth:readonly Cents[],year:number):Available<readonly ExpenseAllocation[]> {
  if(paidByMonth.length!==12)throw new RangeError('Monthly expense allocation requires twelve payments.');
  const project=property.aduProject;
  if(!project)return {status:'available',value:paidByMonth.map(paid=>allocateExpense(expense,property,[unit],paid))};
  const selected=project.sharedExpenseOverrides.find(row=>row.expenseId===expense.id);
  try{
    const allocations=paidByMonth.map((paid,index)=>{
      if(expense.use==='rental'&&expense.rentalId===unit.id)return allocateShares(paid,{[unit.id]:new Decimal(1)});
      const month=index+1,end=calendarDate(year,month,31),start=calendarDate(year,month,1);
      if(!selected||paid===0||end<unit.availableDate)return allocateShares(paid,{[unit.id]:new Decimal(0)});
      let share:Decimal;
      if(selected.share)share=new Decimal(selected.share.numerator).div(selected.share.denominator);
      else{
        if(!property.primaryArea||property.primaryArea<=0||!property.aduArea||property.aduArea<=0)throw new RangeError('A selected default share requires both primary and ADU living areas.');
        share=new Decimal(property.aduArea).div(new Decimal(property.primaryArea).plus(property.aduArea));
      }
      const days=daysInMonth(year,month),active=unit.availableDate<=start?days:days-Number(unit.availableDate.slice(8,10))+1;
      return allocateShares(paid,{[unit.id]:share.times(active).div(days)});
    });
    return {status:'available',value:allocations};
  }catch(error){
    if(!(error instanceof RangeError))throw error;
    return {status:'needs-data',issues:[{code:error instanceof CalculationRangeError?'monetary-overflow':'required-adu-expense-share',recordId:selected?.id??expense.id,year,field:selected?'share':'allocationOverride',severity:'warning',explanation:error.message,resolution:'Enter primary living area or an explicit prospective share for this expense.'}]};
  }
}
