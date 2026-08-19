import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, Info, MoreHorizontal, X } from "lucide-react";

export type ActionTier = "primary" | "secondary" | "quiet";
export const ActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { tier?: ActionTier }>(
  function ActionButton({ tier = "secondary", children, className, type = "button", ...props }, ref) {
    return <button ref={ref} type={type} {...props} className={["action-button", `action-${tier}`, className].filter(Boolean).join(" ")}>{children}</button>;
  },
);

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  group?: string;
  separator?: boolean;
  danger?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  selected?: boolean;
  onSelect: (invoker?: HTMLButtonElement | null) => void;
};

type MenuProps = {
  label: string;
  items: MenuItem[];
  icon?: ReactNode;
  primary?: boolean;
  quiet?: boolean;
  children?: ReactNode;
  className?: string;
};

function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: (restore?: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, root, close]);
}

export function AnchoredMenu({ label, items, icon, primary = false, quiet = false, children, className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [placement, setPlacement] = useState<"left" | "right">("right");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const id = useId();
  const close = (restore = false) => {
    window.clearTimeout(timer.current);
    setOpen(false); setPinned(false);
    if (restore) requestAnimationFrame(() => trigger.current?.focus());
  };
  useDismiss(open, root, close);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const rect = menu.current.getBoundingClientRect();
    setPlacement(rect.right > window.innerWidth - 8 ? "right" : rect.left < 8 ? "left" : placement);
  }, [open]);
  const preview = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 120);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    if (!pinned && !root.current?.contains(document.activeElement)) timer.current = window.setTimeout(() => setOpen(false), 180);
  };
  const moveFocus = (event: React.KeyboardEvent) => {
    const nodes = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    if (!nodes.length) return;
    const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % nodes.length;
    if (event.key === "ArrowUp") next = current < 0 ? nodes.length - 1 : (current - 1 + nodes.length) % nodes.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = nodes.length - 1;
    if (next !== undefined) { event.preventDefault(); nodes[next]?.focus(); }
  };
  const grouped = items.map((item, index) => ({ item, index, heading: item.group && item.group !== items[index - 1]?.group }));
  return <div className={["anchored-menu", className].filter(Boolean).join(" ")} ref={root} onPointerEnter={preview} onPointerLeave={leave} onBlur={event => { if (!pinned && !root.current?.contains(event.relatedTarget as Node)) close(); }}>
    <ActionButton
      ref={trigger}
      tier={quiet ? "quiet" : primary ? "primary" : "secondary"}
      aria-label={quiet ? label : undefined}
      title={quiet ? label : undefined}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onFocus={() => setOpen(true)}
      onKeyDown={event => { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); setOpen(true); requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus()); } }}
      onClick={() => { setPinned(value => !value); setOpen(value => !value || !pinned); }}
    >{icon}{children ?? (!quiet && label)}{!quiet && <ChevronDown aria-hidden="true" size={14}/>}</ActionButton>
    {open && <div ref={menu} id={id} className={`menu-popover menu-align-${placement}`} role="menu" aria-label={label} onKeyDown={moveFocus}>
      {grouped.map(({ item, index, heading }) => <div className="menu-entry" key={`${item.label}-${index}`}>
        {(item.separator || (heading && index > 0)) && <div className="menu-separator" role="separator" />}
        {heading && <div className="menu-heading" role="presentation">{item.group}</div>}
        <button role={item.selected !== undefined ? "menuitemcheckbox" : "menuitem"} aria-checked={item.selected !== undefined ? item.selected : undefined} disabled={item.disabled} className={item.danger || item.destructive ? "danger-item" : undefined} onClick={() => { close(); item.onSelect(trigger.current); }}>
          {item.icon}<span>{item.label}</span>{item.selected && <span className="menu-check" aria-hidden="true">✓</span>}
        </button>
      </div>)}
    </div>}
  </div>;
}

/** Semantic alias used where the trigger is already described as a menu. */
export const Menu = AnchoredMenu;
export function OverflowMenu({ label, items, className }: { label: string; items: MenuItem[]; className?: string }) {
  return <AnchoredMenu quiet className={["overflow-menu", className].filter(Boolean).join(" ")} label={label} icon={<MoreHorizontal aria-hidden="true" size={19}/>} items={items}/>;
}

export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false), [flip, setFlip] = useState(false);
  const root = useRef<HTMLSpanElement>(null), popover = useRef<HTMLSpanElement>(null), trigger = useRef<HTMLButtonElement>(null), timer = useRef<number>(), id = useId();
  const close = (restore = false) => { window.clearTimeout(timer.current); setOpen(false); setPinned(false); if (restore) trigger.current?.focus(); };
  useDismiss(open, root, close);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => { if (open && popover.current) setFlip(popover.current.getBoundingClientRect().right > window.innerWidth - 8); }, [open]);
  const preview = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(true), 120); };
  const leave = () => { window.clearTimeout(timer.current); if (!pinned) timer.current = window.setTimeout(() => setOpen(false), 180); };
  return <span className="info-control" ref={root} onPointerEnter={preview} onPointerLeave={leave}>
    <button ref={trigger} type="button" aria-label={label} title={label} aria-describedby={open ? id : undefined} aria-expanded={open} onFocus={() => setOpen(true)} onBlur={event => { if (!pinned && !root.current?.contains(event.relatedTarget as Node)) leave(); }} onKeyDown={event => { if (event.key === "Escape") close(true); }} onClick={() => { if (pinned) close(); else { setPinned(true); setOpen(true); } }}><Info aria-hidden="true" size={16}/></button>
    {open && <span ref={popover} className={`info-popover${flip ? " popover-flip" : ""}`} role="tooltip" id={id}>{children}</span>}
  </span>;
}

export type UiPreferences = { version: 1; expanded: Record<string, boolean> };
const emptyPreferences = (): UiPreferences => ({ version: 1, expanded: {} });
export const uiPreferenceStorageKey = (householdId: string) => `lifelook:ui:v1:${householdId}`;
export function readUiPreferences(householdId: string): UiPreferences {
  if (!householdId || typeof localStorage === "undefined") return emptyPreferences();
  try {
    const value = JSON.parse(localStorage.getItem(uiPreferenceStorageKey(householdId)) ?? "null");
    if (value?.version !== 1 || !value.expanded || typeof value.expanded !== "object" || Array.isArray(value.expanded)) return emptyPreferences();
    return { version: 1, expanded: Object.fromEntries(Object.entries(value.expanded).filter(([, item]) => typeof item === "boolean")) as Record<string, boolean> };
  } catch { return emptyPreferences(); }
}
export function writeUiPreferences(householdId: string, value: UiPreferences): boolean {
  if (!householdId || typeof localStorage === "undefined") return false;
  try { localStorage.setItem(uiPreferenceStorageKey(householdId), JSON.stringify({ version: 1, expanded: value.expanded })); return true; } catch { return false; }
}

export function DetailDisclosure({ label, storageKey, householdId, preferenceKey, children, defaultOpen = false }: { label: string; storageKey?: string; householdId?: string; preferenceKey?: string; children: ReactNode; defaultOpen?: boolean }) {
  const encoded = storageKey?.match(/^lifelook:ui:v1:([^:]+):(.+)$/);
  const resolvedHouseholdId = householdId ?? encoded?.[1];
  const key = preferenceKey ?? encoded?.[2] ?? storageKey ?? label;
  const initial = () => {
    if (resolvedHouseholdId) return readUiPreferences(resolvedHouseholdId).expanded[key] ?? defaultOpen;
    return defaultOpen;
  };
  const [open, setOpen] = useState(initial);
  useEffect(() => setOpen(initial()), [resolvedHouseholdId, key]);
  const persist = (next: boolean) => {
    setOpen(next);
    if (resolvedHouseholdId) { const preferences = readUiPreferences(resolvedHouseholdId); preferences.expanded[key] = next; writeUiPreferences(resolvedHouseholdId, preferences); }
  };
  return <details className="detail-disclosure" open={open} onToggle={event => { if (event.currentTarget.open !== open) persist(event.currentTarget.open); }}><summary>{label}<ChevronDown aria-hidden="true" size={16}/></summary><div className="disclosure-body">{children}</div></details>;
}

type OverlayProps = { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; initialFocusRef?: RefObject<HTMLElement | null>; invokerRef?: RefObject<HTMLElement | null>; closeLabel?: string; dismissOnOutside?: boolean; className?: string };
function Overlay({ kind, open, onClose, title, children, footer, initialFocusRef, invokerRef, closeLabel = "Close", dismissOnOutside = false, className }: OverlayProps & { kind: "dialog" | "sheet" }) {
  const panel = useRef<HTMLDivElement>(null), titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => (initialFocusRef?.current ?? panel.current?.querySelector<HTMLElement>('input,select,textarea,button,[tabindex]:not([tabindex="-1"])'))?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')];
      if (!nodes.length) { event.preventDefault(); panel.current.focus(); return; }
      const first = nodes[0], last = nodes.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); requestAnimationFrame(() => (invokerRef?.current ?? previous)?.focus()); };
  }, [open, initialFocusRef, invokerRef]);
  if (!open) return null;
  return <div className={`overlay-backdrop overlay-${kind}`} onPointerDown={event => { if (dismissOnOutside && event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className={["overlay-panel", className].filter(Boolean).join(" ")} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="overlay-header"><h2 id={titleId}>{title}</h2><ActionButton tier="quiet" aria-label={closeLabel} title={closeLabel} onClick={onClose}><X aria-hidden="true" size={19}/></ActionButton></header>
      <div className="overlay-body">{children}</div>{footer && <footer className="overlay-footer">{footer}</footer>}
    </div>
  </div>;
}
export function CenteredDialog(props: OverlayProps) { return <Overlay kind="dialog" {...props}/>; }
export function SideSheet(props: OverlayProps) { return <Overlay kind="sheet" {...props}/>; }
export const Dialog = CenteredDialog;

export type ChartDataPoint = { label: string; value: number; description?: string };
export function ChartContainer({ label, description, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { label: string; description?: string }) {
  const descriptionId = useId();
  return <div {...props} className={["accessible-chart", className].filter(Boolean).join(" ")} role="group" aria-label={label} aria-describedby={description ? descriptionId : undefined}>{description && <p id={descriptionId} className="sr-only">{description}</p>}{children}</div>;
}
