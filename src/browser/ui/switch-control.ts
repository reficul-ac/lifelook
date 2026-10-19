export interface SwitchControlOptions {
  readonly label: string;
  readonly field: string;
  readonly checked: boolean;
  onChange(checked: boolean): void;
}

let sequence = 0;

/** Retain native checkbox activation, keyboard behavior and checked state. */
export function mountSwitchControl(host: HTMLElement, options: SwitchControlOptions): {
  input: HTMLInputElement;
  update(checked: boolean): void;
  dispose(): void;
} {
  const label = document.createElement('label');
  label.className = 'switch-control';
  const caption = document.createElement('span');
  caption.textContent = options.label;
  const input = document.createElement('input');
  input.id = `switch-${++sequence}`;
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.name = options.field;
  input.dataset.field = options.field;
  input.dataset.fieldKind = 'switch';
  input.dataset.fieldLabel = options.label;
  input.checked = options.checked;
  label.htmlFor = input.id;
  label.append(caption, input);
  host.append(label);
  let disposed = false;
  const onChange = () => {
    if (disposed || !input.isConnected) return;
    options.onChange(input.checked);
    input.dispatchEvent(new CustomEvent('financial-input-commit', {bubbles: true}));
  };
  input.addEventListener('change', onChange);
  return {
    input,
    update(checked) { if (!disposed) input.checked = checked; },
    dispose() {
      disposed = true;
      input.removeEventListener('change', onChange);
    },
  };
}
