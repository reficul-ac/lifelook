import {expect,it} from 'vitest';
import {resolveRetirementDistributions,type DistributionYearInput,type DistributionYearResult} from '../../src/engine/retirement/distributions';
import {depositRetirementAccount,compileRetirementDiversification,type DistributionAccountState} from '../../src/engine/retirement/account-ledger';
import {resolveYearRules} from '../../src/engine/rules/projection';
import {loadRuleSet} from '../../src/engine/rules/registry';
import {initialTaxState} from '../../src/engine/model/tax-state';
import {makeRetirementDefinition,makeRetirementPlan} from '../helpers/retirement';
import {loadReferences,assertReference} from '../helpers/references';
const source=makeRetirementPlan(),r=resolveYearRules(loadRuleSet(),2026,source.taxPolicy);if(r.status!=='available')throw Error('rules');const rules=r.value;
const broker=(overrides:Partial<DistributionAccountState>={}):DistributionAccountState=>({accountId:'broker',ownerId:'owner-a',type:'taxable-brokerage',balanceExact:'10000000',basis:{known:true,value:6000000},...overrides});
const input=(accounts:readonly DistributionAccountState[],legs:DistributionYearInput['proposedLegs']):DistributionYearInput=>({year:2026,rules,openingAccounts:accounts,proposedLegs:legs,openingTaxState:initialTaxState(source),iraBasisByOwner:{},yearEndIraValuesByOwner:{},ownerBirthDates:{'owner-a':{known:true,value:'1960-01-01'}}});
const leg=(accountId='broker',grossCents=1000000,eventId='draw')=>({eventId,accountId,date:'2026-01-31',grossCents,purpose:'recurring' as const});
it.each(loadReferences<Omit<DistributionYearInput,'rules'>,DistributionYearResult>('retirement-distributions'))('$id',c=>{const value={...c.input,rules},before=structuredClone(value);assertReference(resolveRetirementDistributions(value),c.expected,c.toleranceCents);expect(value).toEqual(before);});
it('consumes proportional brokerage basis, then all remaining basis on liquidation',()=>{
 const first=resolveRetirementDistributions(input([broker()],[leg()]));
 expect(first.taxFacts[0]).toMatchObject({grossCents:{status:'available',value:1000000},basisConsumedCents:{status:'available',value:600000},realizedGainCents:{status:'available',value:400000}});
 const next=resolveRetirementDistributions(input(first.closingAccounts,[leg('broker',9000000,'liquidation')]));
 expect(next.closingAccounts[0]).toMatchObject({balanceExact:'0',basis:{known:true,value:0}});expect(next.taxFacts[0]!.basisConsumedCents).toEqual({status:'available',value:5400000});
 const deposited=depositRetirementAccount(next.closingAccounts,'broker',12345);
 expect(deposited[0]).toMatchObject({balanceExact:'12345',basis:{known:true,value:12345}});
});
it('keeps unanswered brokerage history unknown after draws and new known deposits',()=>{
 const result=resolveRetirementDistributions(input([broker({basis:{known:false}})],[leg()]));
 expect(result.closingAccounts[0]!.basis).toEqual({known:false});expect(result.taxFacts[0]!.estimated).toBe(true);
 expect(depositRetirementAccount(result.closingAccounts,'broker',100)[0]).toMatchObject({basis:{known:false},estimatedBasisCents:100});
});
it('uses owner-wide IRA pro-rata basis regardless of which account supplies cash',()=>{
 const accounts=[broker({accountId:'ira-a',type:'traditional-ira',balanceExact:'4000000',basis:{known:false}}),broker({accountId:'ira-b',type:'traditional-ira',balanceExact:'8000000',basis:{known:false}})];
 const setup={...input(accounts,[leg('ira-a',1000000,'a'),leg('ira-b',2000000,'b')]),iraBasisByOwner:{'owner-a':{federal:{known:true as const,value:1500000},california:{known:true as const,value:1000000}}},yearEndIraValuesByOwner:{'owner-a':{status:'available' as const,value:9000000}}};
 const result=resolveRetirementDistributions(setup);
 expect(result.taxFacts.map(f=>f.basisRecoveredCents)).toEqual([{status:'available',value:125000},{status:'available',value:250000}]);
 expect(result.taxFacts.map(f=>f.federalTaxableCents)).toEqual([{status:'available',value:875000},{status:'available',value:1750000}]);
 expect(result.closingTaxState.iraBasisByOwner['owner-a']).toEqual({known:true,value:1125000});
 expect(result.closingTaxState.retirementAccountState!.iraBasisByOwner['owner-a']).toEqual({federal:{known:true,value:1125000},california:{known:true,value:750000}});
 expect(resolveRetirementDistributions({...setup,openingAccounts:[...accounts].reverse(),proposedLegs:[...setup.proposedLegs].reverse()})).toEqual(result);
});
it('diversifies held employer shares once without selling unrelated wrappers or making new wages',()=>{
 const shares=broker({accountId:'shares',type:'rsu',balanceExact:'1000000',basis:{known:true,value:600000}}),traditional=broker({accountId:'ira',type:'traditional-ira',basis:{known:false}}),accounts=[broker(),shares,traditional];
 const legs=compileRetirementDiversification(accounts,'2026-01-01');expect(legs.map(l=>l.accountId)).toEqual(['shares']);
 const result=resolveRetirementDistributions(input(accounts,legs));
 expect(result.taxFacts[0]).toMatchObject({incomeCharacter:'long-term-gain',purpose:'transition',realizedGainCents:{status:'available',value:400000}});
 const reinvested=depositRetirementAccount(result.closingAccounts,'broker',900000);
 expect(reinvested.find(a=>a.accountId==='broker')).toMatchObject({balanceExact:'10900000',basis:{known:true,value:6900000}});
 expect(reinvested.find(a=>a.accountId==='ira')).toEqual(traditional);
 expect(compileRetirementDiversification(reinvested,'2026-01-01')).toEqual([]);
});
it('caps draws at actual balances and rejects duplicate events before consuming basis twice',()=>{
 const result=resolveRetirementDistributions(input([broker({balanceExact:'100',basis:{known:true,value:60}})],[leg('broker',200),leg('broker',200)]));
 expect(result.acceptedSchedule.legs).toHaveLength(1);expect(result.acceptedSchedule.legs[0]).toMatchObject({acceptedGrossCents:100,shortfallCents:100});expect(result.taxFacts[0]!.basisConsumedCents).toEqual({status:'available',value:60});expect(result.issues.some(i=>i.code==='duplicate-distribution-event')).toBe(true);
});
it('honors known after-tax employer-plan basis instead of taxing that principal again',()=>{
 const account=broker({accountId:'plan',type:'traditional-401k',balanceExact:'10000000',basis:{known:true,value:2000000}}),result=resolveRetirementDistributions(input([account],[leg('plan',1000000)]));
 expect(result.taxFacts[0]).toMatchObject({basisRecoveredCents:{status:'available',value:200000},federalTaxableCents:{status:'available',value:800000},incomeCharacter:'ordinary'});
 expect(result.closingAccounts[0]!.basis).toEqual({known:true,value:1800000});
});
it('retains a distinct California brokerage basis without changing gross cash',()=>{
 const account=broker({californiaBasis:{known:true,value:8000000}}),result=resolveRetirementDistributions(input([account],[leg()]));
 expect(result.taxFacts[0]).toMatchObject({grossCents:{status:'available',value:1000000},federalTaxableCents:{status:'available',value:400000},californiaTaxableCents:{status:'available',value:200000}});
});
it('recovers pre1987 California-only IRA basis against federal taxable cash',()=>{
 const account=broker({accountId:'ira',type:'traditional-ira',balanceExact:'500000',basis:{known:false}}),setup={...input([account],[leg('ira',100000)]),iraBasisByOwner:{'owner-a':{federal:{known:true as const,value:100000},california:{known:true as const,value:100000},californiaPre1987Basis:{known:true as const,value:600000}}},yearEndIraValuesByOwner:{'owner-a':{status:'available' as const,value:400000}}};
 const result=resolveRetirementDistributions(setup);
 expect(result.taxFacts[0]).toMatchObject({federalTaxableCents:{status:'available',value:80000},californiaTaxableCents:{status:'available',value:0}});
 expect(result.closingTaxState.retirementAccountState!.iraBasisByOwner['owner-a']!.californiaPre1987Basis).toEqual({known:true,value:520000});
 const unsupported=resolveRetirementDistributions({...setup,iraBasisByOwner:{'owner-a':{...setup.iraBasisByOwner['owner-a'],california:{known:true as const,value:50000}}}});
 expect(unsupported.taxFacts[0]!.federalTaxableCents).toEqual({status:'available',value:80000});
 expect(unsupported.taxFacts[0]!.californiaTaxableCents.status).toBe('needs-data');
});

it('validates explicit California pre1987 owner history in the saved definition',()=>{
 const base=makeRetirementDefinition({},source);
 expect(()=>makeRetirementDefinition({assumptions:{...base.assumptions,owners:[{ownerId:'owner-a',californiaPre1987BasisCents:{known:true,value:600000}}]}},source)).not.toThrow();
});
it('rejects a deposit that overflows market value even when basis is small',()=>{
 expect(()=>depositRetirementAccount([broker({balanceExact:'99999999999999',basis:{known:true,value:0}})],'broker',1)).toThrow(/monetary-overflow/);
});
it('keeps gross cash but locates an invalid year-end IRA value',()=>{
 const account=broker({accountId:'ira',type:'traditional-ira',balanceExact:'12000000',basis:{known:false}}),setup={...input([account],[leg('ira',3000000)]),iraBasisByOwner:{'owner-a':{federal:{known:true as const,value:1500000},california:{known:true as const,value:1500000}}},yearEndIraValuesByOwner:{'owner-a':{status:'available' as const,value:-1}}};
 const fact=resolveRetirementDistributions(setup).taxFacts[0]!;
 expect(fact.grossCents).toEqual({status:'available',value:3000000});expect(fact.federalTaxableCents.status).toBe('needs-data');
});
it('uses monthly growth before accepted withdrawals and keeps reinvestment basis separate',()=>{
 const result=resolveRetirementDistributions({...input([broker()],[leg('broker',1_000_000)]),growthFactorsByAccount:{broker:['1.1',...Array(11).fill('1')]},taxableDeposits:[{accountId:'broker',date:'2026-01-01',amountCents:1_000_000}]});
 expect(result.taxFacts[0]!.basisConsumedCents).toEqual({status:'available',value:578_512});expect(result.closingAccounts[0]).toMatchObject({balanceExact:'11100000',basis:{known:true,value:6_421_488}});
 expect(result.accountMonths?.[0]?.find(a=>a.accountId==='broker')).toMatchObject({openingCents:{status:'available',value:10_000_000},contributionCents:{status:'available',value:1_000_000},growthCents:{status:'available',value:1_100_000},withdrawalCents:{status:'available',value:1_000_000},closingCents:{status:'available',value:11_100_000}});
});
it('uses the accepted growth-adjusted year-end IRA denominator when resolving the complete inventory',()=>{
 const result=resolveRetirementDistributions({...input([broker({accountId:'ira',type:'traditional-ira',balanceExact:'12000000',basis:{known:false}})],[leg('ira',3_000_000)]),growthFactorsByAccount:{ira:['1.1',...Array(11).fill('1')]},resolveCompleteIraInventory:true,iraBasisByOwner:{'owner-a':{federal:{known:true,value:1_500_000},california:{known:true,value:1_500_000}}}});
 expect(result.taxFacts[0]!.basisRecoveredCents).toEqual({status:'available',value:340_909});expect(result.closingAccounts[0]!.balanceExact).toBe('10200000');
});
