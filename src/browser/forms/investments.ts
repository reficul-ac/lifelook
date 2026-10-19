import {mountCashFlowAllocationEditor} from './cash-flow-allocation';
import type {IssueViewContext} from '../issue-presentation';
import type {FormRenderOptions} from '../record-form';
import {renderRecordSection} from '../fields';
import type {WorkspaceController} from '../state';
import {renderAccountFields} from './account-fields';
import {renderContributionFields} from './contribution-fields';

export function renderInvestmentsForm(root:HTMLElement,controller:WorkspaceController,ui?:IssueViewContext,options?:FormRenderOptions):void {
  root.replaceChildren();const accounts=document.createElement('section'),contributions=document.createElement('section');root.append(accounts,contributions);
  renderRecordSection(accounts,controller,'accounts','Account',(body,context)=>renderAccountFields(body,controller,context),undefined,ui,undefined,options);
  renderRecordSection(contributions,controller,'contributions','Contribution',(body,context)=>renderContributionFields(body,controller,context),undefined,ui,undefined,options);
}
export const mountInvestmentAllocation=mountCashFlowAllocationEditor;
