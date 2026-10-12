import {expect,it} from 'vitest';
import {within} from '@testing-library/dom';
import {calculateProjection,loadRuleSet} from '../../src/engine';
import {renderProjection} from '../../src/browser/views/projection';
import {mountPresentation} from '../helpers/presentation';
import {makePlan,mustValidate} from '../helpers/plans';

it('shows unavailable RSU paper value alongside known compensation and held value',()=>{
  const plan=makePlan({openingCashCents:10000,accounts:[{id:'equity',name:'Equity',ownerId:'owner-a',type:'rsu',openingBalanceCents:0,annualGrowthBps:0,openingIraBasis:{known:false},rsu:{employerId:'employer',currentSharePriceCents:2,grants:[{id:'grant',name:'Grant',startDate:'2026-01-01',grantValueCents:60000000000000,grantSharePriceCents:1,vestingMonths:48,vestingFrequency:'annual',cliffMonths:48,withholdingBps:0,taxTreatment:'settle-at-vest',openingHeldShares:0,openingBasis:{known:true,value:0}}]}}]});
  const result=calculateProjection(mustValidate(plan),loadRuleSet());
  const {root,context}=mountPresentation(plan);renderProjection(root,result,context);
  expect(within(root).getByTestId('annual-2026-gross-income')).toHaveTextContent('$0.00');
  expect(within(root).getByTestId('independent-2026-01-rsu-grant-unvested-value')).toHaveTextContent('Unsupported');
  expect(within(root).getByTestId('independent-2026-01-rsu-grant-taxable-income')).toHaveTextContent('$0.00');
  expect(within(root).getByTestId('annual-2026-account-equity-closing')).toHaveTextContent('$0.00');
});
