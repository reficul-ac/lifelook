import type {PlanDocument,ValidatedPlan} from '../engine';
import type {EditTarget} from './edit-types';
import type {RawObject} from './state';
/** Object ordering is cosmetic; array ordering and absent optional facts are financial input. */
export function equalActiveEdit(left:unknown,right:unknown):boolean {
  if(Object.is(left,right))return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,i)=>equalActiveEdit(value,right[i]));
  const a=left as RawObject,b=right as RawObject,keys=(value:RawObject)=>Object.keys(value).filter(key=>key!=='__draft'&&key!=='revision');
  const ka=keys(a),kb=keys(b);return ka.length===kb.length&&ka.every(key=>Object.hasOwn(b,key)&&equalActiveEdit(a[key],b[key]));
}
function replaceOwned<T extends {readonly id:string}>(base:readonly T[],owned:(record:T)=>boolean,replacements:readonly T[]):T[] {
  const remaining=[...replacements],result:T[]=[];
  for(const row of base){if(!owned(row)){result.push(row);continue;}const index=remaining.findIndex(next=>next.id===row.id);if(index>=0)result.push(...remaining.splice(index,1));}
  return [...result,...remaining];
}
/** Assemble one transaction onto applied inputs, retaining existing transaction order. */
export function buildEditCandidate(base:ValidatedPlan,target:EditTarget,decoded:RawObject):PlanDocument {
  const revision=base.revision+1;
  if(target.kind==='allocation')return {...base,cashFlowAllocation:decoded as unknown as NonNullable<PlanDocument['cashFlowAllocation']>,revision};
  const {section,recordId}=target;
  if(section==='household')return {...base,...decoded,revision};
  if(section==='properties'){
    const rentals=new Set(base.rentals.filter(row=>row.propertyId===recordId).map(row=>row.id));
    return {...base,revision,properties:replaceOwned(base.properties,row=>row.id===recordId,[decoded.property as PlanDocument['properties'][number]]),rentals:replaceOwned(base.rentals,row=>row.propertyId===recordId,decoded.rentals as PlanDocument['rentals']),expenses:replaceOwned(base.expenses,row=>row.propertyId===recordId||!!row.rentalId&&rentals.has(row.rentalId),decoded.expenses as PlanDocument['expenses'])};
  }
  return {...base,revision,[section]:replaceOwned((base[section]??[]) as readonly {id:string}[],row=>row.id===recordId,[decoded as {id:string}])};
}
