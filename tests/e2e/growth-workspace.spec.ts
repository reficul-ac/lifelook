import {expect,test,type Locator,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import type {PlanDocument} from '../../src/engine';
import {makePlan,mustValidate} from '../helpers/plans';
import {makeAduPlan} from '../helpers/adu';
import {openForecastDetails,openRecord,openSettings,preloadWorkspace,readActivePlan,readWorkspace,replaceScenarioFromJson,switchScenario} from './helpers/workspace';

test.use({hasTouch:true});
function growthPlan(horizonYears=3):PlanDocument {
 return mustValidate(makePlan({horizonYears,accounts:[
  {id:'stocks',name:'Default candidate',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:1000000,annualGrowthBps:500,openingIraBasis:{known:true,value:0}},
  {id:'custom',name:'Custom exception',ownerId:'owner-a',type:'taxable-brokerage',openingBalanceCents:500000,annualGrowthBps:200,openingIraBasis:{known:true,value:0}},
  {id:'equity',name:'Scheduled employer RSUs',ownerId:'owner-a',type:'rsu',openingBalanceCents:0,annualGrowthBps:100,openingIraBasis:{known:false},rsu:{employerId:'employer',currentSharePriceCents:10000,priceTargets:[{date:'2028-01-01',sharePriceCents:20000}],grants:[{id:'grant',name:'Future award',startDate:'2027-01-01',grantValueCents:120000,grantSharePriceCents:10000,vestingMonths:12,vestingFrequency:'monthly',cliffMonths:0,withholdingBps:2500,taxTreatment:'settle-at-vest',openingHeldShares:0,openingBasis:{known:true,value:0}}]}},
 ],properties:[{id:'home',name:'Override home',role:'primary',purchaseDate:'2024-01-01',purchasePriceCents:10000000,downPaymentCents:10000000,openingValueCents:10000000,appreciationBps:100,appreciationOverrides:[{year:2026,rateBps:0}],loans:[]}]}));
}
const rail=(page:Page)=>page.getByRole('region',{name:'Growth assumptions',exact:true});
async function ready(page:Page):Promise<void>{await expect(rail(page).locator('[data-growth-status]')).toHaveAttribute('data-growth-status','valid');}
async function configure(page:Page,properties=false):Promise<Locator>{
 const growth=rail(page),stock=growth.getByRole('group',{name:'Stock accounts',exact:true});
 await stock.getByRole('button',{name:'Set default',exact:true}).click();
 const input=growth.getByLabel('Stock account growth (%)',{exact:true});
 await expect(input).toHaveAttribute('data-field','growthAssumptions.stocksBps');await expect(input).toHaveValue('7.70');
 if(properties){const category=growth.getByRole('group',{name:'Properties',exact:true});await category.getByRole('button',{name:'Set default',exact:true}).click();await growth.getByLabel('Property appreciation (%)',{exact:true}).fill('3.00');}
 const membership=growth.getByText('Choose assets using defaults',{exact:true});if(!await membership.locator('..').evaluate(node=>(node as HTMLDetailsElement).open))await membership.click();
 await growth.getByRole('checkbox',{name:'Default candidate',exact:true}).check();
 if(properties)await growth.getByRole('checkbox',{name:'Override home',exact:true}).check();
 await ready(page);return input;
}
async function expectFits(page:Page,locator:Locator):Promise<void>{const bounds=await locator.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(-1);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);}
async function expectTextContrast(locator:Locator):Promise<void>{
 const contrast=await locator.evaluate(node=>{
  const channels=(color:string)=>(color.match(/[\d.]+/g)??[]).map(Number);
  const luminance=(color:number[])=>color.slice(0,3).map(value=>{const linear=value/255;return linear<=.04045?linear/12.92:((linear+.055)/1.055)**2.4;}).reduce((total,value,index)=>total+value*[.2126,.7152,.0722][index]!,0);
  const style=getComputedStyle(node),foreground=luminance(channels(node instanceof SVGElement?style.fill:style.color));
  let background=getComputedStyle(document.documentElement).backgroundColor;
  for(let parent:Element|null=node;parent;parent=parent.parentElement){const color=getComputedStyle(parent).backgroundColor,rgba=channels(color);if(rgba.length===3||rgba[3]===1){background=color;break;}}
  const surface=luminance(channels(background));return (Math.max(foreground,surface)+.05)/(Math.min(foreground,surface)+.05);
 });expect(contrast).toBeGreaterThanOrEqual(4.5);
}
async function expectUnobscuredByGrowthImpact(page:Page,control:Locator):Promise<void>{
 const controlBounds=await control.boundingBox(),ribbon=page.locator('[data-growth-impact]');
 expect(controlBounds).not.toBeNull();if(!await ribbon.isVisible())return;
 const ribbonBounds=await ribbon.boundingBox();expect(ribbonBounds).not.toBeNull();
 const overlaps=controlBounds!.x<ribbonBounds!.x+ribbonBounds!.width&&controlBounds!.x+controlBounds!.width>ribbonBounds!.x&&controlBounds!.y<ribbonBounds!.y+ribbonBounds!.height&&controlBounds!.y+controlBounds!.height>ribbonBounds!.y;
 expect(overlaps,`Focused/action control ${JSON.stringify(controlBounds)} must not intersect impact ribbon ${JSON.stringify(ribbonBounds)}`).toBe(false);
}
async function checkMobileScrolling(page:Page):Promise<void>{
 const scroller=page.locator('.workspace-layout'),bounds=await scroller.boundingBox();expect(bounds).not.toBeNull();
 const before=await scroller.evaluate(node=>node.scrollTop);await page.mouse.move(bounds!.x+5,bounds!.y+bounds!.height*.5);await page.mouse.wheel(0,120);
 await expect.poll(()=>scroller.evaluate(node=>node.scrollTop)).toBeGreaterThan(before);
 const afterWheel=await scroller.evaluate(node=>node.scrollTop),session=await page.context().newCDPSession(page),x=bounds!.x+5,start=bounds!.y+bounds!.height*.75;
 try {
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start,id:0}]});
  for(const delta of [30,60,90,120])await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:start-delta,id:0}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>scroller.evaluate(node=>node.scrollTop)).toBeGreaterThan(afterWheel);
 }finally{await session.detach();}
}

for(const [width,theme] of [[320,'dark'],[390,'light'],[768,'dark'],[1180,'light'],[1440,'dark']] as const){
 test(`keeps the chart, exact growth editing and Apply usable at ${width}px in ${theme}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});
  await preloadWorkspace(page,growthPlan());
  const settings=await openSettings(page);await settings.getByLabel('Appearance',{exact:true}).selectOption(theme);await page.getByRole('button',{name:'Settings',exact:true}).click();
  const chart=page.getByRole('img',{name:'Net worth over time',exact:true});await expect(chart).toHaveCount(1);await expect(chart).toBeVisible();
  await expect(page.getByLabel('Chart year',{exact:true})).toHaveValue('2028');
  await expectFits(page,chart);const box=await chart.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(200);
  await chart.focus();await chart.press('Home');await expect(page.getByLabel('Forecast year',{exact:true})).toHaveValue('2026');
  await chart.press('End');await expect(page.getByLabel('Chart year',{exact:true})).toHaveValue('2028');
  await chart.scrollIntoViewIfNeeded();const touchBounds=await chart.boundingBox();
  await page.touchscreen.tap(touchBounds!.x+touchBounds!.width*.25,touchBounds!.y+touchBounds!.height*.5);await expect(page.getByLabel('Chart year',{exact:true})).toHaveValue('2026');
  const before=await readActivePlan(page),input=await configure(page);await expectFits(page,input);
  await input.focus();await input.fill('8.10');await ready(page);await expect(input).toBeFocused();await expect(input).toHaveValue('8.10');
  await expect(input).toBeInViewport();await expectUnobscuredByGrowthImpact(page,input);
  if(width===1440||width===390)await page.screenshot({path:`/tmp/lifelook-growth-workspace/${theme}-${width}.png`,fullPage:true,animations:'disabled',caret:'hide'});
  expect(await input.evaluate(node=>node.isConnected)).toBe(true);expect(await readActivePlan(page)).toEqual(before);
  if(width<650)await checkMobileScrolling(page);
  const apply=rail(page).getByRole('button',{name:'Apply growth changes',exact:true});await apply.scrollIntoViewIfNeeded();await expect(apply).toBeInViewport();await expect(apply).toBeEnabled();await expectFits(page,apply);
  await expectUnobscuredByGrowthImpact(page,apply);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.locator('.growth-chart')).toHaveAttribute('data-animation','none');
 });
}

test('previews without persistence and applies one exact category revision while preserving exceptions',async({page})=>{
 const original=growthPlan();await preloadWorkspace(page,original);await page.getByLabel('Chart year',{exact:true}).selectOption('2026');
 await configure(page,true);expect(await readActivePlan(page)).toEqual(original);
 await expect(page.locator('.growth-chart-readout')).toContainText('+$270.00');
 const growth=rail(page);await expect(growth.getByRole('checkbox',{name:'Custom exception',exact:true})).not.toBeChecked();await expect(growth.getByRole('checkbox',{name:'Scheduled employer RSUs',exact:true})).toHaveCount(0);await expect(growth).toContainText('Scheduled');
 const comparison=page.getByRole('switch',{name:'Show applied plan',exact:true});await comparison.focus();await comparison.press('Space');await expect(comparison).not.toBeChecked();await expect(page.locator('.growth-chart [data-series="applied"] circle')).toBeHidden();await comparison.press('Space');await expect(comparison).toBeChecked();await expect(page.locator('.growth-chart [data-series="applied"] circle')).toBeVisible();
 await growth.getByRole('button',{name:'Apply growth changes',exact:true}).click();
 await expect.poll(async()=>(await readActivePlan(page)).revision).toBe(1);
 const saved=await readActivePlan(page);expect(saved.growthAssumptions).toEqual({stocksBps:770,propertyBps:300});
 expect(saved.accounts[0]).toMatchObject({growthSource:'stocks-default',annualGrowthBps:500});expect(saved.accounts[1]).toEqual(original.accounts[1]);expect(saved.accounts[2]).toEqual(original.accounts[2]);
 expect(saved.properties[0]).toMatchObject({appreciationSource:'property-default',appreciationBps:100,appreciationOverrides:[{year:2026,rateBps:0}]});
 expect(saved).not.toHaveProperty('growthDraft');expect(saved).not.toHaveProperty('growthChart');
 await page.reload();expect(await readActivePlan(page)).toEqual(saved);await expect(page.locator('.overview-source')).toContainText('Applied');
 await page.getByLabel('Chart year',{exact:true}).selectOption('2026');await expect(page.getByTestId('balance-2026-property')).toHaveText('$100,000.00');
});

test('retains separate record and growth drafts while scenario switches and replacement cancel obsolete ownership',async({page})=>{
 const original=growthPlan();await preloadWorkspace(page,original);const baseline=(await readWorkspace(page)).baselineScenarioId;
 await page.getByRole('button',{name:'Fork scenario',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('Scenario name',{exact:true}).fill('Growth experiment');await dialog.getByRole('button',{name:'Create scenario',exact:true}).click();await expect(dialog).not.toBeVisible();
 const experiment=(await readWorkspace(page)).activeScenarioId;await configure(page);
 await openRecord(page,{kind:'record',section:'accounts',recordId:'custom'});const amount=page.getByLabel('Account opening balance ($)',{exact:true});await amount.fill('6000.00');
 await rail(page).getByRole('button',{name:'Edit growth assumptions',exact:true}).click();await expect(page.locator('[data-active-editor]')).toHaveCount(0);await ready(page);
 const input=rail(page).getByLabel('Stock account growth (%)',{exact:true});await input.fill('9.00');
 await switchScenario(page,baseline);await expect(page.locator('.overview-source')).toContainText('Applied');expect(await readActivePlan(page)).toEqual(original);
 await switchScenario(page,experiment);await expect(page.locator('.overview-source')).toContainText('Applied');await expect(input).toHaveValue('9.00');
 await rail(page).getByRole('button',{name:'Edit growth assumptions',exact:true}).click();await ready(page);
 await openRecord(page,{kind:'record',section:'accounts',recordId:'custom'});await expect(amount).toHaveValue('6000.00');
 await rail(page).getByRole('button',{name:'Edit growth assumptions',exact:true}).click();await input.fill('11.00');
 await replaceScenarioFromJson(page,JSON.stringify(original));expect(await readActivePlan(page)).toEqual(original);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.locator('.overview-source')).toContainText('Applied');await expect(rail(page).getByRole('button',{name:'Apply growth changes',exact:true})).toBeDisabled();
 await expect(page.getByTestId('draft-status')).toBeEmpty();
});

test('keeps 200% text, both theme contrasts and detailed reports reachable',async({page})=>{
 await page.setViewportSize({width:390,height:844});await preloadWorkspace(page,makeAduPlan());
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
 for(const theme of ['dark','light'] as const){const settings=await openSettings(page);await settings.getByLabel('Appearance',{exact:true}).selectOption(theme);await page.getByRole('button',{name:'Settings',exact:true}).click();await expectFits(page,page.getByRole('img',{name:'Net worth over time',exact:true}));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expectTextContrast(page.locator('.growth-chart-source'));await expectTextContrast(page.locator('.growth-chart-readout dt').first());await expectTextContrast(page.locator('.growth-chart-axis').first());}
 await page.getByLabel('Table view',{exact:true}).selectOption('financial-overview');await expect(page.getByRole('table',{name:'Annual financial overview',exact:true})).toBeVisible();
 await page.getByText('Forecast charts',{exact:true}).click();await expect(page.getByRole('img',{name:'Income, expenses and cash flow',exact:true})).toBeVisible();
 await openForecastDetails(page);await page.getByRole('button',{name:'Tax explanation for 2026',exact:true}).click();await expect(page.getByRole('button',{name:'Hide tax explanation for 2026',exact:true})).toHaveAttribute('aria-expanded','true');
 await page.locator('summary').filter({hasText:/^Applied project comparison$/}).click();await expect(page.getByRole('heading',{name:'ADU build versus no build · 2028',exact:true})).toBeVisible();
 const settings=await openSettings(page);await settings.getByText('Backups and recovery',{exact:true}).click();await expect(settings.getByRole('button',{name:'Export workspace backup',exact:true})).toBeVisible();
});

test('records worker responsiveness on a synthetic 30-year salary, stock, property and ADU plan',async({page},testInfo)=>{
 const fixture=makeAduPlan({horizonYears:30,growthAssumptions:{stocksBps:700},salaries:[{id:'salary',name:'Synthetic salary',ownerId:'owner-a',employerId:'employer',annualGrossCents:15000000,startDate:'2026-01-01',annualRaiseBps:0,raiseMonth:1,raiseDay:1,changes:[]}],accounts:[{...growthPlan().accounts[0]!,growthSource:'stocks-default'}]});
 await preloadWorkspace(page,fixture);const before=await readActivePlan(page),input=rail(page).getByLabel('Stock account growth (%)',{exact:true});
 const observation=await input.evaluate(node=>{
  const input=node as HTMLInputElement,start=performance.now();input.value='8.00';input.dispatchEvent(new Event('input',{bubbles:true}));
  return {inputValue:input.value,inputFeedbackMs:performance.now()-start,status:document.querySelector('[data-growth-status]')?.getAttribute('data-growth-status'),source:document.querySelector('.overview-source')?.textContent,startedAt:performance.now()};
 });
 expect(observation.inputValue).toBe('8.00');expect(observation.status).toBe('pending');expect(observation.source).toContain('Updating');
 await ready(page);const completionMs=await page.evaluate(start=>performance.now()-start,observation.startedAt);
 expect(await readActivePlan(page)).toEqual(before);await expect(page.locator('.overview-source')).toContainText('Preview');
 const evidence=JSON.stringify({...observation,completionMs,years:30,browser:page.context().browser()?.version()},null,2);
 await testInfo.attach('growth-responsiveness.json',{body:evidence,contentType:'application/json'});
 await mkdir('/tmp/lifelook-growth-workspace',{recursive:true});await writeFile('/tmp/lifelook-growth-workspace/responsiveness.json',evidence);
});
