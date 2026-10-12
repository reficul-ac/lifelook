import type { IndexingPolicy, RuleScalar, RuleSource, RuleTransition, RuleValue } from './types.js';

export const fixed: IndexingPolicy = { kind: 'fixed' };
export const indexed = (incrementCents: number, rounding: 'floor' | 'nearest' = 'floor', roundIncreaseOnly = false): IndexingPolicy => ({ kind: 'indexed', incrementCents, rounding, roundIncreaseOnly });
const source = (id: string, url: string, snapshot: string, publicationYear: number, publicationDate: string | null = null): RuleSource => ({ id, url, snapshot, publicationYear, publicationDate });
export const SOURCES = {
  federal: source('irs-rp-2025-32', 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf', '2026/irs-rp-2025-32.pdf', 2025, '2025-10-09'),
  law: source('pl-119-21', 'https://www.congress.gov/119/plaws/publ21/PLAW-119publ21.pdf', '2026/pl-119-21.pdf', 2025, '2025-07-04'),
  planning: source('irs-p505-2026', 'https://www.irs.gov/publications/p505', '2026/irs-p505.html', 2026),
  federalIndex: source('usc-1-2024', 'https://www.govinfo.gov/content/pkg/USCODE-2024-title26/html/USCODE-2024-title26-subtitleA-chap1-subchapA-partI-sec1.htm', '2026/usc-1-2024.html', 2024),
  standardIndex: source('usc-63-2024', 'https://www.govinfo.gov/content/pkg/USCODE-2024-title26/html/USCODE-2024-title26-subtitleA-chap1-subchapB-partI-sec63.htm', '2026/usc-63-2024.html', 2024),
  amtIndex: source('usc-55-2024', 'https://www.govinfo.gov/content/pkg/USCODE-2024-title26/html/USCODE-2024-title26-subtitleA-chap1-subchapA-partVI-sec55.htm', '2026/usc-55-2024.html', 2024),
  california: source('ftb-tax-news-2026-10', 'https://www.ftb.ca.gov/about-ftb/newsroom/tax-news/', '2026/ftb-tax-news.html', 2026, '2026-10'),
  caForm: source('ftb-540-2025', 'https://www.ftb.ca.gov/forms/2025/2025-540-instructions.html', '2025-reference/ftb-540.html', 2025),
  caDeduction: source('ftb-schedule-ca-2025', 'https://www.ftb.ca.gov/forms/2025/2025-540-ca-instructions.html', '2025-reference/ftb-schedule-ca.html', 2025),
  caAmt: source('ftb-schedule-p-2025', 'https://www.ftb.ca.gov/forms/2025/2025-540-p-instructions.html', '2025-reference/ftb-schedule-p.html', 2025),
  caEstimate: source('ftb-540-es-2026', 'https://www.ftb.ca.gov/forms/2026/2026-540-es-instructions.html', '2026/ftb-540-es.html', 2026),
  caMpi: source('ftb-ab1620-analysis-2026', 'https://www.ftb.ca.gov/tax-pros/law/legislation/2025-2026/AB1620-012226.pdf', '2026/ftb-mortgage-insurance-analysis.pdf', 2026, '2026-01-22'),
  caPassive: source('ftb-3801-2025', 'https://www.ftb.ca.gov/forms/2025/2025-3801-instructions.html', '2025-reference/ftb-3801.html', 2025),
  mortgage: source('irs-p936-2025', 'https://www.irs.gov/publications/p936', '2025-reference/irs-p936.html', 2025),
  passive: source('irs-p925-2025', 'https://www.irs.gov/publications/p925', '2025-reference/irs-p925.html', 2025),
  rental: source('irs-p527-2025', 'https://www.irs.gov/publications/p527', '2025-reference/irs-p527.html', 2025),
  qbi: source('irs-qbi', 'https://www.irs.gov/newsroom/qualified-business-income-deduction', '2026/irs-qbi.html', 2026),
  niit: source('irs-tc559', 'https://www.irs.gov/taxtopics/tc559', '2026/irs-niit.html', 2026),
  socialSecurity: source('ssa-cbb', 'https://www.ssa.gov/oact/cola/cbb.html', '2026/ssa-cbb.html', 2026),
  socialSecurityIndex: source('ssa-cbb-formula', 'https://www.ssa.gov/OACT/COLA/cbbdet.html', '2026/ssa-cbb-rounding.html', 2026),
  payroll: source('irs-p15-2026', 'https://www.irs.gov/publications/p15', '2026/irs-p15.html', 2026),
  additionalMedicare: source('irs-tc560', 'https://www.irs.gov/taxtopics/tc560', '2026/irs-additional-medicare.html', 2026),
  sdi: source('edd-rates-2026', 'https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/', '2026/edd-rates.html', 2026),
  retirement: source('irs-notice-2025-67', 'https://www.irs.gov/pub/irs-drop/n-25-67.pdf', '2026/irs-n-2025-67.pdf', 2025, '2025-11-13'),
  catchup: source('irs-catch-up', 'https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-catch-up-contributions', '2026/irs-catch-up.html', 2026),
  catchupIndex: source('irs-final-catch-up-2025-40', 'https://www.irs.gov/irb/2025-40_IRB', '2026/irs-catch-up-final-rule.html', 2025, '2025-09-29'),
  iraIndex: source('usc-219-2024', 'https://www.govinfo.gov/content/pkg/USCODE-2024-title26/html/USCODE-2024-title26-subtitleA-chap1-subchapB-partVII-sec219.htm', '2026/usc-219-2024.html', 2024),
  deferralIndex: source('usc-402-2024', 'https://www.govinfo.gov/link/uscode/26/402', '2026/usc-402.pdf', 2024),
  rothIndex: source('usc-408a-2024', 'https://www.govinfo.gov/link/uscode/26/408A', '2026/usc-408a.pdf', 2024),
  mortgageStatute: source('usc-163-2024', 'https://www.govinfo.gov/link/uscode/26/163', '2026/usc-163.pdf', 2024),
  qbiStatute: source('usc-199a-2024', 'https://www.govinfo.gov/link/uscode/26/199A', '2026/usc-199a.pdf', 2024),
} as const;

export function rule(value: RuleScalar, sources: RuleSource | readonly RuleSource[], indexing: IndexingPolicy = fixed, assumptions: readonly string[] = [], status: 'verified' | 'provisional' = 'verified', transitions: readonly RuleTransition<RuleScalar>[] = []): RuleValue<RuleScalar> {
  const records = Array.isArray(sources) ? sources : [sources as RuleSource];
  return { value, publicationYear: Math.max(...records.map(s => s.publicationYear)), applicableYear: 2026, effectiveFrom: '2026-01-01', reviewDate: '2026-10-12', status, sources: records, assumptions, indexing, transitions };
}
