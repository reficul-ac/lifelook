import {renderField,renderHistory,type FieldContext} from '../fields';
import {renderEditorGroup} from '../ui/editor-groups';
import type {WorkspaceController} from '../state';
import {changeAccountType,renderRsuFields} from './rsu';

export function renderAccountFields(body:HTMLElement,controller:WorkspaceController,ctx:FieldContext):void {
  const plan=controller.getState().savedPlan,owners=plan.household.filers.map(f=>({value:f.id,label:f.name}));

    renderField(body, ctx, ['name'], 'Account name'); renderField(body, ctx, ['ownerId'], 'Account owner', { kind: 'select', options: owners });
    const typeContext:FieldContext={...ctx,get draft(){return ctx.draft;},onChange(_path,value){changeAccountType(controller,ctx,value);}};
    renderField(body, typeContext, ['type'], 'Account type', { kind: 'select', options: [{ value: 'taxable-brokerage', label: 'Taxable brokerage' }, { value: 'traditional-401k', label: 'Traditional 401(k)' }, { value: 'roth-401k', label: 'Roth 401(k)' }, { value: 'traditional-ira', label: 'Traditional IRA' }, { value: 'roth-ira', label: 'Roth IRA' },{value:'rsu',label:'Employer RSUs'}], refresh: true });
    if(ctx.draft.value.type==='rsu')renderRsuFields(body,controller,ctx);
    else{
      renderField(body, ctx, ['openingBalanceCents'], 'Account opening balance ($)', { kind: 'money',hint:`Balance on January 1, ${plan.startYear}.` });
      renderField(body, ctx, ['annualGrowthBps'], 'Effective annual account return (%)', { kind: 'rate',slider:{minUnits:-1000,maxUnits:2000,stepUnits:25}, hint: 'Deposits grow from the following month.',help:'An effective annual return becomes monthly compounded growth. Taxable account value growth is assumed unrealized and excludes separately entered cash dividends or interest.' });
    }
    const basis=(root:HTMLElement)=>{
    if (ctx.draft.value.type === 'taxable-brokerage') renderHistory(root, ctx, ['openingTaxableBasis'], 'Investment cost basis at forecast start ($)', { kind: 'money', hint: `The amount paid for investments still held on January 1, ${plan.startYear}, rather than their market value. Unknown basis uses a labeled zero-basis planning assumption for ADU construction funding; enter 0 only if confirmed.` });
    if (ctx.draft.value.type === 'traditional-ira') renderHistory(root, ctx, ['openingIraBasis'], 'After-tax IRA basis at forecast start ($)', { kind: 'money', hint: 'Different from account balance; enter 0 only if confirmed.' });

    };
    if(ctx.memory&&['taxable-brokerage','traditional-ira'].includes(String(ctx.draft.value.type)))renderEditorGroup(body,{id:'basis',label:'Tax basis',advanced:true,summary:()=>{const history=ctx.draft.value.type==='taxable-brokerage'?ctx.draft.value.openingTaxableBasis:ctx.draft.value.openingIraBasis;return history&&typeof history==='object'&&'known' in history&&history.known?'Entered history':'Unknown history';}},ctx.memory,basis);else basis(body);
}
