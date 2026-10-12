import { existsSync, readFileSync } from 'node:fs';

export interface ReferenceCase<I, O> {
  readonly id: string;
  readonly taxYear: number;
  readonly sources: readonly (string | Readonly<Record<string, unknown>>)[];
  readonly input: I;
  readonly worksheetSteps: readonly string[];
  readonly expected: O;
  readonly toleranceCents: number;
  readonly ruleVersions: readonly string[];
}
export function loadReferences<I = unknown, O = unknown>(suite: string): readonly ReferenceCase<I, O>[] {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(suite)) throw new Error(`Invalid reference suite: ${suite}`);
  const candidates = ['math', 'tax'].map(kind => new URL(`../../fixtures/${kind}/${suite}.json`, import.meta.url)).filter(existsSync);
  if (candidates.length !== 1) throw new Error(`Expected one fixture suite for ${suite}; found ${candidates.length}`);
  const parsed: unknown = JSON.parse(readFileSync(candidates[0]!, 'utf8'));
  const cases = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown }).cases;
  if (!Array.isArray(cases) || cases.length === 0) throw new Error(`Empty or malformed reference suite: ${suite}`);
  const ids = new Set<string>();
  for (const c of cases) {
    if (typeof c !== 'object' || c === null || typeof c.id !== 'string' || ids.has(c.id) || !Number.isInteger(c.taxYear) || !Array.isArray(c.sources) || c.sources.length === 0 || !Array.isArray(c.worksheetSteps) || c.worksheetSteps.length === 0 || !Array.isArray(c.ruleVersions) || !Number.isSafeInteger(c.toleranceCents) || c.toleranceCents < 0 || !Object.hasOwn(c, 'input') || !Object.hasOwn(c, 'expected')) throw new Error(`Incomplete reference metadata in ${suite}`);
    ids.add(c.id);
  }
  return cases as readonly ReferenceCase<I, O>[];
}

export function assertReference<O>(actual: O, expected: O, toleranceCents: number): void {
  if (!Number.isSafeInteger(toleranceCents) || toleranceCents < 0) throw new Error('Reference tolerance must be nonnegative integer cents');
  const fail = (path: string) => { throw new Error(`Reference mismatch at ${path || '<root>'}`); };
  function compare(a: unknown, e: unknown, path: string): void {
    if (typeof e === 'number') {
      if (typeof a !== 'number' || !Number.isFinite(a) || !Number.isFinite(e)) fail(path);
      const monetary = /(?:^|\.)(?:[^.]*Cents|[^.]*CentsBy[^.]+)(?:\.value|\.[^.]+)?$/.test(path);
      if (Math.abs((a as number) - e) > (monetary ? toleranceCents : 0)) fail(path);
      return;
    }
    if (Array.isArray(e)) {
      if (!Array.isArray(a) || a.length !== e.length) fail(path);
      e.forEach((v, i) => compare((a as unknown[])[i], v, `${path}.${i}`));
      return;
    }
    if (e !== null && typeof e === 'object') {
      if (a === null || typeof a !== 'object' || Array.isArray(a)) fail(path);
      const expectedKeys = Object.keys(e).sort();
      const actualKeys = Object.keys(a as object).sort();
      if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) fail(path);
      for (const key of expectedKeys) compare((a as Record<string, unknown>)[key], (e as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      return;
    }
    if (a !== e) fail(path);
  }
  compare(actual, expected, '');
}
