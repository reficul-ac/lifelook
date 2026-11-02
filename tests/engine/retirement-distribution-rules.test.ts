import {readFileSync} from 'node:fs';
import {uniformLifeFactorsTenths,jointLifeFactorsTenths} from '../../src/engine/rules/rmd-life-factors';
import {expect,it} from 'vitest';
import {calculateRequiredDistributions,resolveDistributionAccess,type RmdYearInput,type RmdYearRequirement,type DistributionAccessInput} from '../../src/engine/retirement/required-distributions';
import {resolveRetirementDistributions} from '../../src/engine/retirement/distributions';
import type {Available} from '../../src/engine/model/results';
import {resolveYearRules} from '../../src/engine/rules/projection';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {initialTaxState} from '../../src/engine/model/tax-state';
import {makeRetirementDefinition,makeRetirementPlan} from '../helpers/retirement';
import {aduValue} from '../helpers/adu';
import {loadReferences,assertReference} from '../helpers/references';
const source=makeRetirementPlan(),r=resolveYearRules(loadRuleSet(),2026,source.taxPolicy);if(r.status!=='available')throw Error('rules');const rules=r.value;
const access=(changes:Partial<DistributionAccessInput>={}):DistributionAccessInput=>({accountId:'account',ownerId:'owner-a',accountKind:'traditional-ira',date:'2026-01-01',birthDate:{known:true,value:'1976-01-01'},grossCents:2_000_000,federalTaxableCents:{status:'available',value:2_000_000},californiaTaxableCents:{status:'available',value:2_000_000},rules,...changes});
it.each(loadReferences<RmdYearInput,Available<RmdYearRequirement>>('retirement-distribution-rules'))('$id',c=>assertReference(calculateRequiredDistributions(c.input),c.expected,c.toleranceCents));
it('adds federal 10% and California 2.5% to an ordinary early distribution',()=>{
 const result=aduValue(resolveDistributionAccess(access()));expect(result.additionalFederalTaxCents).toEqual({status:'available',value:200000});expect(result.additionalCaliforniaTaxCents).toEqual({status:'available',value:50000});
});
it.each([['2026-06-30',200000],['2026-07-01',0]])('uses the exact half birthday on %s', (date,want)=>{
 expect(aduValue(resolveDistributionAccess(access({birthDate:{known:true,value:'1967-01-01'},date}))).additionalFederalTaxCents).toEqual({status:'available',value:want});
});
it('keeps the employer age55 exception separate from IRA distributions',()=>{
 const changes={birthDate:{known:true as const,value:'1971-12-31'},separationDate:{known:true as const,value:'2026-01-01'}};
 expect(aduValue(resolveDistributionAccess(access({...changes,accountKind:'traditional-401k'}))).additionalFederalTaxCents).toEqual({status:'available',value:0});
 expect(aduValue(resolveDistributionAccess(access({...changes,accountKind:'traditional-ira'}))).additionalFederalTaxCents).toEqual({status:'available',value:200000});
});
it('draws Roth contributions then seasoned FIFO conversions without inventing earnings',()=>{
 const value=access({accountKind:'roth-ira',grossCents:2_500_000,rothHistory:{contributionBasis:{known:true,value:2_000_000},firstContributionYear:{known:true,value:2010},conversionLayers:[{year:2019,taxableCents:500000,nontaxableCents:0}]}}),before=structuredClone(value),result=aduValue(resolveDistributionAccess(value));
 expect(result.federalTaxableCents).toEqual({status:'available',value:0});expect(result.additionalFederalTaxCents).toEqual({status:'available',value:0});
 expect(result.closingRothHistory).toMatchObject({contributionBasis:{known:true,value:0},conversionLayers:[{year:2019,taxableCents:0,nontaxableCents:0}]});expect(value).toEqual(before);
});
it('recaptures unseasoned taxable Roth conversion basis without taxing it as earnings',()=>{
 const result=aduValue(resolveDistributionAccess(access({accountKind:'roth-ira',grossCents:500000,rothHistory:{contributionBasis:{known:true,value:0},firstContributionYear:{known:true,value:2010},conversionLayers:[{year:2024,taxableCents:500000,nontaxableCents:0}]}})));
 expect(result.federalTaxableCents).toEqual({status:'available',value:0});expect(result.additionalFederalTaxCents).toEqual({status:'available',value:50000});
});
it('uses designated-Roth pro-rata basis and its own qualification clock',()=>{
 const result=aduValue(resolveDistributionAccess(access({accountKind:'roth-401k',grossCents:1_000_000,accountBalanceCents:10_000_000,basis:{known:true,value:6_000_000},rothHistory:{contributionBasis:{known:true,value:6_000_000},firstContributionYear:{known:true,value:2024},conversionLayers:[]}})));
 expect(result.federalTaxableCents).toEqual({status:'available',value:400000});expect(result.additionalFederalTaxCents).toEqual({status:'available',value:40000});
 const qualified=aduValue(resolveDistributionAccess(access({accountKind:'roth-401k',birthDate:{known:true,value:'1960-01-01'},accountBalanceCents:10_000_000,basis:{known:true,value:6_000_000},rothHistory:{contributionBasis:{known:true,value:6_000_000},firstContributionYear:{known:true,value:2019},conversionLayers:[]}})));
 expect(qualified.federalTaxableCents).toEqual({status:'available',value:0});
});
it('uses joint factors for a younger sole-beneficiary spouse and clamps each age independently',()=>{
 const base=loadReferences<RmdYearInput,Available<RmdYearRequirement>>('retirement-distribution-rules')[1]!.input;
 const owner={...base.owners[0]!,spouseBirthDate:{known:true as const,value:'1971-01-01'}},account={...base.accounts[0]!,soleSpouseBeneficiary:{known:true as const,value:true},priorDecemberBalanceCents:{status:'available' as const,value:25_300_000}};
 const joint=aduValue(calculateRequiredDistributions({...base,owners:[owner],accounts:[account]}));expect(joint.accounts[0]).toMatchObject({divisorTenths:{status:'available',value:253},requiredCents:{status:'available',value:1_000_000}});
 const oldest=aduValue(calculateRequiredDistributions({...base,year:2095,owners:[{...owner,spouseBirthDate:{known:true,value:'1976-01-01'}}],accounts:[{...account,priorDecemberBalanceCents:{status:'available',value:110000}}]}));
 expect(oldest.accounts[0]).toMatchObject({divisorTenths:{status:'available',value:11},requiredCents:{status:'available',value:100000}});
});
it('separates IRA and employer-plan aggregation and keeps unknown owner ages located',()=>{
 const base=loadReferences<RmdYearInput,Available<RmdYearRequirement>>('retirement-distribution-rules')[1]!.input,account=base.accounts[0]!;
 const result=aduValue(calculateRequiredDistributions({...base,accounts:[account,{...account,accountId:'ira-b'},{...account,accountId:'plan-a',type:'traditional-401k'},{...account,accountId:'plan-b',type:'traditional-401k'}]}));
 expect(result.groups.map(g=>g.accountIds.length).sort()).toEqual([1,1,2]);
 const unknown=aduValue(calculateRequiredDistributions({...base,owners:[{...base.owners[0]!,birthDate:{known:false}}],accounts:[account,{...account,accountId:'roth',type:'roth-ira'}]}));
 expect(unknown.accounts[0]!.requiredCents.status).toBe('needs-data');expect(unknown.accounts[1]!.requiredCents).toEqual({status:'available',value:0});
});
it('resolves early additional tax through the existing distribution entry point',()=>{
 const result=resolveRetirementDistributions({year:2026,rules,openingAccounts:[{accountId:'ira',ownerId:'owner-a',type:'traditional-ira',balanceExact:'2000000',basis:{known:false}}],proposedLegs:[{eventId:'early',accountId:'ira',date:'2026-01-01',grossCents:2000000,purpose:'recurring'}],openingTaxState:initialTaxState(source),iraBasisByOwner:{'owner-a':{federal:{known:true,value:0},california:{known:true,value:0},californiaPre1987Basis:{known:true,value:0}}},yearEndIraValuesByOwner:{'owner-a':{status:'available',value:0}},ownerBirthDates:{'owner-a':{known:true,value:'1976-01-01'}}});
 expect(result.taxFacts[0]!.additionalFederalTaxCents).toEqual({status:'available',value:200000});expect(result.taxFacts[0]!.additionalCaliforniaTaxCents).toEqual({status:'available',value:50000});
});
it('keeps known owner-wide Roth contributions available across accounts with unanswered history',()=>{
 const h=(value:number)=>({contributionBasis:{known:true as const,value},firstContributionYear:{known:true as const,value:2010},conversionLayers:[]});
 const state={...initialTaxState(source),retirementAccountState:{iraBasisByOwner:{},rothByAccount:{a:h(0),b:h(1000000),c:{...h(0),contributionBasis:{known:false as const}}}}};
 const input={year:2026,rules,openingAccounts:['a','b','c'].map(accountId=>({accountId,ownerId:'owner-a',type:'roth-ira' as const,balanceExact:'2000000',basis:{known:false as const}})),proposedLegs:[{eventId:'draw',accountId:'a',date:'2026-01-01',grossCents:1000000,purpose:'recurring' as const}],openingTaxState:state,iraBasisByOwner:{},yearEndIraValuesByOwner:{},ownerBirthDates:{'owner-a':{known:true as const,value:'1976-01-01'}}},before=structuredClone(input),result=resolveRetirementDistributions(input);
 expect(result.taxFacts[0]).toMatchObject({federalTaxableCents:{status:'available',value:0},additionalFederalTaxCents:{status:'available',value:0},estimated:true});
 expect(result.closingTaxState.retirementAccountState!.rothByAccount.b!.contributionBasis).toEqual({known:true,value:0});expect(result.closingTaxState.retirementAccountState!.rothByAccount.c!.contributionBasis).toEqual({known:false});expect(input).toEqual(before);
});
it('keeps inherited Roth treatment unavailable instead of applying the owner-lifetime exemption',()=>{
 const base=loadReferences<RmdYearInput,Available<RmdYearRequirement>>('retirement-distribution-rules')[1]!.input;
 const result=aduValue(calculateRequiredDistributions({...base,accounts:[{...base.accounts[0]!,type:'roth-ira',inherited:true}]}));
 expect(result.accounts[0]!.requiredCents.status).toBe('needs-data');
});
it('does not calculate distributions for a future birth date',()=>{
 expect(resolveDistributionAccess(access({birthDate:{known:true,value:'2030-01-01'}})).status).toBe('needs-data');
 const base=loadReferences<RmdYearInput,Available<RmdYearRequirement>>('retirement-distribution-rules')[1]!.input,result=aduValue(calculateRequiredDistributions({...base,owners:[{...base.owners[0]!,birthDate:{known:true,value:'2040-01-01'}}]}));
 expect(result.accounts[0]!.requiredCents.status).toBe('needs-data');
});
it('keeps a zero draw independent of unknown age or Roth history',()=>{
 const result=aduValue(resolveDistributionAccess(access({accountKind:'roth-ira',birthDate:{known:false},grossCents:0})));
 expect(result.federalTaxableCents).toEqual({status:'available',value:0});expect(result.additionalFederalTaxCents).toEqual({status:'available',value:0});
});
it('preserves separate California taxable conversion layers for recapture',()=>{
 const result=aduValue(resolveDistributionAccess(access({accountKind:'roth-ira',grossCents:500000,rothHistory:{contributionBasis:{known:true,value:0},firstContributionYear:{known:true,value:2010},conversionLayers:[{year:2024,taxableCents:500000,nontaxableCents:0,californiaTaxableCents:200000}]}})));
 expect(result.additionalFederalTaxCents).toEqual({status:'available',value:50000});expect(result.additionalCaliforniaTaxCents).toEqual({status:'available',value:5000});
});
it('uses known designated-Roth history when the separate account basis is unanswered',()=>{
 const result=aduValue(resolveDistributionAccess(access({accountKind:'roth-401k',grossCents:1000000,accountBalanceCents:10000000,basis:{known:false},rothHistory:{contributionBasis:{known:true,value:6000000},firstContributionYear:{known:true,value:2010},conversionLayers:[]}})));
 expect(result.federalTaxableCents).toEqual({status:'available',value:400000});
});
it('requires an explicit saved assumption for the reserved birth1959 first-year boundary',()=>{
 const base=loadReferences<RmdYearInput,Available<RmdYearRequirement>>('retirement-distribution-rules')[0]!.input,owner={...base.owners[0]!,birthDate:{known:true as const,value:'1959-01-01'}};
 expect(aduValue(calculateRequiredDistributions({...base,owners:[owner]})).accounts[0]!.requiredCents.status).toBe('needs-data');
 expect(aduValue(calculateRequiredDistributions({...base,owners:[{...owner,rmdAgeAssumption:{known:true,value:73}}]})).accounts[0]!.requiredCents).toEqual({status:'available',value:964706});
 const definition=makeRetirementDefinition({},source);
 expect(()=>makeRetirementDefinition({assumptions:{...definition.assumptions,owners:[{ownerId:'owner-a',rmdAgeAssumption:{known:true,value:73}}]}},source)).not.toThrow();
});
it('consumes all taxable conversion amounts before nontaxable amounts in the same owner tax year',()=>{
 const result=aduValue(resolveDistributionAccess(access({accountKind:'roth-ira',grossCents:500000,rothHistory:{contributionBasis:{known:true,value:0},firstContributionYear:{known:true,value:2010},conversionLayers:[{year:2024,taxableCents:0,nontaxableCents:500000},{year:2024,taxableCents:500000,nontaxableCents:0}]}})));
 expect(result.federalTaxableCents).toEqual({status:'available',value:0});expect(result.additionalFederalTaxCents).toEqual({status:'available',value:50000});
});
it('retains the known current RMD for birth1959 after both possible starting ages',()=>{
 const base=loadReferences<RmdYearInput,Available<RmdYearRequirement>>('retirement-distribution-rules')[1]!.input;
 const result=aduValue(calculateRequiredDistributions({...base,owners:[{...base.owners[0]!,birthDate:{known:true,value:'1959-01-01'}}]}));
 expect(result.accounts[0]!.requiredCents).toEqual({status:'available',value:1037975});
});

it('keeps every stored lifetime factor consistent with the retained regulation table',()=>{
 const xml=readFileSync(new URL('../../sources/2026/cfr-rmd-tables-2025.xml',import.meta.url),'utf8');
 const text=(s:string)=>s.replace(/<[^>]*>/g,'').trim(),tenths=(s:string)=>{const [whole,decimal='0']=s.split('.');return Number(whole)*10+Number(decimal);};
 let compared=0;
 for(const table of xml.matchAll(/<GPOTABLE\b[^>]*>([\s\S]*?)<\/GPOTABLE>/g)){
  const headers=[...table[1]!.matchAll(/<CHED\b[^>]*>([\s\S]*?)<\/CHED>/g)].map(m=>text(m[1]!));
  if(headers[0]!=='Ages'&&headers[0]!=='Age of employee')continue;
  for(const row of table[1]!.matchAll(/<ROW\b[^>]*>([\s\S]*?)<\/ROW>/g)){
   const cells=[...row[1]!.matchAll(/<ENT\b[^>]*>([\s\S]*?)<\/ENT>/g)].map(m=>text(m[1]!)),age=parseInt(cells[0]!);
   if(headers[0]==='Age of employee'){expect(uniformLifeFactorsTenths[age]).toBe(tenths(cells[1]!));compared++;}
   else if(age>=72)for(let i=1;i<cells.length;i++){const spouse=parseInt(headers[i]!);expect(jointLifeFactorsTenths[age]![spouse]).toBe(tenths(cells[i]!));compared++;}
  }
 }
 expect(compared).toBe(5978);
});
