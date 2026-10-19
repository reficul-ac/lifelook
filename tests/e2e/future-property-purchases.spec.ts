import {test,expect,type Page,type Locator} from '@playwright/test';
import {makePlan} from '../helpers/plans';
import {preloadWorkspace,readActivePlan} from './helpers/workspace';

async function addProperty(page:Page){
 await page.getByRole('button',{name:'Properties',exact:true}).click();
 await page.getByRole('button',{name:'Add property',exact:true}).click();
 return page.locator('form[data-editable-section="properties"]').last();
}
async function fill(form:Locator,label:string,value:string){await form.getByLabel(label,{exact:true}).fill(value);}
async function assets(page:Page,year:number){
 const summary=page.getByText(`Asset and loan balances · ${year}`,{exact:true}),details=summary.locator('..');
 if(!await details.evaluate(node=>(node as HTMLDetailsElement).open))await summary.click();
}
async function money(control:Locator){return Number((await control.textContent())!.replace(/[^0-9.-]/g,''));}

test('buys a future home with a brokerage-funded down payment and a purchase mortgage',async({page})=>{
 await preloadWorkspace(page,makePlan({startYear:2027,horizonYears:4,openingCashCents:5_000_000,accounts:[{id:'brokerage',name:'Purchase savings',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:50_000_000,annualGrowthBps:0,openingIraBasis:{known:false},openingTaxableBasis:{known:true,value:30_000_000}}]}));
 const form=await addProperty(page);
 await fill(form,'Property name','Future home');await fill(form,'Purchase date','2029-01-02');await fill(form,'Purchase price ($)','800000.00');await fill(form,'Down payment ($)','160000.00');await fill(form,'Effective annual appreciation (%)','0.00');
 await expect(form.getByLabel('Property market value at purchase ($)',{exact:true})).toHaveValue('800000.00');
 await form.getByLabel('Pay down payment from',{exact:true}).selectOption('brokerage');await form.getByRole('button',{name:'Add loan',exact:true}).click();
 await expect(form.getByLabel('Mortgage amount ($)',{exact:true})).toHaveValue('640000.00');await fill(form,'Mortgage APR (%)','6.00');
 await expect(form.getByLabel('First payment date',{exact:true})).toHaveValue('2029-02-28');
 await form.getByRole('button',{name:'Save property',exact:true}).click();await expect(page.getByTestId('save-status')).toHaveText(/Inputs v1/);
 const applied=await readActivePlan(page),property=applied.properties[0]!,loan=property.loans[0]!;
 expect(property.purchaseFunding).toEqual({kind:'taxable-brokerage',accountId:'brokerage'});expect(property.purchaseDate).toBe('2029-01-02');expect(loan.originalPrincipalCents).toBe(64_000_000);
 await assets(page,2028);await expect(page.getByTestId(`annual-2028-property-${property.id}-equity`)).toHaveText('$0.00');await expect(page.getByTestId(`annual-2028-loan-${loan.id}-closing`)).toHaveText('$0.00');
 await assets(page,2029);await expect(page.getByTestId(`annual-2029-property-${property.id}-purchase-value`)).toHaveText('$800,000.00');
 const remainingMortgage=await money(page.getByTestId(`annual-2029-loan-${loan.id}-closing`));expect(remainingMortgage).toBeGreaterThan(0);expect(remainingMortgage).toBeLessThan(640_000);
 await expect(page.getByTestId('forecast-brokerage-construction-funded')).toHaveText('$160,000.00');expect(await money(page.getByTestId('forecast-brokerage-gross-sales'))).toBeGreaterThan(160_000);expect(await money(page.getByTestId('forecast-brokerage-sale-tax'))).toBeGreaterThan(0);
 for(const year of [2027,2028,2029,2030])for(const field of ['net-worth','post-tax-income','expenses','cash-flow'])await expect(page.getByTestId(`summary-${year}-${field}`)).toHaveText(/\$/);
 await page.reload();expect(await readActivePlan(page)).toEqual(applied);await expect(page.getByTestId('forecast-brokerage-construction-funded')).toHaveText('$160,000.00');
});

test('saves a future all-cash rental using purchase estimates without inventing prior tax history',async({page})=>{
 await preloadWorkspace(page,makePlan({startYear:2027,horizonYears:4,openingCashCents:100_000_000}));
 const form=await addProperty(page);
 await fill(form,'Property name','Future rental');await fill(form,'Purchase date','2029-01-02');await fill(form,'Purchase price ($)','800000.00');await fill(form,'Down payment ($)','800000.00');await fill(form,'Effective annual appreciation (%)','0.00');await form.getByLabel('Property role',{exact:true}).selectOption('rental');
 await fill(form,'Monthly rent receipts ($)','3000.00');await fill(form,'Lease income start date','2029-02-01');
 await expect(form.getByLabel('Estimated building share (%)',{exact:true})).toHaveValue('80.00');await form.getByRole('button',{name:'Save property',exact:true}).click();await expect(page.getByTestId('save-status')).toHaveText(/Inputs v1/);
 const applied=await readActivePlan(page),property=applied.properties[0]!;
 expect(property.loans).toEqual([]);expect(applied.rentals[0]!.taxHistory.federal).toEqual({known:false});expect(property.purchaseTaxEstimation).toEqual({mode:'simple',buildingShareBps:8000});
 await assets(page,2028);await expect(page.getByTestId(`annual-2028-property-${property.id}-equity`)).toHaveText('$0.00');await expect(page.getByTestId('summary-2028-net-worth')).toHaveText('$1,000,000.00');
 await assets(page,2029);await expect(page.getByTestId(`annual-2029-property-${property.id}-purchase-value`)).toHaveText('$800,000.00');await expect(page.getByTestId('annual-2029-rent')).toHaveText('$33,000.00');await expect(page.getByTestId('summary-2029-net-worth')).toHaveText('$1,033,000.00');
 for(const year of [2027,2028,2029,2030])for(const field of ['net-worth','post-tax-income','expenses','cash-flow'])await expect(page.getByTestId(`summary-${year}-${field}`)).toHaveText(/\$/);
 await page.reload();expect(await readActivePlan(page)).toEqual(applied);await expect(page.getByTestId('summary-2029-net-worth')).toHaveText('$1,033,000.00');
});
