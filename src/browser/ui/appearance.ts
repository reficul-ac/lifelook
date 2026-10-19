import type {StoragePort} from '../storage';

export type AppearanceChoice = 'dark' | 'light' | 'system';
const preferenceKey = 'lifelook.ui.preferences.v1';
const isChoice = (value: unknown): value is AppearanceChoice => value === 'dark' || value === 'light' || value === 'system';

/** Cosmetic preferences have no relationship to financial storage or recovery. */
export function mountAppearance(root: HTMLElement, storage: StoragePort, media: MediaQueryList): {
  getChoice(): AppearanceChoice;
  setChoice(choice: AppearanceChoice): void;
  dispose(): void;
} {
  let choice: AppearanceChoice = 'dark';
  let disposed = false;
  try {
    const raw = storage.getItem(preferenceKey);
    const saved: unknown = raw === null ? null : JSON.parse(raw);
    if (saved && typeof saved === 'object' && !Array.isArray(saved) && 'theme' in saved && isChoice(saved.theme)) choice = saved.theme;
  } catch { /* A blocked or corrupt preference never blocks financial work. */ }
  const render = () => { root.dataset.theme = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice; };
  const onSystemChange = () => { if (choice === 'system') render(); };
  media.addEventListener('change', onSystemChange);
  render();
  return {
    getChoice: () => choice,
    setChoice(next) {
      if (disposed || !isChoice(next)) return;
      choice = next;
      render();
      try { storage.setItem(preferenceKey, JSON.stringify({theme: choice})); } catch { /* Keep the in-memory selection. */ }
    },
    dispose() {
      disposed = true;
      media.removeEventListener('change', onSystemChange);
    },
  };
}
