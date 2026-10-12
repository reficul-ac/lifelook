import type {PlanDocument} from '../../src/engine';
import {createDisclosureController} from '../../src/browser/disclosures';
import type {IssueViewContext,ReviewTarget} from '../../src/browser/issue-presentation';
import {makePlan} from './plans';
export function mountPresentation(plan:PlanDocument=makePlan()):{root:HTMLElement;context:IssueViewContext;reviews:ReviewTarget[]}{
  const root=document.createElement('main');document.body.replaceChildren(root);const reviews:ReviewTarget[]=[];
  const context:IssueViewContext={disclosures:createDisclosureController(root),readState:()=>({savedPlan:plan,drafts:{}}),review:target=>{reviews.push(target);context.disclosures.closeWithin(root,false);}};
  return {root,context,reviews};
}
