import type { PlanDocument } from '../engine/model/plan';
import type { Issue } from '../engine/model/results';
import { validatePlan } from '../engine/validation';

export const PLAN_STORAGE_KEY = 'lifelook.foundation.plan.v1';
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export type LoadResult =
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'loaded'; plan: PlanDocument; issues: readonly Issue[] }>
  | Readonly<{ status: 'invalid'; raw: string; issues: readonly Issue[] }>
  | Readonly<{ status: 'read-failed'; issues: readonly Issue[] }>;
export interface SaveResult {
  readonly plan: PlanDocument;
  readonly persisted: boolean;
  readonly issues: readonly Issue[];
}
export interface RestoreResult extends SaveResult { readonly accepted: boolean }

function storageIssue(code: string, explanation: string, resolution: string): Issue {
  return { code, field: 'storage', severity: 'error', explanation, resolution };
}
function parseDocument(json: string) {
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch {
    return { ok: false as const, issues: [storageIssue('invalid-backup-json', 'The document is not valid JSON.', 'Choose a complete LifeLook Foundation JSON backup; the current plan has been retained.')] };
  }
  return validatePlan(raw);
}

/** Never overwrite unreadable or unsupported bytes during load. */
export function loadPlan(storage: StoragePort): LoadResult {
  let raw: string | null;
  try { raw = storage.getItem(PLAN_STORAGE_KEY); }
  catch {
    return { status: 'read-failed', issues: [storageIssue('storage-read-failed', 'The browser could not read the saved plan.', 'Allow site storage or restore a JSON backup. Keep an exported copy of any in-memory edits.')] };
  }
  if (raw === null) return { status: 'missing' };
  const parsed = parseDocument(raw);
  return parsed.ok ? { status: 'loaded', plan: parsed.plan, issues: parsed.issues } : { status: 'invalid', raw, issues: parsed.issues };
}

/** Backup contains inputs only, including their revision and explicit unknowns. */
export function exportPlan(plan: PlanDocument): string { return JSON.stringify(plan, null, 2); }

export function savePlan(storage: StoragePort, plan: PlanDocument): SaveResult {
  const validated = validatePlan(plan);
  if (!validated.ok) return { plan, persisted: false, issues: validated.issues };
  try {
    const json = exportPlan(validated.plan);
    storage.setItem(PLAN_STORAGE_KEY, json);
    return { plan: validated.plan, persisted: true, issues: validated.issues };
  } catch {
    return { plan: validated.plan, persisted: false, issues: [...validated.issues, storageIssue('storage-write-failed', 'This valid plan remains in memory, but the browser could not save it.', 'Download a JSON backup now. Free browser storage or allow site storage before retrying a Save.')] };
  }
}

/** Validate the whole replacement before its single storage write. */
export function restorePlan(json: string, current: PlanDocument, storage: StoragePort): RestoreResult {
  const parsed = parseDocument(json);
  if (!parsed.ok) return { accepted: false, plan: current, persisted: false, issues: parsed.issues };
  return { accepted: true, ...savePlan(storage, parsed.plan) };
}
