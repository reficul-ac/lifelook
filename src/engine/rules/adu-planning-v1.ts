import type { RuleProvenance } from '../model/results';
import type { RuleSource, RuleValue } from './types';
export const ADU_PLANNING_MODEL_VERSION='adu-construction.1';
const source=(id:string,url:string,snapshot:string,publicationYear:number,publicationDate:string|null=null):RuleSource=>({id,url,snapshot,publicationYear,publicationDate});
const boe=source('boe-pub29','https://www.boe.ca.gov/proptaxes/pdf/pub29.pdf','2026/boe-pub29.pdf',2025,'2025-03');
export const maxAssessmentGrowthBps:RuleValue<number>=Object.freeze<RuleValue<number>>({value:200,publicationYear:2025,applicableYear:2026,effectiveFrom:'2026-01-01',reviewDate:'2026-10-13',status:'verified',sources:[boe],assumptions:[],indexing:{kind:'fixed'},transitions:[]});
export function aduPlanningProvenance(year:number):readonly RuleProvenance[] {
  const base={ruleVersion:ADU_PLANNING_MODEL_VERSION,baselineYear:2026,applicableYear:year};
  return [
    {...base,status:'verified',sources:['https://uscode.house.gov/us/usc/119-118/t26/s168/','https://www.irs.gov/publications/p527','https://www.irs.gov/publications/p551','https://www.ftb.ca.gov/forms/2025/2025-3885a-instructions.html',boe.url,
      ...[1,8,12].map(n=>`https://www.govinfo.gov/content/pkg/CFR-2025-title26-vol4/xml/CFR-2025-title26-vol4-sec1-263A-${n}.xml`),'https://www.govinfo.gov/content/pkg/FR-2025-10-02/html/2025-19279.htm'],assumptions:[]},
    {...base,status:'projected',sources:['https://www.boe.ca.gov/proptaxes/newconstructionproperty.htm','https://www.boe.ca.gov/proptaxes/supplemental-assessment/','https://guide-selling.fanniemae.com/sel/b4-1.3-05/improvements-section-appraisal-report','https://guide-selling.fanniemae.com/sel/b4-1.3-09/adjustments-comparable-sales'],assumptions:[
      'Completion valuation, area, appreciation, assessed growth and bill timing are entered planning assumptions; an assumed square-foot rate is not an appraisal.',
      'Completion value posts at month end after existing-home appreciation; new value begins appreciating the following month.',
      'Draws occur at the beginning of the entered month; cash interest and payments settle at month end.',
      ...(year>2026?['Future years continue the sourced ordinary residential recovery method and supported, explicitly confirmed tax treatment.']:[]),
    ]},
  ];
}
