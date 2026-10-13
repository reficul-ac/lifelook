import {describe,expect,it} from 'vitest';
import {fireEvent,within} from '@testing-library/dom';
import {calculateProjection,loadRuleSet,type Account,type Issue,type PlanDocument} from '../../src/engine';
import {resolveIssueTargets} from '../../src/browser/issue-presentation';
import {renderProjection} from '../../src/browser/views/projection';
import {loadPlan,restorePlan,type StoragePort} from '../../src/browser/storage';
import {mountWorkspace,setField} from '../helpers/dom';
import {mountPresentation} from '../helpers/presentation';
import {makePlan,mustValidate} from '../helpers/plans';

const broker:Account={id:'equity',name:'Employer equity',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:10000,annualGrowthBps:0,openingIraBasis:{known:false}};
const grant={id:'initial',name:'Initial award',startDate:'2026-01-01',grantValueCents:4800000,grantSharePriceCents:10000,vestingMonths:48,vestingFrequency:'monthly' as const,cliffMonths:0,withholdingBps:2500,taxTreatment:'settle-at-vest' as const,openingHeldShares:0,openingBasis:{known:false as const}};
const rsuAccount:Account={...broker,type:'rsu',openingBalanceCents:0,rsu:{employerId:'employer-equity',currentSharePriceCents:12000,grants:[grant]}};
function investments(plan:PlanDocument=makePlan({accounts:[broker]}),storage?:StoragePort){
  const mounted=mountWorkspace(plan,storage);fireEvent.click(within(mounted.root.querySelector('nav')!).getByRole('button',{name:'Investments'}));return mounted;
}
function accountForm(root:HTMLElement):HTMLElement{return root.querySelector('[data-record-id="equity"]')!;}
function enterGrant(root:HTMLElement,index:number,values:Record<string,string>):void {
  const group=within(root).getByRole('group',{name:`RSU grant ${index}`});
  for(const [label,value] of Object.entries(values))setField(group,label,value);
}
const initialFields={'Grant name':'Initial award','Grant value ($)':'48000.00','Grant share price ($)':'100.00','Vesting start date':'2026-01-01','Vesting term (months)':'48','Shares sold for withholding (%)':'25.00'};

describe('RSU account entry and review',()=>{
  it('initializes RSU fields and hides generic opening balance on account type change',()=>{
    const {root,controller}=investments();setField(accountForm(root),'Account type','rsu');
    const form=accountForm(root);expect(within(form).getByLabelText('Current share price ($)')).toHaveValue('0.00');
    expect(within(form).queryByLabelText('Account opening balance ($)')).toBeNull();
    expect(controller.getState().drafts.equity?.value).toMatchObject({type:'rsu',openingBalanceCents:'0.00',openingIraBasis:{known:false},rsu:{grants:[expect.objectContaining({vestingMonths:'48',vestingFrequency:'monthly',openingBasis:{known:true,value:'0.00'}})]}});
    expect(form).toHaveTextContent('Jan 1, 2026');expect(form).toHaveTextContent('withholding assumption, not a tax rate');
  });
  it('saves independently configured grants together and preserves computed awarded units in a backup',()=>{
    const {root,controller}=investments();setField(accountForm(root),'Account type','rsu');
    let form=accountForm(root);setField(form,'RSU employer ID','employer-equity');setField(form,'Current share price ($)','120.00');
    enterGrant(form,1,initialFields);fireEvent.click(within(form).getByRole('button',{name:'Add RSU grant'}));
    form=accountForm(root);enterGrant(form,2,{'Grant name':'Refresher','Grant value ($)':'24000.00','Grant share price ($)':'120.00','Actual awarded shares (optional)':'199.123456','Vesting start date':'2027-06-30','Vesting term (months)':'24','Vesting frequency':'quarterly','Cliff (months)':'6','Shares sold for withholding (%)':'35.00'});
    expect(within(form).getByRole('group',{name:'RSU grant 1'})).toHaveTextContent('Awarded shares: 480');
    expect(within(form).getByRole('group',{name:'RSU grant 1'})).toHaveTextContent('Final vest date: 2030-01-01');
    expect(within(form).getByRole('group',{name:'RSU grant 1'})).toHaveTextContent('Years left at forecast start: 4.00');
    expect(within(form).getByRole('group',{name:'RSU grant 2'})).toHaveTextContent('Awarded shares: 199.123456');
    expect(controller.getState().savedPlan.revision).toBe(0);fireEvent.click(within(form).getByRole('button',{name:'Save account'}));
    const saved=controller.getState().savedPlan;expect(saved.revision).toBe(1);expect(saved.accounts[0]?.rsu?.grants).toEqual([
      expect.objectContaining({...grant,id:expect.any(String),openingBasis:{known:true,value:0}}),expect.objectContaining({name:'Refresher',grantValueCents:2400000,grantSharePriceCents:12000,awardedShares:199.123456,vestingMonths:24,vestingFrequency:'quarterly',cliffMonths:6,withholdingBps:3500}),
    ]);
    const restored=JSON.parse(controller.exportBackup()) as PlanDocument;controller.resetPlan(restored);expect(controller.getState().savedPlan.accounts).toEqual(saved.accounts);
  });
  it('identifies a malformed grant price without applying the account draft',()=>{
    const {root,controller}=investments(makePlan({accounts:[rsuAccount]}));const form=accountForm(root);
    const input=within(form).getByLabelText('Grant share price ($)');fireEvent.input(input,{target:{value:'1.234'}});fireEvent.click(within(form).getByRole('button',{name:'Save account'}));
    expect(input).toHaveValue('1.234');expect(input).toHaveAttribute('aria-invalid','true');expect(controller.getState().savedPlan.revision).toBe(0);
    expect(controller.getState().issues).toContainEqual(expect.objectContaining({recordId:'equity',field:'rsu.grants.0.grantSharePriceCents'}));
    fireEvent.click(within(form).getByRole('button',{name:'Review Grant share price ($)'}));expect(input).toHaveFocus();
  });
  it('edits, saves, reloads, restores and removes staged share price targets',()=>{
    const values=new Map<string,string>(),storage:StoragePort={getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}};
    let mounted=investments(makePlan({accounts:[rsuAccount]}),storage),form=accountForm(mounted.root);
    setField(form,'Current share price ($)','95.00');setField(form,'Effective annual share price growth (%)','7.70');
    fireEvent.click(within(form).getByRole('button',{name:'Add Share price target'}));form=accountForm(mounted.root);
    const first=within(form).getByRole('group',{name:'Share price target 1'});
    expect(within(first).getByLabelText('Target date')).toHaveValue('2030-01-01');
    setField(first,'Target share price ($)','170.00');
    fireEvent.click(within(form).getByRole('button',{name:'Add Share price target'}));form=accountForm(mounted.root);
    const second=within(form).getByRole('group',{name:'Share price target 2'});
    expect(within(second).getByLabelText('Target date')).toHaveValue('2031-01-01');
    setField(second,'Target date','2032-07-01');setField(second,'Target share price ($)','195.25');
    fireEvent.click(within(form).getByRole('button',{name:'Save account'}));
    expect(mounted.controller.getState().savedPlan.accounts[0]).toMatchObject({annualGrowthBps:770,rsu:{currentSharePriceCents:9500,priceTargets:[{date:'2030-01-01',sharePriceCents:17000},{date:'2032-07-01',sharePriceCents:19525}]}});
    const backup=mounted.controller.exportBackup(),loaded=loadPlan(storage);expect(loaded.status).toBe('loaded');
    if(loaded.status!=='loaded')throw new Error(JSON.stringify(loaded));
    mounted=investments(loaded.plan,storage);form=accountForm(mounted.root);
    expect(within(within(form).getByRole('group',{name:'Share price target 1'})).getByLabelText('Target share price ($)')).toHaveValue('170.00');
    fireEvent.click(within(form).getByRole('button',{name:'Remove Share price target 1'}));
    fireEvent.click(within(accountForm(mounted.root)).getByRole('button',{name:'Save account'}));
    expect(mounted.controller.getState().savedPlan.accounts[0]?.rsu?.priceTargets).toEqual([{date:'2032-07-01',sharePriceCents:19525}]);
    const restored=restorePlan(backup,mounted.controller.getState().savedPlan,storage);expect(restored.accepted).toBe(true);
    mounted.controller.resetPlan(restored.plan);form=accountForm(mounted.root);
    expect(within(within(form).getByRole('group',{name:'Share price target 2'})).getByLabelText('Target date')).toHaveValue('2032-07-01');
    fireEvent.click(within(form).getByRole('button',{name:'Remove Share price target 2'}));
    fireEvent.click(within(accountForm(mounted.root)).getByRole('button',{name:'Remove Share price target 1'}));
    fireEvent.click(within(accountForm(mounted.root)).getByRole('button',{name:'Save account'}));
    expect(mounted.controller.getState().savedPlan.accounts[0]?.rsu?.priceTargets).toEqual([]);
  });
  it('keeps an incomplete target draft and focuses its nested malformed price',()=>{
    const {root,controller}=investments(makePlan({accounts:[rsuAccount]}));
    fireEvent.click(within(accountForm(root)).getByRole('button',{name:'Add Share price target'}));
    let form=accountForm(root);fireEvent.click(within(form).getByRole('button',{name:'Save account'}));
    expect(controller.getState().savedPlan.revision).toBe(0);
    expect(controller.getState().issues).toContainEqual(expect.objectContaining({recordId:'equity',field:'rsu.priceTargets[0].sharePriceCents'}));
    const row=within(form).getByRole('group',{name:'Share price target 1'}),input=within(row).getByLabelText('Target share price ($)');
    fireEvent.input(input,{target:{value:'1.234'}});fireEvent.click(within(form).getByRole('button',{name:'Save account'}));
    form=accountForm(root);expect(input).toHaveValue('1.234');expect(input).toHaveAttribute('aria-invalid','true');
    expect(controller.getState().savedPlan.revision).toBe(0);
    expect(controller.getState().issues).toContainEqual(expect.objectContaining({recordId:'equity',field:'rsu.priceTargets.0.sharePriceCents'}));
    fireEvent.click(within(form).getByRole('button',{name:'Review Target share price ($)'}));expect(input).toHaveFocus();
  });
  it('focuses a target date that is not later than the previous target',()=>{
    const account:Account={...rsuAccount,rsu:{...rsuAccount.rsu!,priceTargets:[{date:'2030-01-01',sharePriceCents:17000}]}};
    const {root,controller}=investments(makePlan({accounts:[account]}));
    fireEvent.click(within(accountForm(root)).getByRole('button',{name:'Add Share price target'}));
    const form=accountForm(root),row=within(form).getByRole('group',{name:'Share price target 2'}),input=within(row).getByLabelText('Target date');
    setField(row,'Target date','2030-01-01');setField(row,'Target share price ($)','180.00');
    fireEvent.click(within(form).getByRole('button',{name:'Save account'}));
    expect(controller.getState().savedPlan.revision).toBe(0);expect(input).toHaveAttribute('aria-invalid','true');
    expect(controller.getState().issues).toContainEqual(expect.objectContaining({recordId:'equity',field:'rsu.priceTargets[1].date'}));
    fireEvent.click(within(form).getByRole('button',{name:'Review Target date'}));expect(input).toHaveFocus();
  });
  it('excludes RSU accounts from contribution choices and rejects changing a linked account to RSU',()=>{
    const linked=makePlan({accounts:[broker],contributions:[{id:'deposit',accountId:'equity',priority:1,startDate:'2026-01-01',amount:{kind:'fixed',monthlyCents:10000}}]});
    let mounted=investments(linked);setField(accountForm(mounted.root),'Account type','rsu');let form=accountForm(mounted.root);
    setField(form,'RSU employer ID','employer-equity');setField(form,'Current share price ($)','120.00');enterGrant(form,1,initialFields);fireEvent.click(within(form).getByRole('button',{name:'Save account'}));
    expect(mounted.controller.getState().savedPlan.accounts[0]?.type).toBe('taxable-brokerage');expect(mounted.controller.getState().issues.some(issue=>issue.recordId==='deposit'&&issue.field==='accountId')).toBe(true);
    mounted=investments(makePlan({accounts:[rsuAccount,{...broker,id:'cash-account',name:'Cash brokerage'}]}));fireEvent.click(within(mounted.root).getByRole('button',{name:'Add contribution'}));
    expect(within(mounted.root).getByLabelText('Contribution account')).toHaveValue('cash-account');expect(within(mounted.root).queryByRole('option',{name:'Employer equity'})).toBeNull();
  });
  it('allocates grant IDs across saved records and all unsaved drafts',()=>{
    const plan=makePlan({accounts:[broker,{...broker,id:'equity-grant-1',name:'Collision'}]});const {root,controller}=investments(plan);
    controller.beginAdd('accounts',{...broker,id:'draft-collision',rsu:{grants:[{...grant,id:'equity-grant-2'}]}});
    setField(accountForm(root),'Account type','rsu');fireEvent.click(within(accountForm(root)).getByRole('button',{name:'Add RSU grant'}));
    const grants=(controller.getState().drafts.equity?.value.rsu as {grants:{id:string}[]}).grants;
    expect(grants.map(g=>g.id)).toEqual(['equity-grant-3','equity-grant-4']);
  });
  it('routes saved and draft grant issues to the parent account and exact nested field',()=>{
    const plan=makePlan({accounts:[rsuAccount]}),issue:Issue={code:'required-history',recordId:'initial',field:'openingBasis',severity:'warning',explanation:'Basis missing',resolution:'Review basis'};
    expect(resolveIssueTargets(issue,{savedPlan:plan,drafts:{}})).toEqual([expect.objectContaining({section:'Investments',recordId:'equity',field:'rsu.grants.0.openingBasis',label:'Review Initial award'})]);
    expect(resolveIssueTargets({...issue,recordId:'draft-grant',field:'grantSharePriceCents'},{savedPlan:plan,drafts:{equity:{section:'accounts',recordId:'equity',value:{...broker,rsu:{grants:[{...grant,id:'draft-grant'}]}}}}})[0]).toMatchObject({section:'Investments',recordId:'equity',field:'rsu.grants.0.grantSharePriceCents'});
    expect(resolveIssueTargets({...issue,recordId:'equity',field:'rsu.grants[0].openingBasis'},{savedPlan:plan,drafts:{}})[0]?.field).toBe('rsu.grants.0.openingBasis');
    expect(resolveIssueTargets({...issue,field:'rsu.grants[0]'},{savedPlan:plan,drafts:{}})[0]?.field).toBe('rsu.grants.0');
  });
});

describe('RSU annual and monthly asset explanations',()=>{
  it('keeps independent grant schedules readable when the aggregate is unavailable',()=>{
    const plan=makePlan({accounts:[rsuAccount]}),base=calculateProjection(mustValidate(makePlan()),loadRuleSet());
    const issue:Issue={code:'monetary-overflow',recordId:'equity',field:'rsu',year:2026,severity:'error',explanation:'Total exceeds the supported range',resolution:'Review account assumptions'};
    const result={...base,years:base.years.map(row=>({...row,rsu:{status:'needs-data' as const,issues:[issue]}})),rsuSchedules:[{accountId:'equity',year:2026,schedule:{status:'available' as const,value:[{accountId:'equity',grantId:'initial',year:2026,month:1,openingValueCents:0,growthCents:0,vestedShares:10,withheldShares:2.5,heldShares:7.5,unvestedShares:470,unsettledShares:0,vestedValueCents:120000,taxableIncomeCents:120000,withholdingCents:30000,closingValueCents:90000,unvestedValueCents:5640000,basis:{known:true as const,value:90000}}]}}]};
    const {root,context}=mountPresentation(plan);renderProjection(root,result,context);expect(within(root).getByTestId('independent-2026-01-rsu-initial-taxable-income')).toHaveTextContent('$1,200.00');
  });
  it('shows independent grant quantities and raw monetary amounts with vesting terminology',()=>{
    const plan=makePlan({accounts:[rsuAccount]}),base=calculateProjection(mustValidate(makePlan()),loadRuleSet()),period={taxableIncomeCents:120000,withholdingCents:30000,unvestedValueCents:5640000,grants:[{accountId:'equity',grantId:'initial',year:2026,month:12,openingValueCents:0,growthCents:0,vestedShares:10,withheldShares:2.5,heldShares:7.5,unvestedShares:470,unsettledShares:0,vestedValueCents:120000,taxableIncomeCents:120000,withholdingCents:30000,closingValueCents:90000,unvestedValueCents:5640000,basis:{known:false as const}}]};
    const accounts=[{accountId:'equity',openingCents:{status:'available' as const,value:0},contributionCents:{status:'available' as const,value:0},growthCents:{status:'available' as const,value:0},closingCents:{status:'available' as const,value:90000}}];
    const result={...base,years:base.years.map(row=>({...row,accounts,rsu:{status:'available' as const,value:period}})),months:base.months.map(row=>({...row,accounts,rsu:{status:'available' as const,value:period}}))};
    const {root,context}=mountPresentation(plan);renderProjection(root,result,context);const annual=within(root).getByTestId('annual-2026-rsu-initial-taxable-income');expect(annual).toHaveTextContent('$1,200.00');
    const grantRow=annual.parentElement!;expect(grantRow).toHaveTextContent('7.5');expect(grantRow).toHaveTextContent('470');expect(grantRow).toHaveTextContent('Unknown');expect(grantRow).toHaveTextContent('$900.00');
    expect(within(root).queryByText('Eligible deposit')).toBeNull();expect(root).toHaveTextContent('Withholding funding');expect(root).toHaveTextContent('Unvested value is excluded from held assets');
    fireEvent.click(within(root).getByRole('button',{name:'Show months for 2026'}));expect(within(root).getByTestId('monthly-2026-01-rsu-initial-taxable-income')).toHaveTextContent('$1,200.00');
  });
});
