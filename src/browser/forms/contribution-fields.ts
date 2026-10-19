import {button,element,renderField,type FieldContext} from '../fields';
import {fieldMemory,swapMode} from '../record-ui-state';
import type {RawObject,WorkspaceController} from '../state';

export function renderContributionFields(body:HTMLElement,controller:WorkspaceController,ctx:FieldContext):void {
  const plan=controller.getState().savedPlan;

    renderField(body, ctx, ['accountId'], 'Contribution account', { kind: 'select', options: [{ value: '', label: 'Choose a saved account' }, ...plan.accounts.filter(a=>a.type!=='rsu').map(a => ({ value: a.id, label: a.name }))], refresh: true });
    if(ctx.requestPrerequisite)body.append(button('Add contribution account',()=>ctx.requestPrerequisite!({section:'accounts',defaults:{ownerId:plan.household.filers[0].id},link(origin,account){return {...origin,accountId:account.id};}})));
    else if(!plan.accounts.some(account=>account.type!=='rsu'))body.append(element('p','Apply an account in Accounts before selecting it for contributions.'));
    renderField(body, ctx, ['priority'], 'Contribution priority', { kind: 'integer', hint: 'Lower numbers receive available contribution limits first.',help:'Rules share the owner’s legal limits; ties follow stable record order. Contribution eligibility does not establish cash affordability.' });
    renderField(body, ctx, ['startDate'], 'Contribution start date', { kind: 'date' }); renderField(body, ctx, ['endDate'], 'Contribution end date', { kind: 'date', optional: true,hint:'Includes this date. Blank means no end.' });
    const choice: FieldContext = { ...ctx, get draft() { return ctx.draft; }, onChange(_p, value) { const current=ctx.draft.value.amount as RawObject;ctx.onChange(['amount'],swapMode(fieldMemory(ctx),'contribution-amount',String(current.kind),String(value),current,value==='fixed'?{kind:'fixed',monthlyCents:''}:{kind:'salary-percent',salaryId:plan.salaries[0]?.id??'',percentBps:''})); } };
    renderField(body, choice, ['amount', 'kind'], 'Contribution amount mode', { kind: 'select', options: [{ value: 'fixed', label: 'Monthly amount' }, { value: 'salary-percent', label: '% of gross salary' }], refresh: true });
    if ((ctx.draft.value.amount as { kind?: string })?.kind === 'fixed') renderField(body, ctx, ['amount', 'monthlyCents'], 'Monthly contribution ($)', { kind: 'money' });
    else {
      renderField(body, ctx, ['amount', 'salaryId'], 'Contribution salary', { kind: 'select', options: [{ value: '', label: 'Choose a salary' }, ...plan.salaries.map(s => ({ value: s.id, label: s.name }))] });
      if(ctx.requestPrerequisite)body.append(button('Add contribution salary',()=>ctx.requestPrerequisite!({section:'salaries',defaults:{ownerId:plan.accounts.find(account=>account.id===ctx.draft.value.accountId)?.ownerId??plan.household.filers[0].id},link(origin,salary){return {...origin,amount:{...origin.amount as RawObject,salaryId:salary.id}};}})));
      renderField(body, ctx, ['amount', 'percentBps'], 'Salary contribution (%)', { kind: 'rate' });
    }
    const account = plan.accounts.find(a => a.id === ctx.draft.value.accountId);
    if (account?.type === 'traditional-401k' || account?.type === 'roth-401k') {renderField(body, ctx, ['sponsoringSalaryId'], 'Sponsoring salary', { kind: 'select', options: [{ value: '', label: 'Choose the sponsoring employer’s salary' }, ...plan.salaries.filter(s => s.ownerId === account.ownerId).map(s => ({ value: s.id, label: s.name }))], hint: 'Use this account owner’s sponsoring employer salary.' });
      if(ctx.requestPrerequisite)body.append(button('Add sponsoring salary',()=>ctx.requestPrerequisite!({section:'salaries',defaults:{ownerId:account.ownerId},link(origin,salary){return {...origin,sponsoringSalaryId:salary.id};}})));
    }

}
