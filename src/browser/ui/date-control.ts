export interface DateControlOptions {
  readonly label: string;
  readonly field: string;
  readonly kind: 'date' | 'month';
  readonly raw: string;
  onInput(raw: string): void;
  onCommit(): void;
}

let sequence = 0;

/** Native date-only values stay ISO strings; unfinished segments belong to the browser. */
export function mountDateControl(host: HTMLElement, options: DateControlOptions): {
  input: HTMLInputElement;
  update(raw: string): void;
  dispose(): void;
} {
  const group = document.createElement('div');
  group.className = 'date-control';
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.id = `date-${++sequence}`;
  input.type = options.kind;
  input.name = options.field;
  input.dataset.field = options.field;
  input.dataset.fieldKind = options.kind;
  input.dataset.fieldLabel = options.label;
  input.value = options.raw;
  label.htmlFor = input.id;
  label.textContent = options.label;
  const guidance = document.createElement('small');
  guidance.id = `${input.id}-format`;
  guidance.className = 'date-format-hint';
  guidance.textContent = options.kind === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM';
  input.dataset.hintIds = guidance.id;
  input.setAttribute('aria-describedby', guidance.id);
  group.append(label, input, guidance);
  host.append(group);
  let disposed = false, notified = input.value, committed = input.value;
  const publish = () => {
    const raw = input.value;
    if (raw === notified) return;
    notified = raw;
    options.onInput(raw);
  };
  const onInput = () => {
    if (disposed || !input.isConnected) return;
    // Native invalid/unfinished dates expose an empty value, never a partial ISO date.
    notified = input.value;
    options.onInput(notified);
  };
  const commit = () => {
    if (disposed || !input.isConnected) return;
    publish();
    if (input.value === committed) return;
    committed = input.value;
    options.onCommit();
    input.dispatchEvent(new CustomEvent('financial-input-commit', {bubbles: true}));
  };
  const onBlur = () => queueMicrotask(commit);
  input.addEventListener('input', onInput);
  input.addEventListener('change', commit);
  input.addEventListener('blur', onBlur);
  return {
    input,
    update(raw) {
      if (disposed || document.activeElement === input) return;
      input.value = raw;
      notified = committed = input.value;
    },
    dispose() {
      disposed = true;
      input.removeEventListener('input', onInput);
      input.removeEventListener('change', commit);
      input.removeEventListener('blur', onBlur);
    },
  };
}
