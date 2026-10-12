import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, getByLabelText, getByRole, within } from '@testing-library/dom';
import projectionReferences from '../../fixtures/math/projection.json';
import type { PlanDocument } from '../../src/engine/model/plan';
import { calculateProjection } from '../../src/engine/projection';
import { loadRuleSet } from '../../src/engine/rules/registry';
import { validatePlan } from '../../src/engine/validation';
import { createWorkspace } from '../../src/browser/state';
import { renderPropertiesForm } from '../../src/browser/forms/properties';

const references = projectionReferences as unknown as {id:string;input:PlanDocument;expected:{months:{netWorthCents:unknown}[];years:{netWorthCents:unknown}[]}}[];
const main = () => structuredClone(references.find(c => c.id === 'two-salaries-home-adu')!.input);
function mount(plan=main(),subscribe=true) {
  const values = new Map<string,string>();
  const storage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  const controller = createWorkspace(plan,storage,loadRuleSet());
  const root = document.createElement('section');document.body.append(root);
  const render=()=>renderPropertiesForm(root,controller);if(subscribe)controller.subscribe(render);render();
  return {root,controller,storage};
}
function set(root:HTMLElement,label:string,value:string) {
  const control=getByLabelText(root,label) as HTMLInputElement|HTMLSelectElement;
  fireEvent.input(control,{target:{value}});fireEvent.change(control,{target:{value}});
}
function click(root:HTMLElement,name:string) {fireEvent.click(getByRole(root,'button',{name}));}
function fieldset(root:HTMLElement,name:string):HTMLElement {return getByRole(root,'group',{name});}
function record(root:HTMLElement,id:string):HTMLElement {const node=root.querySelector<HTMLElement>(`form[data-record-id="${id}"]`);if(!node)throw new Error('Missing property record');return node;}
function direct(plan:PlanDocument) {const result=validatePlan(plan);if(!result.ok)throw new Error('Saved property document invalid');return calculateProjection(result.plan,loadRuleSet());}
afterEach(()=>{document.body.replaceChildren();});

describe('atomic property, loan and rental workflows',()=>{
  it('saves nested home and loan edits in one revision without another ADU asset',()=>{
    const {root,controller}=mount();
    set(root,'Property name','Saved home and ADU');
    set(root,'Purchase price','500000.00');set(root,'Down payment','200000.00');
    set(root,'Combined home and ADU market value at forecast start','500000.00');
    set(root,'Effective annual appreciation (%)','3.00');
    set(fieldset(root,'Loan — Known zero-rate mortgage'),'Opening mortgage balance','300000.00');set(fieldset(root,'Loan — Known zero-rate mortgage'),'Opening principal-and-interest payment','1000.00');
    set(fieldset(root,'Appreciation override 1'),'Appreciation rate (%)','5.00');set(fieldset(root,'Appreciation override 2'),'Appreciation rate (%)','3.00');
    const before=controller.getState().savedPlan.revision;click(root,'Save property');
    const state=controller.getState();
    expect(state.savedPlan.revision).toBe(before+1);expect(state.projection.inputRevision).toBe(before+1);expect(state.persisted).toBe(true);
    expect(state.savedPlan.properties).toHaveLength(1);expect(state.savedPlan.properties[0]!.loans).toHaveLength(1);
    expect(state.savedPlan.properties[0]!.appreciationOverrides).toEqual([{year:2027,rateBps:500},{year:2028,rateBps:300}]);
    expect(state.projection).toEqual(direct(state.savedPlan));
    expect(state.projection.months[0]!.properties).toHaveLength(1);
    expect(state.projection.months[0]!.loans.filter(l=>l.loanId==='home-loan')).toHaveLength(1);
    expect(state.projection.months[0]!.netWorthCents).toEqual({status:'available',value:25088377});
    expect(state.projection.years[0]!.netWorthCents).toEqual({status:'available',value:36353605});
  });

  it('preserves an invalid nested ADU draft and the saved revision',()=>{
    const {root,controller}=mount(),before=controller.getState().savedPlan.revision;
    set(root,'ADU living area','0');click(root,'Save property');
    const state=controller.getState();
    expect(state.savedPlan.revision).toBe(before);expect(state.projection.inputRevision).toBe(before);
    expect(getByLabelText(root,'ADU living area')).toHaveValue('0');
    expect(state.drafts.home).toBeDefined();
    expect(state.issues).toContainEqual(expect.objectContaining({recordId:'home',field:'aduArea'}));
  });

  it('keeps linked rental and expense edits together until property Save',()=>{
    const {root,controller}=mount(),before=controller.getState().savedPlan.revision;
    set(root,'Monthly rent receipts','2100.00');
    const expense=fieldset(root,'Property expense — Homeowners insurance');set(expense,'Property expense amount','125.00');
    expect(controller.getState().savedPlan.rentals[0]!.monthlyRentCents).toBe(200000);
    expect(controller.getState().savedPlan.expenses.find(e=>e.id==='home-insurance')!.amountCents).toBe(10000);
    click(root,'Save property');
    const state=controller.getState();expect(state.savedPlan.revision).toBe(before+1);
    expect(state.savedPlan.rentals[0]!.monthlyRentCents).toBe(210000);
    expect(state.savedPlan.expenses.find(e=>e.id==='home-insurance')!.amountCents).toBe(12500);
    expect(state.projection).toEqual(direct(state.savedPlan));
  });

  it('saves independent federal, California and AMT history amounts',()=>{
    const {root,controller}=mount();
    for(const [name,basis]of [['Federal rental tax history','33000.00'],['California rental tax history','36000.00'],['Federal AMT rental tax history','39000.00'],['California AMT rental tax history','42000.00']]){
      set(fieldset(root,name!),'Original building recovery basis (excludes land)',basis!);set(fieldset(root,name!),'Adjusted building basis',basis!);
    }
    click(root,'Save property');const books=controller.getState().savedPlan.rentals[0]!.taxHistory;
    for(const [key,basis]of [['federal',3300000],['california',3600000],['federal-amt',3900000],['california-amt',4200000]] as const){expect(books[key]).toMatchObject({known:true,value:{recoveryBasisCents:basis,adjustedBuildingBasisCents:basis}});}
  });

  it('preserves unknown history and makes dependent tax totals unavailable',()=>{
    const {root,controller}=mount();const book=fieldset(root,'Federal rental tax history');
    set(book,'History status','unknown');click(root,'Save property');
    const state=controller.getState();expect(state.savedPlan.rentals[0]!.taxHistory.federal).toEqual({known:false});
    expect(state.projection.years[0]!.netWorthCents.status).toBe('needs-data');
    expect(state.projection.years[0]!.salaryCents.status).toBe('available');
    expect(state.projection.issues).toContainEqual(expect.objectContaining({code:'required-history',recordId:'adu',field:'taxHistory.federal'}));
  });

  it('accepts an explicit known-zero history without turning blank known data into zero',()=>{
    const {root,controller}=mount();let book=fieldset(root,'Federal rental tax history');
    set(book,'History status','known-zero');click(root,'Save property');
    const first=controller.getState();expect(first.savedPlan.rentals[0]!.taxHistory.federal).toEqual({known:true,value:{recoveryBasisCents:0,adjustedBuildingBasisCents:0,cumulativeDepreciationCents:0,atRiskCents:0,atRiskSuspendedCents:0,passiveSuspendedCents:0,lossVintages:[]}});
    const before=first.savedPlan.revision;book=fieldset(root,'Federal rental tax history');set(book,'Adjusted building basis','');click(root,'Save property');
    expect(controller.getState().savedPlan.revision).toBe(before);expect(getByLabelText(fieldset(root,'Federal rental tax history'),'Adjusted building basis')).toHaveValue('');
  });

  it('allows a later lease start on an already available rental',()=>{
    const {root,controller}=mount();set(root,'Lease income start date','2026-04-01');click(root,'Save property');
    const state=controller.getState();expect(state.savedPlan.rentals[0]!.rentStartDate).toBe('2026-04-01');
    expect(state.projection.months.slice(0,3).every(m=>m.rentCents.status==='available'&&m.rentCents.value===0)).toBe(true);
    expect(state.projection.years[0]!.household.status).toBe('available');
    if(state.projection.years[0]!.household.status==='available')expect(state.projection.years[0]!.household.value.facts.preIra.rentalFacts[0]!.depreciation.federal).toMatchObject({status:'available',value:{depreciationCents:115000}});
  });

  it.each([['Available for rent date','2027-01-01','availableDate'],['Purchase date','2027-01-01','purchaseDate']])('rejects future %s and retains entered text',(label,value,field)=>{
    const {root,controller}=mount(),before=controller.getState().savedPlan.revision;
    set(root,label!,value!);click(root,'Save property');
    expect(controller.getState().savedPlan.revision).toBe(before);expect(controller.getState().projection.inputRevision).toBe(before);
    expect(getByLabelText(root,label!)).toHaveValue(value!);expect(controller.getState().issues).toContainEqual(expect.objectContaining({field}));
  });

  it('rejects an invalid explicit loan share without losing the other nested edits',()=>{
    const {root,controller}=mount(),before=controller.getState().savedPlan.revision;
    set(root,'Property name','Retained nested home');
    set(fieldset(root,'Rental interest allocation — Known zero-rate mortgage'),'Allocation numerator','5');set(fieldset(root,'Rental interest allocation — Known zero-rate mortgage'),'Allocation denominator','4');click(root,'Save property');
    expect(controller.getState().savedPlan.revision).toBe(before);expect(getByLabelText(root,'Property name')).toHaveValue('Retained nested home');
    expect(getByLabelText(fieldset(root,'Rental interest allocation — Known zero-rate mortgage'),'Allocation numerator')).toHaveValue('5');
  });

  it('distinguishes combined asset value and rental basis from separate property costs and loan payments',()=>{
    const {root}=mount();
    expect(getByLabelText(root,'Combined home and ADU market value at forecast start')).toHaveValue('500000.00');
    expect(getByLabelText(fieldset(root,'Federal rental tax history'),'Original building recovery basis (excludes land)')).toHaveValue('33000.00');
    expect(getByLabelText(root,'Opening principal-and-interest payment')).toHaveValue('1000.00');
    expect(getByLabelText(fieldset(root,'Property expense — Property tax paid'),'Property expense amount')).toHaveValue('4000.00');
    expect(getByLabelText(fieldset(root,'Property expense — Homeowners insurance'),'Property expense amount')).toHaveValue('100.00');
    expect(root).toHaveTextContent(/Property tax and insurance are separate from principal-and-interest payments/);
    expect(root).toHaveTextContent(/Default ADU shared allocation.*25/);
  });

  it('saves added and removed appreciation rows together',()=>{
    const {root,controller}=mount();click(root,'Add appreciation override');
    const rows=within(root).getAllByRole('group',{name:/Appreciation override/});expect(rows).toHaveLength(3);
    set(fieldset(root,'Appreciation override 3'),'Appreciation year','2029');set(fieldset(root,'Appreciation override 3'),'Appreciation rate (%)','1.25');
    click(fieldset(root,'Appreciation override 1'),'Remove appreciation override');click(root,'Save property');
    expect(controller.getState().savedPlan.properties[0]!.appreciationOverrides).toEqual([{year:2028,rateBps:200},{year:2029,rateBps:125}]);
  });

  it('edits QBI qualification, wage, UBIA and loss-vintage rows beside the rental',()=>{
    const {root,controller}=mount();
    set(fieldset(root,'Rental QBI history'),'QBI qualification','false');set(fieldset(root,'Rental QBI history'),'QBI wages','123.00');set(fieldset(root,'Rental QBI history'),'QBI UBIA','33000.00');
    click(fieldset(root,'Rental QBI history'),'Add QBI loss vintage');set(fieldset(root,'QBI loss vintage 1'),'Loss year','2025');set(fieldset(root,'QBI loss vintage 1'),'Loss amount','75.00');
    click(root,'Save property');
    expect(controller.getState().savedPlan.rentals[0]!.qbi).toEqual({qualification:{known:true,value:false},wagesCents:{known:true,value:12300},ubiaCents:{known:true,value:3300000},openingLossVintages:{known:true,value:[{year:2025,amountCents:7500}]}});
  });

  it('keeps an unsaved property bundle when an unrelated salary record is saved',()=>{
    const {root,controller}=mount();set(root,'Property name','Uncommitted property');
    const before=controller.getState().savedPlan.revision;
    const salary=controller.getDraft('salaries','salary-a');controller.editDraft('salary-a',{...salary,value:{...salary.value,name:'Saved salary'}});
    expect(controller.saveRecord('salary-a').accepted).toBe(true);
    expect(controller.getState().savedPlan.properties[0]!.name).toBe('Combined home and ADU');
    expect(controller.getState().savedPlan.salaries.find(row=>row.id==='salary-a')!.name).toBe('Saved salary');
    expect(controller.getState().drafts.home).toBeDefined();expect(controller.getState().savedPlan.revision).toBe(before+1);
    expect(getByLabelText(root,'Property name')).toHaveValue('Uncommitted property');
  });

  it('uses changed known mortgage overrides in the saved cash and liability schedules',()=>{
    const {root,controller}=mount();set(root,'Opening mortgage balance','250000.00');set(root,'Opening principal-and-interest payment','1250.00');click(root,'Save property');
    const state=controller.getState();expect(state.savedPlan.properties[0]!.loans[0]).toMatchObject({openingBalance:{known:true,value:25000000},openingPayment:{known:true,value:125000}});
    expect(state.projection.months[0]!.loans.find(loan=>loan.loanId==='home-loan')).toMatchObject({openingPrincipalCents:{status:'available',value:25000000},paymentCents:{status:'available',value:125000},closingPrincipalCents:{status:'available',value:24875000}});
    expect(state.projection.months[0]!.netWorthCents).toEqual({status:'available',value:30088377});
  });

  it('initializes an ordinary purchase loan from entered terms while retaining unknown history',()=>{
    const plan=structuredClone(references.find(c=>c.id==='zero-cash')!.input),{root,controller}=mount(plan);
    click(root,'Add property');const id=Object.keys(controller.getState().drafts)[0]!;
    set(record(root,id),'Property name','Existing primary home');set(record(root,id),'Purchase date','2025-12-01');
    set(record(root,id),'Purchase price','100000.00');set(record(root,id),'Down payment','20000.00');set(record(root,id),'Property market value at forecast start','100000.00');
    click(record(root,id),'Add loan');
    expect(getByLabelText(record(root,id),'Original principal')).toHaveValue('80000.00');
    expect(record(root,id)).toHaveTextContent(/Estimated scheduled principal-and-interest payment: \$222.22/);
    set(record(root,id),'Nominal APR (%)','0.00');set(record(root,id),'Term (months)','120');click(record(root,id),'Initialize ordinary purchase loan');
    expect(record(root,id)).toHaveTextContent(/Estimated scheduled principal-and-interest payment: \$666.67/);
    click(record(root,id),'Save property');const state=controller.getState();
    expect(state.savedPlan.revision).toBe(1);expect(state.savedPlan.properties).toHaveLength(1);
    expect(state.savedPlan.properties[0]!.loans[0]).toMatchObject({originalPrincipalCents:8000000,termMonths:120,openingBalance:{known:false},openingPayment:{known:false},proceedsQualification:{qualifiedAcquisitionDebt:{known:false},qualifiedPrincipalCents:{known:false},historyComplete:{known:false}}});
    expect(state.projection).toEqual(direct(state.savedPlan));expect(JSON.stringify(state.savedPlan)).not.toContain('__draft');
  });

  it('creates a whole rental with direct costs that never enter personal deductions',()=>{
    const {root,controller}=mount();click(root,'Add property');const id=Object.keys(controller.getState().drafts)[0]!;
    set(record(root,id),'Property name','Whole rental');set(record(root,id),'Property role','rental');set(record(root,id),'Purchase date','2025-12-01');
    set(record(root,id),'Purchase price','200000.00');set(record(root,id),'Down payment','200000.00');set(record(root,id),'Property market value at forecast start','200000.00');
    click(record(root,id),'Add rental unit');set(record(root,id),'Monthly rent receipts','1000.00');set(record(root,id),'Active participation','true');
    for(const label of ['Long-term fair-market lease','Rental has no personal use','No substantial tenant services','Ordinary residential rental'])set(record(root,id),label,'true');
    set(record(root,id),'Advanced basis adjustments apply','false');set(record(root,id),'California AMT small-business qualification','false');set(record(root,id),'QBI qualification','false');
    set(record(root,id),'QBI loss history','known');set(record(root,id),'QBI wages history','known');set(record(root,id),'QBI wages','0.00');set(record(root,id),'QBI UBIA history','known');set(record(root,id),'QBI UBIA','0.00');
    for(const name of ['Federal rental tax history','California rental tax history','Federal AMT rental tax history','California AMT rental tax history'])set(fieldset(record(root,id),name),'History status','known-zero');
    const rentalId=(controller.getDraft('properties',id).value.rentals as {id:string}[])[0]!.id;
    click(record(root,id),'Add property expense');set(record(root,id),'Property expense name','Whole rental property tax');
    set(record(root,id),'Property expense amount','2400.00');set(record(root,id),'Property expense frequency','annual');set(record(root,id),'Property expense category','property-tax');set(record(root,id),'Property expense use','rental');set(record(root,id),'Direct expense rental unit',rentalId);
    click(record(root,id),'Save property');const state=controller.getState();
    expect(state.savedPlan.revision).toBe(1);expect(state.savedPlan.properties).toHaveLength(2);expect(state.savedPlan.rentals).toHaveLength(2);
    expect(state.projection).toEqual(direct(state.savedPlan));const tax=state.projection.years[0]!.tax;expect(tax.status).toBe('available');
    if(tax.status==='available'){expect(tax.value.deductions.federal.detail!.propertyTaxPaidCents).toBe(300000);expect(tax.value.deductions.california.detail!.propertyTaxPaidCents).toBe(300000);}
  });

  it('saves a source-qualified carried loss vintage and releases its known amount',()=>{
    const {root,controller}=mount();set(fieldset(root,'Federal rental tax history'),'Suspended passive losses','50.00');click(fieldset(root,'Federal rental tax history'),'Add rental loss vintage');
    set(fieldset(root,'Rental loss vintage 1'),'Loss year','2025');set(fieldset(root,'Rental loss vintage 1'),'Loss source','passive');set(fieldset(root,'Rental loss vintage 1'),'Loss amount','50.00');set(fieldset(root,'Rental loss vintage 1'),'Participation when loss arose','true');set(fieldset(root,'Rental loss vintage 1'),'QBI qualification when loss arose','false');
    click(root,'Save property');const state=controller.getState(),history=state.savedPlan.rentals[0]!.taxHistory.federal;expect(state.savedPlan.revision).toBe(1);
    expect(history).toMatchObject({known:true,value:{passiveSuspendedCents:5000,lossVintages:[{year:2025,source:'passive',amountCents:5000,activeParticipation:{known:true,value:true},qbiQualification:{known:true,value:false}}]}});
    const household=state.projection.years[0]!.household;expect(household.status).toBe('available');if(household.status==='available')expect(household.value.rental.federal).toMatchObject({status:'available',value:{allowedRentalCents:2150000,closingPassiveLossCents:0}});
  });

  it('keeps conversion value unknown until explicitly supplied and leaves combined market value unchanged',()=>{
    const {root,controller}=mount();set(root,'Converted from personal use','true');click(root,'Save property');
    expect(controller.getState().projection.years[0]!.netWorthCents.status).toBe('needs-data');
    set(root,'Building fair market value at conversion history','known');set(root,'Building fair market value at conversion','20000.00');click(root,'Save property');
    const state=controller.getState();expect(state.savedPlan.properties[0]!.openingValueCents).toBe(50000000);
    const household=state.projection.years[0]!.household;expect(household.status).toBe('available');if(household.status==='available')expect(household.value.facts.preIra.rentalFacts[0]!.depreciation.federal).toMatchObject({status:'available',value:{depreciationCents:69697}});
  });

  it('labels scheduled opening balance and payment estimates while keeping known overrides editable',()=>{
    const {root,controller}=mount();set(root,'Opening mortgage balance history','unknown');set(root,'Opening principal-and-interest payment history','unknown');click(root,'Save property');
    expect(root).toHaveTextContent(/Saved opening balance: estimated; saved payment: estimated/);
    expect(controller.getState().savedPlan.properties[0]!.loans[0]).toMatchObject({openingBalance:{known:false},openingPayment:{known:false}});
    set(root,'Opening mortgage balance history','known');set(root,'Opening mortgage balance','300000.00');set(root,'Opening principal-and-interest payment history','known');set(root,'Opening principal-and-interest payment','1000.00');click(root,'Save property');
    expect(root).toHaveTextContent(/Saved opening balance: known; saved payment: known/);
  });

  it('submits one property revision through the native Save form',()=>{
    const {root,controller}=mount();set(root,'Property name','Keyboard-saved property');const save=getByRole(root,'button',{name:'Save property'}) as HTMLButtonElement;
    save.focus();expect(document.activeElement).toBe(save);expect(save.type).toBe('submit');save.form!.requestSubmit(save);
    expect(controller.getState().savedPlan.revision).toBe(1);expect(controller.getState().savedPlan.properties[0]!.name).toBe('Keyboard-saved property');
    expect((getByRole(root,'button',{name:'Add appreciation override'}) as HTMLButtonElement).type).toBe('button');
  });

  it('retains fractional living areas and displays the engine area allocation',()=>{
    const {root,controller}=mount();set(root,'Primary home living area','1500.5');set(root,'ADU living area','500.5');click(root,'Save property');
    expect(controller.getState().savedPlan.properties[0]).toMatchObject({primaryArea:1500.5,aduArea:500.5});
    expect(root).toHaveTextContent(/Default ADU shared allocation: 25.01%/);
  });

  it.each([['Origination date','originationDate'],['Acquisition date','acquisitionDate']])('retains a rejected future loan %s',(label,field)=>{
    const {root,controller}=mount();set(fieldset(root,'Loan — Known zero-rate mortgage'),label!,'2027-01-01');click(root,'Save property');
    expect(controller.getState().savedPlan.revision).toBe(0);expect(controller.getState().projection.inputRevision).toBe(0);
    expect(getByLabelText(root,label!)).toHaveValue('2027-01-01');expect(controller.getState().issues).toContainEqual(expect.objectContaining({recordId:'home-loan',field}));
  });

  it('applies an explicit shared property-tax allocation without changing cash paid',()=>{
    const {root,controller}=mount();set(fieldset(root,'Property expense — Property tax paid'),'Expense shared allocation','explicit');
    set(fieldset(root,'Property expense — Property tax paid'),'Allocation numerator','1');set(fieldset(root,'Property expense — Property tax paid'),'Allocation denominator','2');click(root,'Save property');
    const state=controller.getState(),household=state.projection.years[0]!.household;expect(state.projection.years[0]!.propertyExpensesCents).toEqual({status:'available',value:520000});
    expect(household.status).toBe('available');if(household.status==='available')expect(household.value.facts.preIra.rentalFacts[0]).toMatchObject({operatingExpenseCents:230000,books:{federal:{status:'available',value:{taxableProfitCents:2055000}}}});
    const tax=state.projection.years[0]!.tax;expect(tax.status).toBe('available');if(tax.status==='available')expect(tax.value.deductions.federal.detail!.propertyTaxPaidCents).toBe(200000);
  });

  it('rejects deleting a property referenced by its rental instead of deleting linked records',()=>{
    const {root,controller}=mount();click(root,'Remove property');
    expect(controller.getState().savedPlan.properties).toHaveLength(1);expect(controller.getState().savedPlan.rentals).toHaveLength(1);
    expect(controller.getState().savedPlan.revision).toBe(0);expect(controller.getState().issues).toContainEqual(expect.objectContaining({recordId:'adu',field:'propertyId'}));
  });

  it('requires an explicit rental-allocation removal before saving a removed loan',()=>{
    const {root,controller}=mount();click(root,'Remove loan');click(root,'Save property');
    expect(controller.getState().savedPlan.revision).toBe(0);expect(controller.getState().savedPlan.properties[0]!.loans).toHaveLength(1);
    expect(controller.getState().issues).toContainEqual(expect.objectContaining({recordId:'adu',field:'loanAllocations[0].loanId'}));
    click(root,'Remove rental interest allocation');click(root,'Save property');
    expect(controller.getState().savedPlan.revision).toBe(1);expect(controller.getState().savedPlan.properties[0]!.loans).toHaveLength(0);expect(controller.getState().savedPlan.rentals[0]!.loanAllocations).toHaveLength(0);
  });

  it('selects proceeds, loans and rental recipients by meaningful names while retaining stable references',()=>{
    const {root,controller}=mount();
    const property=getByLabelText(fieldset(root,'Loan proceeds allocation 1'),'Proceeds property');expect(property.tagName).toBe('SELECT');
    expect(getByRole(property,'option',{name:'Combined home and ADU'})).toHaveValue('home');
    const rental=getByLabelText(fieldset(root,'Loan proceeds allocation 2'),'Proceeds rental unit');expect(getByRole(rental,'option',{name:'ADU 1 — Combined home and ADU'})).toHaveValue('adu');
    const loan=getByLabelText(fieldset(root,'Rental interest allocation — Known zero-rate mortgage'),'Allocated loan');expect(getByRole(loan,'option',{name:'Known zero-rate mortgage — Combined home and ADU'})).toHaveValue('home-loan');
    set(fieldset(root,'Property expense — Property tax paid'),'Property expense use','rental');
    const expenseRental=getByLabelText(fieldset(root,'Property expense — Property tax paid'),'Direct expense rental unit');expect(getByRole(expenseRental,'option',{name:'ADU 1 — Combined home and ADU'})).toHaveValue('adu');
    set(fieldset(root,'Property expense — Property tax paid'),'Direct expense rental unit','adu');click(root,'Save property');
    expect(controller.getState().savedPlan.expenses.find(e=>e.id==='home-property-tax')).toMatchObject({use:'rental',rentalId:'adu'});
    expect(controller.getState().savedPlan.properties[0]!.loans[0]!.proceedsAllocations[1]!.rentalId).toBe('adu');
  });

  it('preserves keyboard focus when a history choice reveals its editable value',()=>{
    const {root}=mount(main(),false),history=getByLabelText(root,'Opening mortgage balance history');history.focus();
    fireEvent.change(history,{target:{value:'unknown'}});expect(getByLabelText(root,'Opening mortgage balance history')).toHaveFocus();
    fireEvent.change(getByLabelText(root,'Opening mortgage balance history'),{target:{value:'known'}});
    expect(getByLabelText(root,'Opening mortgage balance history')).toHaveFocus();expect(getByLabelText(root,'Opening mortgage balance')).toHaveValue('');
  });
});
