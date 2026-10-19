import {afterEach,describe,expect,it} from 'vitest';
import {calculateProjection,loadRuleSet} from '../../src/engine';
import {renderProjection} from '../../src/browser/views/projection';
import {appendCoverage} from '../../src/browser/views/issues';
import {makePlan,mustValidate} from '../helpers/plans';
import {mountPresentation} from '../helpers/presentation';

afterEach(()=>document.body.replaceChildren());
describe('future property purchase reporting',()=>{
 it('identifies down-payment sales and purchase value instead of labeling them as ADU construction',()=>{
  const plan=makePlan({horizonYears:2,accounts:[{id:'brokerage',name:'Home savings',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:20_000_000,annualGrowthBps:0,openingIraBasis:{known:true,value:0},openingTaxableBasis:{known:true,value:20_000_000}}],properties:[{id:'future-home',name:'Future home',role:'primary',purchaseDate:'2027-06-15',purchasePriceCents:10_000_000,downPaymentCents:10_000_000,openingValueCents:10_000_000,appreciationBps:0,appreciationOverrides:[],loans:[],purchaseFunding:{kind:'taxable-brokerage',accountId:'brokerage'}}]});
  const result=calculateProjection(mustValidate(plan),loadRuleSet()),{root,context}=mountPresentation(plan);
  renderProjection(root,result,context);
  expect(root).toHaveTextContent('Property investment funding · forecast total');
  expect(root).toHaveTextContent('Down payment covered by investments');
  expect(root).toHaveTextContent('Purchase value added');
  expect(root).toHaveTextContent('Property down payment');
  expect(root).toHaveTextContent('Household tax estimate');
  expect(root).not.toHaveTextContent('ADU investment funding');
  expect(root).not.toHaveTextContent('Investments sold for ADU construction');
  expect(root.querySelector('[data-testid="annual-2027-brokerage-gross-sales"]')).toHaveTextContent('$100,000.00');
  expect(root.querySelector('[data-testid="annual-2027-property-future-home-purchase-value"]')).toHaveTextContent('$100,000.00');
 });
 it('labels purchase planning tax assumptions as an estimate while preserving unrelated missing facts',()=>{
  const root=document.createElement('div');
  appendCoverage(root,{completeForModeledScope:true,completeHouseholdLiability:false,issues:[{code:'property-purchase-estimate',severity:'info',explanation:'Purchase tax assumptions',resolution:'Review'}]});
  expect(root).toHaveTextContent('Household tax estimate');
  expect(root).not.toHaveTextContent('Household tax incomplete');
 });
});
