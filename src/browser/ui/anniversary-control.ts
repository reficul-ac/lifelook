const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
let sequence = 0;

export function mountAnniversaryControl(host: HTMLElement, options: {
  month: string;
  day: string;
  onChange(month: string, day: string): void;
}): {update(month: string, day: string): void; dispose(): void} {
  const group = document.createElement('fieldset');
  group.className = 'anniversary-control';
  const legend = document.createElement('legend');
  legend.textContent = 'Raise anniversary';
  const month = document.createElement('select'), day = document.createElement('input');
  const id = `anniversary-${++sequence}`;
  const monthLabel = document.createElement('label'), dayLabel = document.createElement('label');
  monthLabel.textContent = 'Raise month'; monthLabel.htmlFor = month.id = `${id}-month`;
  dayLabel.textContent = 'Raise day'; dayLabel.htmlFor = day.id = `${id}-day`;
  month.dataset.field = month.name = 'raiseMonth'; day.dataset.field = day.name = 'raiseDay';
  month.dataset.fieldLabel = 'Raise month'; day.dataset.fieldLabel = 'Raise day';
  month.dataset.fieldKind = 'integer'; day.dataset.fieldKind = 'integer';
  day.type = 'text'; day.inputMode = 'numeric';
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choose month'; month.append(empty);
  months.forEach((name, index) => {
    const option = document.createElement('option'); option.value = String(index + 1); option.textContent = name; month.append(option);
  });
  const hint = document.createElement('small');
  hint.id = `${id}-hint`; hint.textContent = 'Shorter months use their last day.';
  day.setAttribute('aria-describedby', hint.id);
  monthLabel.append(month); dayLabel.append(day);
  group.append(legend, monthLabel, dayLabel, hint); host.append(group);
  const setMonth = (value: string) => {
    for (const option of month.querySelectorAll('[data-invalid-month]')) option.remove();
    if (![...month.options].some(option => option.value === value)) {
      const invalid = document.createElement('option'); invalid.value = value; invalid.textContent = value; invalid.dataset.invalidMonth = ''; month.append(invalid);
    }
    month.value = value;
  };
  setMonth(options.month); day.value = options.day;
  const commit = () => group.dispatchEvent(new CustomEvent('financial-input-commit', {bubbles: true}));
  const onMonthChange = () => { options.onChange(month.value, day.value); commit(); };
  const onDayInput = () => options.onChange(month.value, day.value);
  month.addEventListener('change', onMonthChange); day.addEventListener('input', onDayInput); day.addEventListener('blur', commit);
  return {
    update(nextMonth, nextDay) { setMonth(nextMonth); if (document.activeElement !== day) day.value = nextDay; },
    dispose() { month.removeEventListener('change', onMonthChange); day.removeEventListener('input', onDayInput); day.removeEventListener('blur', commit); },
  };
}
