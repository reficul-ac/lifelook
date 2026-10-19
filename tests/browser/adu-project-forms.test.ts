import {afterEach,describe,expect,it} from 'vitest';
import {fireEvent,getByRole,getByLabelText,queryByLabelText,within} from '@testing-library/dom';
import {mountWorkspace,setField} from '../helpers/dom';
import {makeAduPlan,makeAduTreatments} from '../helpers/adu';
import {makeAllocationPolicy} from '../helpers/allocations';
import {unmountApp} from '../../src/browser/main';
function home(){const p=makeAduPlan(),{aduProject,...property}=p.properties[0]!;return{...p,properties:[{...property,role:'primary' as const,openingValueCents:50_000_000}],rentals:[]};}
afterEach(()=>{for(const node of document.querySelectorAll<HTMLElement>('.workspace'))unmountApp(node);document.body.replaceChildren();});
function expand(root:HTMLElement){for(const detail of root.querySelectorAll<HTMLDetailsElement>('form[data-record-id="home"] details'))detail.open=true;}
function open(expanded=true){const mounted=mountWorkspace(home());fireEvent.click(getByRole(mounted.root,'button',{name:'Properties'}));fireEvent.click(getByRole(mounted.root,'button',{name:'Build an ADU'}));if(expanded)expand(mounted.root);return mounted;}
function basicInputs(root:HTMLElement,completion='2027-06-15'){
 for(const [label,value] of [['ADU living area (sq ft)','800'],['Total ADU build cost ($)','300000.00'],['Construction completion date',completion],['Monthly rent receipts ($)','3000.00'],['Assumed completion value added ($)','220000.00']])setField(root,label!,value!);
}
describe('native ADU project forms',()=>{
 it('starts a new ADU with six visible setup inputs and collapsed detailed controls',()=>{
  const {root}=mountWorkspace(home());fireEvent.click(getByRole(root,'button',{name:'Properties'}));fireEvent.click(getByRole(root,'button',{name:'Build an ADU'}));
  const setup=getByRole(root,'group',{name:'ADU setup'});
  for(const label of ['ADU living area (sq ft)','Total ADU build cost ($)','Construction completion date','Monthly rent receipts ($)','Assumed completion value added ($)','ADU funding'])expect(getByLabelText(setup,label)).toBeVisible();
  expect(getByLabelText(setup,'ADU funding')).toHaveValue('cash');expect(getByLabelText(setup,'Assumed completion value added ($)')).toHaveValue('');
  for(const title of ['Advanced ADU details','Existing home details']){
   const summary=[...root.querySelectorAll('summary')].find(node=>node.textContent===title);expect(summary).toBeDefined();expect((summary!.parentElement as HTMLDetailsElement).open).toBe(false);
  }
  const paths=[...root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input[name],select[name]')].map(control=>control.name);expect(new Set(paths).size).toBe(paths.length);
 });
 it('copies the current home rate from setup and keeps added value linked to ADU size',()=>{
  const {root,controller}=open(false);setField(root,'ADU living area (sq ft)','800');setField(root,'Total ADU build cost ($)','bad');
  const before=(controller.getDraft('properties','home').value.property as any).aduProject;
  expect(getByRole(root,'button',{name:'Use current home value per sq ft'})).toBeVisible();fireEvent.click(getByRole(root,'button',{name:'Use current home value per sq ft'}));
  const setup=getByRole(root,'group',{name:'ADU setup'});expect(setup).toHaveTextContent('$277.78');expect(setup).toHaveTextContent('$222,224.00');
  setField(root,'ADU living area (sq ft)','1000');expect(getByRole(root,'group',{name:'ADU setup'})).toHaveTextContent('$277,780.00');
  const project=(controller.getDraft('properties','home').value.property as any).aduProject;expect(project.valuation).toEqual({kind:'adu-value-per-square-foot',valuePerSquareFootCents:'277.78'});expect(project.costs).toEqual(before.costs);expect(project.propertyTax).toEqual(before.propertyTax);
  const advanced=[...root.querySelectorAll('summary')].find(node=>node.textContent==='Advanced ADU details')!.parentElement as HTMLDetailsElement;expect(advanced.open).toBe(false);
 });
 it('asks for the home area before offering its current value per square foot',()=>{
  const source=home(),{primaryArea,...property}=source.properties[0]!,{root}=mountWorkspace({...source,properties:[property]});fireEvent.click(getByRole(root,'button',{name:'Properties'}));fireEvent.click(getByRole(root,'button',{name:'Build an ADU'}));
  const setup=getByRole(root,'group',{name:'ADU setup'});expect(getByRole(setup,'button',{name:'Use current home value per sq ft'})).toBeDisabled();expect(setup).toHaveTextContent(/enter.*primary home living area/i);expect(getByLabelText(setup,'Primary home living area (sq ft)')).toBeVisible();expect(root.querySelectorAll('[name="property.primaryArea"]')).toHaveLength(1);
  setField(root,'Primary home living area (sq ft)','0');expect(getByRole(root,'button',{name:'Use current home value per sq ft'})).toBeDisabled();setField(root,'Primary home living area (sq ft)','1800');expect(getByRole(root,'button',{name:'Use current home value per sq ft'})).toBeEnabled();expect(root.querySelectorAll('[name="property.primaryArea"]')).toHaveLength(1);
 });
 it('saves a twenty-year estimated forecast from setup while keeping entered tax details unknown',()=>{
  const {root,controller}=mountWorkspace({...home(),horizonYears:20,cashFlowAllocation:makeAllocationPolicy()});fireEvent.click(getByRole(root,'button',{name:'Properties'}));fireEvent.click(getByRole(root,'button',{name:'Build an ADU'}));basicInputs(root);fireEvent.click(getByRole(root,'button',{name:'Save property'}));
  const state=controller.getState(),project=state.savedPlan.properties[0]!.aduProject!;
  expect(state.issues).toEqual([]);expect(state.savedPlan.revision).toBe(1);expect(state.drafts.home).toBeUndefined();
  expect(project).toMatchObject({completionDate:'2027-06-15',costs:[{paymentDate:'2027-06-15',amountCents:30_000_000,treatments:{federal:{known:false}}}],valuation:{kind:'value-added',valueAddedCents:22_000_000},taxQualifications:{federal:{known:false}}});expect(project.financing).toBeUndefined();
  expect(state.savedPlan.rentals[0]).toMatchObject({availableDate:'2027-07-01',rentStartDate:'2027-07-01',monthlyRentCents:300_000});expect(state.projection.years).toHaveLength(20);
  for(const year of state.projection.years){for(const field of ['totalTaxCents','expensesCents','cashFlowCents','netWorthCents'] as const)expect(year[field].status).toBe('available');expect(year.adu!.unrestrictedCashCents.status).toBe('available');expect(year.fundingStatus).not.toBe('unavailable');}
  expect(getByRole(root,'group',{name:'ADU setup'})).toHaveTextContent(/planning tax estimates/i);
 },15_000);
 it('creates one attributed loan draw from the conditional setup inputs',()=>{
  const {root,controller}=open(false);basicInputs(root,'2026-12-31');expect(queryByLabelText(root,'ADU loan amount ($)')).toBeNull();setField(root,'ADU funding','loan');
  for(const label of ['ADU loan amount ($)','ADU financing APR (%)','ADU financing term (months)'])expect(getByLabelText(root,label)).toBeVisible();
  setField(root,'ADU loan amount ($)','200000.00');setField(root,'ADU financing APR (%)','6.00');setField(root,'ADU financing term (months)','360');fireEvent.click(getByRole(root,'button',{name:'Save property'}));
  const state=controller.getState(),project=state.savedPlan.properties[0]!.aduProject!,loan=project.financing!;
  expect(state.issues).toEqual([]);expect(state.savedPlan.revision).toBe(1);expect(loan).toMatchObject({aprBps:600,termMonths:360,firstAmortizingPaymentMonth:'2027-01',proceedsHistoryComplete:{known:false},rentalInterestQualified:{known:false},financingAtRiskQualification:{known:false}});
  expect(loan.draws).toHaveLength(1);expect(loan.draws[0]).toMatchObject({month:'2026-12',amountCents:20_000_000,costAllocations:[{costId:project.costs[0]!.id,amountCents:20_000_000}]});expect(state.projection.months[11]!.adu!.financingProceedsCents).toEqual({status:'available',value:20_000_000});
  for(const year of state.projection.years){expect(year.totalTaxCents.status).toBe('available');expect(year.cashFlowCents.status).toBe('available');expect(year.netWorthCents.status).toBe('available');}
 });
 it('offers detailed tax calculation without replacing unknown entered answers',()=>{
  const {root,controller}=open(false);basicInputs(root);expand(root);setField(root,'ADU tax calculation','detailed');fireEvent.click(getByRole(root,'button',{name:'Save property'}));
  const state=controller.getState(),project=state.savedPlan.properties[0]!.aduProject!;expect(state.issues).toEqual([]);expect(project.taxEstimation).toEqual({mode:'detailed'});expect(project.taxQualifications.federal).toEqual({known:false});expect(project.costs[0]!.treatments.federal).toEqual({known:false});expect(state.projection.years[1]!.totalTaxCents.status).toBe('needs-data');
 });
 it('keeps a confirmed unsupported qualification instead of estimating it away',()=>{
  const {root,controller}=open(false);basicInputs(root);expand(root);setField(root,'Federal ordinary project tax treatment qualified','false');fireEvent.click(getByRole(root,'button',{name:'Save property'}));
  const state=controller.getState();expect(state.issues).toEqual([]);expect(state.savedPlan.properties[0]!.aduProject!.taxQualifications.federal).toEqual({known:true,value:false});expect(state.projection.years[1]!.totalTaxCents.status).toBe('unsupported-case');
 });
 it('stores the planning property-tax rate and retains invalid rate feedback',()=>{
  const {root,controller}=open(false);basicInputs(root);expand(root);expect(getByLabelText(root,'ADU tax calculation')).toHaveValue('simple');expect(getByLabelText(root,'Estimated ADU property-tax rate (%)')).toHaveValue('1.20');expect(getByLabelText(root,'Estimated ADU property-tax rate (%)')).toBeEnabled();setField(root,'Estimated ADU property-tax rate (%)','1.50');fireEvent.click(getByRole(root,'button',{name:'Save property'}));
  expect(controller.getState().issues).toEqual([]);expect(controller.getState().savedPlan.properties[0]!.aduProject!.taxEstimation).toEqual({mode:'simple',propertyTaxRateBps:150});
  setField(root,'Estimated ADU property-tax rate (%)','bad');fireEvent.click(getByRole(root,'button',{name:'Save property'}));expect(getByLabelText(root,'Estimated ADU property-tax rate (%)')).toHaveValue('bad');expect(getByLabelText(root,'Estimated ADU property-tax rate (%)')).toHaveAttribute('aria-invalid','true');expect(controller.getState().savedPlan.revision).toBe(1);
 });
 it('shows the confirmed property-tax rate and explains why its planning default is disabled',()=>{
  const {root,controller}=open(false);basicInputs(root);expand(root);setField(root,'Marginal property-tax rate (%) history','known');setField(root,'Marginal property-tax rate (%) value','1.50');
  expect(getByRole(root,'group',{name:'ADU setup'})).toHaveTextContent(/estimated 1\.5% added property tax/i);
  const fallback=getByLabelText(root,'Estimated ADU property-tax rate (%)');expect(fallback).toHaveValue('1.20');expect(fallback).toBeDisabled();expect(fallback.closest('fieldset')).toHaveTextContent(/confirmed.*rate.*overrides.*planning default/i);expect(fallback.closest('fieldset')).toHaveTextContent('Marginal property-tax rate (%)');
  fireEvent.click(getByRole(root,'button',{name:'Save property'}));const state=controller.getState(),project=state.savedPlan.properties[0]!.aduProject!;expect(state.issues).toEqual([]);expect(project.taxEstimation).toEqual({mode:'simple',propertyTaxRateBps:120});expect(project.propertyTax.marginalRateBps).toEqual({known:true,value:150});expect(state.projection.years[2]!.adu!.projectTaxPaidCents).toEqual({status:'available',value:450_000});
  setField(root,'Marginal property-tax rate (%) history','unknown');expect(getByLabelText(root,'Estimated ADU property-tax rate (%)')).toBeEnabled();expect(getByRole(root,'group',{name:'ADU setup'})).toHaveTextContent(/estimated 1\.2% added property tax/i);
 });
 it('keeps generated payment and rent dates linked after clearing and replacing completion',()=>{
  const {root,controller}=open(false);basicInputs(root);setField(root,'Construction completion date','');setField(root,'Construction completion date','2028-02-20');fireEvent.click(getByRole(root,'button',{name:'Save property'}));
  const state=controller.getState();expect(state.issues).toEqual([]);expect(state.savedPlan.revision).toBe(1);expect(state.savedPlan.properties[0]!.aduProject!.costs[0]!.paymentDate).toBe('2028-02-20');expect(state.savedPlan.rentals[0]).toMatchObject({availableDate:'2028-03-01',rentStartDate:'2028-03-01'});
 });
 it('starts with a blank rate when selected and copies the explicitly rounded whole-property reference',()=>{const {root,controller}=open();setField(root,'Completion value assumption','adu-value-per-square-foot');expect(getByLabelText(root,'Assumed added value per ADU sq ft ($)')).toHaveValue('');setField(root,'ADU living area (sq ft)','800');fireEvent.click(getByRole(root,'button',{name:'Use this rate as an assumption'}));expect(getByLabelText(root,'Assumed added value per ADU sq ft ($)')).toHaveValue('277.78');expect(root.querySelector('[data-testid="adu-draft-value-added"]')).toHaveTextContent('$222,224.00');expect(controller.getState().savedPlan.properties[0]).not.toHaveProperty('aduProject');});
 it('keeps valuation independent of an invalid construction cost and supports direct value',()=>{const {root}=open();setField(root,'Completion value assumption','adu-value-per-square-foot');setField(root,'ADU living area (sq ft)','800');setField(root,'Assumed added value per ADU sq ft ($)','275.00');setField(root,'Total ADU build cost ($)','bad');expect(root.querySelector('[data-testid="adu-draft-value-added"]')).toHaveTextContent('$220,000.00');setField(root,'Completion value assumption','value-added');setField(root,'Assumed completion value added ($)','230000.00');expect(root.querySelector('[data-testid="adu-draft-value-added"]')).toHaveTextContent('$230,000.00');});
 it('holds project ownership and shows areas once without existing-history controls',()=>{const {root}=open();expect(getByLabelText(root,'Property role')).toBeDisabled();expect(root.querySelectorAll('[aria-label="ADU living area (sq ft)"]')).toHaveLength(1);expect(queryByLabelText(root,'Shared-cost allocation')).toBeNull();expect(root.querySelector('input[name$="recoveryBasisCents"]')).toBeNull();expect(within(root).queryByRole('button',{name:'Add QBI loss vintage',hidden:true})).toBeNull();expect(root).toHaveTextContent('Combined home and ADU living area');});
 it('previews vacancy-adjusted rent and exposes readiness separately from completion',()=>{const {root}=open();setField(root,'Monthly rent receipts ($)','3000.00');setField(root,'Vacancy allowance (%)','10.00');expect(root.querySelector('[data-testid="adu-draft-collected-rent"]')).toHaveTextContent('$2,700.00');expect(getByLabelText(root,'Construction completion date')).toBeInTheDocument();expect(getByLabelText(root,'Available for rent date')).toBeInTheDocument();expect(getByLabelText(root,'Lease income start date')).toBeInTheDocument();});
 it('creates recursively unique financing and stage IDs and editable draw attribution',()=>{const {root,controller}=open();setField(root,'ADU funding','loan');expand(root);fireEvent.click(getByRole(root,'button',{name:'Add cost stage'}));expand(root);fireEvent.click(getByRole(root,'button',{name:'Add financing draw'}));expect(within(root).getAllByLabelText('Draw amount ($)')).toHaveLength(2);expect(within(root).getAllByLabelText('Funded cost stage')).toHaveLength(2);const raw=controller.getDraft('properties','home').value,ids:string[]=[];function visit(v:any){if(v&&typeof v==='object'){if(v.id)ids.push(v.id);Object.values(v).forEach(visit);}}visit(raw);expect(new Set(ids).size).toBe(ids.length);});
 it('preserves multiple construction stages and loan draws during basic edits',()=>{
  const source=makeAduPlan(),first=source.properties[0]!.aduProject!.costs[0]!;
  const plan=makeAduPlan({}, {costs:[{...first,amountCents:18_000_000,paymentDate:'2027-06-01',treatments:makeAduTreatments(18_000_000)},{...first,id:'second-stage',amountCents:12_000_000,paymentDate:'2027-07-01',treatments:makeAduTreatments(12_000_000)}],financing:{id:'dedicated-loan',name:'Dedicated loan',aprBps:0,termMonths:120,firstAmortizingPaymentMonth:'2027-08',collateralPropertyId:'home',draws:[{id:'first-draw',month:'2027-05',amountCents:10_000_000,costAllocations:[{costId:first.id,amountCents:10_000_000}]},{id:'second-draw',month:'2027-06',amountCents:5_000_000,costAllocations:[{costId:'second-stage',amountCents:5_000_000}]}],interestTaxRows:[],proceedsHistoryComplete:{known:false},rentalInterestQualified:{known:false},financingAtRiskQualification:{known:false}}});
  const {root,controller}=mountWorkspace(plan);fireEvent.click(getByRole(root,'button',{name:'Properties'}));
  const setup=getByRole(root,'group',{name:'ADU setup'});expect(setup).toHaveTextContent('Total ADU build cost: $300,000.00');expect(setup).toHaveTextContent(/loan amount: \$150,000\.00/i);expect(queryByLabelText(setup,'Total ADU build cost ($)')).toBeNull();expect(queryByLabelText(setup,'ADU loan amount ($)')).toBeNull();
  setField(root,'ADU living area (sq ft)','900');setField(root,'Monthly rent receipts ($)','3200.00');fireEvent.click(getByRole(root,'button',{name:'Save property'}));
  const state=controller.getState(),project=state.savedPlan.properties[0]!.aduProject!;expect(state.issues).toEqual([]);expect(state.savedPlan.revision).toBe(1);expect(project.costs).toEqual(plan.properties[0]!.aduProject!.costs);expect(project.financing).toEqual(plan.properties[0]!.aduProject!.financing);expect(project.valuation).toEqual(plan.properties[0]!.aduProject!.valuation);expect(state.savedPlan.rentals[0]!.monthlyRentCents).toBe(320_000);
 });
 it('explicitly copies an assessed estimate to a regular planned payment with unknown tax treatments',()=>{const {root,controller}=mountWorkspace(makeAduPlan());fireEvent.click(getByRole(root,'button',{name:'Properties'}));expand(root);fireEvent.click(getByRole(root,'button',{name:'Plan estimated regular payment for 2028'}));const tax=(controller.getDraft('properties','home').value.property as any).aduProject.propertyTax;expect(tax.paymentYears.find((y:any)=>y.year==='2028').payments[0]).toMatchObject({kind:'regular',month:'2028-12',amountCents:'2640.00',treatments:{federal:{known:false}}});expect(controller.getState().savedPlan.properties[0]!.aduProject!.propertyTax.paymentYears[2]!.payments).toEqual([]);});
 it('saves a future planned tax payment while its tax treatment is still unknown',()=>{
  const {root,controller}=mountWorkspace(makeAduPlan());fireEvent.click(getByRole(root,'button',{name:'Properties'}));expand(root);
  fireEvent.click(getByRole(root,'button',{name:'Plan estimated regular payment for 2028'}));
  fireEvent.click(getByRole(root,'button',{name:'Save property'}));
  const state=controller.getState();expect(state.issues).toEqual([]);expect(state.savedPlan.revision).toBe(1);expect(state.drafts.home).toBeUndefined();
  expect(state.savedPlan.properties[0]!.aduProject!.propertyTax.paymentYears[2]!.payments[0]).toMatchObject({month:'2028-12',amountCents:264_000,treatments:{federal:{known:false}}});
  expect(state.projection.years[2]!.adu!.projectTaxPaidCents).toEqual({status:'available',value:264_000});expect(state.projection.years[2]!.totalTaxCents.status).toBe('needs-data');
 });
 it('retains invalid saved text and keeps project removal in the draft until Save',()=>{const {root,controller}=mountWorkspace(makeAduPlan());fireEvent.click(getByRole(root,'button',{name:'Properties'}));expand(root);setField(root,'Total ADU build cost ($)','bad');fireEvent.click(getByRole(root,'button',{name:'Save property'}));expect(getByLabelText(root,'Total ADU build cost ($)')).toHaveValue('bad');expect(getByLabelText(root,'Total ADU build cost ($)')).toHaveAttribute('aria-invalid','true');expect(controller.getState().savedPlan.revision).toBe(0);fireEvent.click(getByRole(root,'button',{name:'Remove ADU project'}));expect(controller.getState().savedPlan.properties[0]!.aduProject).toBeDefined();fireEvent.click(within(root.querySelector('form[data-record-id="home"]') as HTMLElement).getByRole('button',{name:'Discard edits'}));expect(getByLabelText(root,'Total ADU build cost ($)')).toHaveValue('300000.00');});
});
