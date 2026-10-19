import {describe, expect, it} from 'vitest';
import {mountAppearance} from '../../src/browser/ui/appearance';
import type {StoragePort} from '../../src/browser/storage';

const key = 'lifelook.ui.preferences.v1';
function preferences(raw: string | null = null) {
  const values = new Map<string, string>(raw === null ? [] : [[key, raw]]);
  const writes: [string, string][] = [];
  const storage: StoragePort = {
    getItem: name => values.get(name) ?? null,
    setItem: (name, value) => { writes.push([name, value]); values.set(name, value); },
  };
  return {storage, writes};
}
function systemTheme(dark: boolean) {
  const events = new EventTarget();
  const media = Object.assign(events, {matches: dark, media: '(prefers-color-scheme: dark)', onchange: null,
    addListener: () => {}, removeListener: () => {},
  }) as MediaQueryList;
  return {media, change(dark: boolean) {
    Object.defineProperty(media, 'matches', {value: dark, configurable: true});
    media.dispatchEvent(new Event('change'));
  }};
}

describe('appearance preferences', () => {
  it('starts dark without writing an appearance or financial document', () => {
    const {storage, writes} = preferences();
    const root = document.createElement('main');
    const appearance = mountAppearance(root, storage, systemTheme(false).media);
    expect(root.dataset.theme).toBe('dark');
    expect(appearance.getChoice()).toBe('dark');
    expect(writes).toEqual([]);
    appearance.dispose();
  });

  it('restores saved light and persists explicit choices only in the preference key', () => {
    const {storage, writes} = preferences('{"theme":"light"}');
    const root = document.createElement('main');
    const appearance = mountAppearance(root, storage, systemTheme(true).media);
    expect(root.dataset.theme).toBe('light');
    expect(writes).toEqual([]);
    appearance.setChoice('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(writes).toEqual([[key, '{"theme":"dark"}']]);
    appearance.dispose();
  });

  it('follows live system changes only while System is selected', () => {
    const {storage} = preferences('{"theme":"system"}');
    const system = systemTheme(false), root = document.createElement('main');
    const appearance = mountAppearance(root, storage, system.media);
    expect(root.dataset.theme).toBe('light');
    system.change(true);
    expect(root.dataset.theme).toBe('dark');
    appearance.setChoice('light');
    system.change(true);
    expect(root.dataset.theme).toBe('light');
    appearance.setChoice('system');
    expect(root.dataset.theme).toBe('dark');
    appearance.dispose();
  });

  it.each(['{', 'null', '[]', '"light"', '{"theme":"sepia"}', '{"theme":null}'])
  ('falls back to dark for corrupt or unsupported preferences: %s', raw => {
    const {storage, writes} = preferences(raw), root = document.createElement('main');
    const appearance = mountAppearance(root, storage, systemTheme(false).media);
    expect(root.dataset.theme).toBe('dark');
    expect(writes).toEqual([]);
    appearance.dispose();
  });

  it('keeps the requested in-memory choice when preference reads or writes fail', () => {
    const storage: StoragePort = {getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }};
    const root = document.createElement('main');
    const appearance = mountAppearance(root, storage, systemTheme(false).media);
    expect(root.dataset.theme).toBe('dark');
    expect(() => appearance.setChoice('light')).not.toThrow();
    expect(appearance.getChoice()).toBe('light');
    expect(root.dataset.theme).toBe('light');
    appearance.dispose();
  });

  it('releases the system listener on disposal', () => {
    const {storage} = preferences('{"theme":"system"}');
    const system = systemTheme(false), root = document.createElement('main');
    const appearance = mountAppearance(root, storage, system.media);
    appearance.dispose();
    system.change(true);
    expect(root.dataset.theme).toBe('light');
  });
});
