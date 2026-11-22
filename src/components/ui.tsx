import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Color } from '../types';

// ---------------------------------------------------------------------------
// Icons (inline SVG, 16px, currentColor)
// ---------------------------------------------------------------------------
const paths: Record<string, ReactNode> = {
  plus: <path d="M8 3v10M3 8h10" />,
  dots: <><circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" /><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none" /></>,
  search: <><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.3 3.3" /></>,
  filter: <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />,
  sort: <path d="M5 3v10m0 0-2.5-2.5M5 13l2.5-2.5M11 13V3m0 0L8.5 5.5M11 3l2.5 2.5" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />,
  copy: <><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" /><path d="M10.5 5.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h1.5" /></>,
  eye: <><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></>,
  eyeOff: <><path d="M2 2l12 12M6.6 6.7a2 2 0 0 0 2.7 2.7M4.3 4.6C2.6 5.8 1.5 8 1.5 8S4 12.5 8 12.5c1.3 0 2.5-.5 3.5-1.1M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.5 1-1.5 2" /></>,
  x: <path d="m4 4 8 8m0-8-8 8" />,
  chevronDown: <path d="m4 6 4 4 4-4" />,
  chevronRight: <path d="m6 4 4 4-4 4" />,
  chevronsLeft: <path d="m8 4-4 4 4 4M13 4 9 8l4 4" />,
  menu: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  sun: <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></>,
  moon: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />,
  monitor: <><rect x="2" y="3" width="12" height="8" rx="1.5" /><path d="M6 13.5h4" /></>,
  grip: <><circle cx="6" cy="4" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="4" r="1" fill="currentColor" stroke="none" /><circle cx="6" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  sliders: <path d="M3 4.5h6m3 0h1M3 11.5h1m3 0h6M10.5 3v3M5.5 10v3" />,
  expand: <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />,
  group: <><rect x="2.5" y="2.5" width="4" height="11" rx="1" /><rect x="9.5" y="2.5" width="4" height="7" rx="1" /></>,
  download: <path d="M8 2.5v8m0 0L5 7.5m3 3 3-3M3 13.5h10" />,
  upload: <path d="M8 10.5v-8m0 0L5 5.5m3-3 3 3M3 13.5h10" />,
  edit: <path d="M10.5 3 13 5.5 6 12.5H3.5V10L10.5 3Z" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  undo: <path d="M5.5 6.5H10a3 3 0 0 1 0 6H7M5.5 6.5 8 4M5.5 6.5 8 9" />,
  layout: <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M6 2.5v11" /></>,
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>,
  text: <path d="M3 4h10M3 8h10M3 12h6" />,
  share: <><path d="M8 10V2.5m0 0L5 5.5m3-3 3 3" /><path d="M5 7.5H4a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5V9A1.5 1.5 0 0 0 12 7.5h-1" /></>,
  users: <><circle cx="6" cy="5.5" r="2.25" /><path d="M2 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5M10.5 3.4a2.25 2.25 0 0 1 0 4.2M12 9.8c1 .5 1.8 1.6 2 3.2" /></>,
  lock: <><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>,
  logout: <path d="M6.5 13.5h-3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3M10.5 11 13.5 8l-3-3M13.5 8H6" />,
  table: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M2.5 9.75h11M6.5 6.5V13" /></>,
};

export function Icon({ name, size = 16, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Popover with a global stack so only the top-most one reacts to outside
// clicks / Escape (lets popovers nest).
// ---------------------------------------------------------------------------
const stack: number[] = [];
let nextId = 1;
export const popoverOpen = () => stack.length > 0;

type Anchor = HTMLElement | DOMRect | { x: number; y: number };

export function Popover({
  anchor,
  onClose,
  children,
  placement = 'bottom-start',
  width,
  className = '',
}: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'right-start';
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const idRef = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r: DOMRect =
      anchor instanceof HTMLElement
        ? anchor.getBoundingClientRect()
        : 'width' in anchor
          ? anchor
          : new DOMRect(anchor.x, anchor.y, 0, 0);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = placement === 'right-start' ? r.top : r.bottom + 4;
    let left = placement === 'bottom-end' ? r.right - w : placement === 'right-start' ? r.right + 4 : r.left;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (left + w > vw - 8) left = Math.max(8, placement === 'right-start' ? r.left - w - 4 : vw - w - 8);
    if (left < 8) left = 8;
    if (top + h > vh - 8) top = Math.max(8, placement === 'right-start' ? vh - h - 8 : r.top - h - 4);
    setPos({ top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = nextId++;
    idRef.current = id;
    stack.push(id);
    const isTop = () => stack[stack.length - 1] === id;
    const onDown = (e: MouseEvent) => {
      if (!isTop()) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTop()) {
        e.stopPropagation();
        e.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width, opacity: pos ? 1 : 0 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Hook: anchor element + open state for a popover. */
export function usePopover<T extends Anchor = HTMLElement>() {
  const [anchor, setAnchor] = useState<T | null>(null);
  return {
    anchor,
    open: (a: T) => setAnchor(a),
    close: () => setAnchor(null),
    toggle: (a: T) => setAnchor((cur) => (cur ? null : a)),
  };
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  right,
  active,
}: {
  icon?: string | ReactNode;
  children: ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  right?: ReactNode;
  active?: boolean;
}) {
  return (
    <button className={`menu-item ${danger ? 'danger' : ''} ${active ? 'active' : ''}`} onClick={onClick}>
      {icon !== undefined && (
        <span className="menu-icon">{typeof icon === 'string' ? <Icon name={icon} /> : icon}</span>
      )}
      <span className="menu-label">{children}</span>
      {right !== undefined && <span className="menu-right">{right}</span>}
    </button>
  );
}

export const MenuSep = () => <div className="menu-sep" />;
export const MenuHeading = ({ children }: { children: ReactNode }) => <div className="menu-heading">{children}</div>;

// ---------------------------------------------------------------------------
// Tags / pills
// ---------------------------------------------------------------------------
export function Tag({ color, children, onRemove, className = '' }: { color: Color; children: ReactNode; onRemove?: () => void; className?: string }) {
  return (
    <span className={`tag c-${color} ${className}`}>
      <span className="tag-text">{children}</span>
      {onRemove && (
        <button
          className="tag-x"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove"
        >
          <Icon name="x" size={10} />
        </button>
      )}
    </span>
  );
}

export function ColorDot({ color }: { color: Color }) {
  return <span className={`color-dot c-${color}`} />;
}

// ---------------------------------------------------------------------------
// Inline text input that commits on blur / Enter
// ---------------------------------------------------------------------------
export function AutoInput({
  value,
  onChange,
  onDone,
  placeholder,
  className,
  autoFocus,
  selectAll,
}: {
  value: string;
  onChange: (v: string) => void;
  onDone?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  selectAll?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      if (selectAll) ref.current.select();
    }
  }, [autoFocus, selectAll]);
  return (
    <input
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onDone?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          ref.current?.blur();
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Emoji picker (small curated set — no bloat)
// ---------------------------------------------------------------------------
const EMOJI = (
  '📋 🚀 🏡 💼 🎯 📌 📝 ✅ 🔥 ⭐ 💡 🐛 🛡️ ⚙️ 🎨 ✨ 📦 📈 📅 🧪 🧠 💬 📚 🎵 🎮 ✈️ 🏃 🍳 🛒 💰 ❤️ 🌱 🔧 🧹 📣 🔒 🌍 🏆 ⚡ 🧭 🗂️ 🗓️ 📊 🖥️ 📱 🎬 📷 🎁 🐶 ☕'
).split(' ');

export function EmojiPicker({ onPick, onRemove }: { onPick: (e: string) => void; onRemove?: () => void }) {
  return (
    <div className="emoji-picker">
      <div className="emoji-grid">
        {EMOJI.map((e) => (
          <button key={e} className="emoji-btn" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
      {onRemove && (
        <button className="btn-text small" onClick={onRemove}>
          Remove icon
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
type ToastMsg = { id: number; text: string; action?: { label: string; run: () => void } };
let toastListener: ((t: ToastMsg) => void) | null = null;
let toastId = 1;
export function toast(text: string, action?: ToastMsg['action']) {
  toastListener?.({ id: toastId++, text, action });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    toastListener = (t) => {
      setItems((cur) => [...cur.slice(-2), t]);
      window.setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), 4500);
    };
    return () => {
      toastListener = null;
    };
  }, []);
  return createPortal(
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                setItems((cur) => cur.filter((x) => x.id !== t.id));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
