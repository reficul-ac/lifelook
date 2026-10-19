import {parseMoneyInput, parseRateInput} from '../input-parsers';

export interface NumericSliderOptions {
  readonly minUnits: number;
  readonly maxUnits: number;
  readonly stepUnits: number;
}
export interface NumericControlOptions {
  readonly label: string;
  readonly field: string;
  readonly kind: 'money' | 'rate';
  readonly raw: string;
  readonly slider?: NumericSliderOptions;
  onInput(raw: string): void;
  onCommit(): void;
}

/** Strip separators only from complete, correctly grouped decimal input. */
export function normalizeNumericText(text: string, _kind: 'money' | 'rate'): string {
  return /^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(text) ? text.replaceAll(',', '') : text;
}

let sequence = 0;
const sliderKeys = new Set(['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Home', 'End']);
function decimalUnits(units: number): string {
  const exact = BigInt(units), absolute = exact < 0n ? -exact : exact;
  return `${exact < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function mountNumericControl(host: HTMLElement, options: NumericControlOptions): {
  input: HTMLInputElement;
  update(raw: string): void;
  dispose(): void;
} {
  const group = document.createElement('div');
  group.className = 'numeric-control';
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.id = `numeric-${++sequence}`;
  input.type = 'text';
  input.inputMode = 'decimal';
  input.name = options.field;
  input.dataset.field = options.field;
  input.dataset.fieldKind = options.kind;
  input.dataset.fieldLabel = options.label;
  input.value = options.raw;
  label.htmlFor = input.id;
  label.textContent = options.label;
  group.append(label, input);
  const range = options.slider ? document.createElement('input') : null;
  const rangeHint = options.slider ? document.createElement('small') : null;
  if (range && rangeHint && options.slider) {
    const {minUnits, maxUnits, stepUnits} = options.slider;
    if (![minUnits, maxUnits, stepUnits].every(Number.isSafeInteger) || minUnits >= maxUnits || stepUnits <= 0) {
      throw new RangeError('Slider bounds and step must be integer units with a positive step.');
    }
    range.type = 'range';
    range.min = String(minUnits);
    range.max = String(maxUnits);
    range.step = String(stepUnits);
    range.dataset.numericSlider = '';
    range.setAttribute('aria-label', `${options.label} adjustment`);
    rangeHint.id = `${input.id}-range-hint`;
    rangeHint.className = 'numeric-range-hint';
    range.setAttribute('aria-describedby', rangeHint.id);
    group.append(range, rangeHint);
  }
  host.append(group);
  let disposed = false;
  const parse = options.kind === 'money' ? parseMoneyInput : parseRateInput;
  const syncRange = (raw: string) => {
    if (!range || !rangeHint || !options.slider) return;
    const parsed = parse(normalizeNumericText(raw, options.kind));
    if (parsed.status === 'available') range.value = String(Math.min(options.slider.maxUnits, Math.max(options.slider.minUnits, parsed.value)));
    const outside = parsed.status === 'available' && (parsed.value < options.slider.minUnits || parsed.value > options.slider.maxUnits);
    rangeHint.textContent = outside ? 'Exact value is outside the slider range.' : '';
    range.setAttribute('aria-valuetext', `${decimalUnits(Number(range.value))}${options.kind === 'rate' ? '%' : ' dollars'}`);
  };
  syncRange(options.raw);
  const commit = () => {
    options.onCommit();
    input.dispatchEvent(new CustomEvent('financial-input-commit', {bubbles: true}));
  };
  const onTextBlur = () => {
    // A render can blur a focused field just before replacing it.
    queueMicrotask(() => {
      if (!disposed && input.isConnected) commit();
    });
  };
  const onTextInput = () => {
    const raw = normalizeNumericText(input.value, options.kind);
    syncRange(raw);
    options.onInput(raw);
  };
  const onRangeInput = () => {
    if (!range) return;
    const raw = decimalUnits(Number(range.value));
    input.value = raw;
    syncRange(raw);
    options.onInput(raw);
  };
  const onRangeKeyDown = (event: KeyboardEvent) => {
    if (!range || !options.slider || !sliderKeys.has(event.key)) return;
    event.preventDefault();
    const {minUnits, maxUnits, stepUnits} = options.slider;
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1;
    const next = event.key === 'Home' ? minUnits : event.key === 'End' ? maxUnits : Number(range.value) + direction * stepUnits;
    range.value = String(Math.min(maxUnits, Math.max(minUnits, next)));
    onRangeInput();
  };
  const onRangeKeyUp = (event: KeyboardEvent) => { if (sliderKeys.has(event.key)) commit(); };
  input.addEventListener('input', onTextInput);
  input.addEventListener('blur', onTextBlur);
  range?.addEventListener('input', onRangeInput);
  range?.addEventListener('change', commit);
  range?.addEventListener('keydown', onRangeKeyDown);
  range?.addEventListener('keyup', onRangeKeyUp);
  return {
    input,
    update(raw) {
      if (document.activeElement !== input) input.value = raw;
      syncRange(raw);
    },
    dispose() {
      disposed = true;
      input.removeEventListener('input', onTextInput);
      input.removeEventListener('blur', onTextBlur);
      range?.removeEventListener('input', onRangeInput);
      range?.removeEventListener('change', commit);
      range?.removeEventListener('keydown', onRangeKeyDown);
      range?.removeEventListener('keyup', onRangeKeyUp);
    },
  };
}
