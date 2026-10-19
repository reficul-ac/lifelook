import type {EditTarget} from './edit-types';
import type {FieldContext} from './fields';
import type {RawObject} from './state';

export interface RecordEditorMemory {
  step: string;
  openGroups: Set<string>;
  touched: Set<string>;
  attempted: boolean;
  modes: Map<string, RawObject>;
  scrollTop: number;
  focus: {field: string; start: number | null; end: number | null} | null;
}
export function createRecordEditorMemory(): RecordEditorMemory {
  return {step: 'basics', openGroups: new Set(), touched: new Set(), attempted: false, modes: new Map(), scrollTop: 0, focus: null};
}
export function editTargetKey(target: EditTarget): string {
  return target.kind === 'allocation' ? 'allocation' : `${target.section}:${target.recordId}`;
}
export function swapMode(memory: RecordEditorMemory, key: string, from: string, to: string, current: RawObject, fallback: RawObject): RawObject {
  memory.modes.set(`${key}:${from}`, structuredClone(current));
  return structuredClone(memory.modes.get(`${key}:${to}`) ?? fallback);
}
const memories = new WeakMap<FieldContext, RecordEditorMemory>();
export function fieldMemory(context: FieldContext): RecordEditorMemory {
  if (context.memory) return context.memory;
  let memory = memories.get(context);
  if (!memory) {memory = createRecordEditorMemory(); memories.set(context, memory);}
  return memory;
}
