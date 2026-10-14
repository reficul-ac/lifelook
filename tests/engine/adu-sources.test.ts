import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { aduPlanningProvenance, maxAssessmentGrowthBps } from '../../src/engine/rules/adu-planning-v1';
import { loadRuleSet } from '../../src/engine/rules/registry';
it('backs the assessment cap and tax method with reviewed original source bytes',()=>{
  const manifest=JSON.parse(readFileSync('sources/manifest.json','utf8'));
  for(const id of ['boe-new-construction','boe-supplemental-assessment','boe-pub29','fannie-adu-appraisal','fannie-comparable-adjustments','usc-168-current','cfr-263a-1','cfr-263a-8','cfr-263a-12']){
    const source=manifest.sources.find((s:{id:string})=>s.id===id);expect(source).toBeDefined();const bytes=readFileSync(`sources/${source.snapshot}`);expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);expect(bytes.length).toBe(source.bytes);expect(source.retrievedOn).toBe('2026-10-13');expect(bytes.toString('utf8')).not.toMatch(/Checking your browser|unblock.federalregister.gov/);
  }
  expect(maxAssessmentGrowthBps.value).toBe(200);expect(maxAssessmentGrowthBps.status).toBe('verified');expect(maxAssessmentGrowthBps.sources[0]!.snapshot).toBe('2026/boe-pub29.pdf');
  const provenance=aduPlanningProvenance(2028);expect(provenance.some(p=>p.status==='verified'&&p.sources.some(s=>s.includes('168')))).toBe(true);expect(provenance.some(p=>p.status==='projected'&&p.assumptions.some(s=>s.includes('valuation')))).toBe(true);expect(loadRuleSet().version).toBe('us-ca-2026.4');
});
