/**
 * Pointer-based drag and drop (mouse, pen and touch).
 *
 * - Mouse: drag starts after moving a few pixels.
 * - Touch: press and hold (or press a drag handle) so normal scrolling still works.
 * - A "ghost" copy of the item follows the pointer, tilting with movement.
 * - On release the ghost springs into the drop placeholder, then the real item
 *   takes its place, so the hand-off is seamless.
 * - Scroll containers auto-scroll when you drag near their edges.
 *
 * React components decide what a "container" and an "item" are with data
 * attributes, render a placeholder (`data-placeholder`) where `onOver` says, and
 * apply the move in `onDrop`.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';

export interface DragSpec {
  id: string;
  el: HTMLElement; // the element being dragged (used for size + ghost)
  axis: 'x' | 'y';
  container: string; // CSS selector for drop containers; must carry data-drop-id
  item: string; // CSS selector for items inside a container; must carry data-drag-id
  scrollers: () => (HTMLElement | null)[];
  touchDelay?: number; // ms to hold before a touch drag starts (0 for drag handles)
  tilt?: boolean;
  onStart: (info: { width: number; height: number; from: { container: string; index: number } | null }) => void;
  onOver: (container: string, index: number) => void;
  onDrop: (container: string, index: number) => void;
  onCancel: () => void;
}

const SNAP_MS = 240;
let active = false;
let suppressClickUntil = 0;
/** True for a moment after a drag ends, so the release doesn't count as a click. */
export const justDragged = () => Date.now() < suppressClickUntil;
export const isDragging = () => active;

// Stop the page scrolling under a touch drag (must be a non-passive listener)
if (typeof document !== 'undefined') {
  document.addEventListener('touchmove', (e) => active && e.cancelable && e.preventDefault(), { passive: false });
}

/** Element rect without any transform currently applied by an animation. */
export function layoutRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return r;
  const m = new DOMMatrixReadOnly(t);
  return new DOMRect(r.left - m.m41, r.top - m.m42, r.width, r.height);
}

const IGNORE = 'input, textarea, select, button, a, [contenteditable="true"], .no-drag';

export function pressToDrag(e: React.PointerEvent, spec: DragSpec, opts: { fromHandle?: boolean } = {}) {
  if (active || e.button !== 0) return;
  if (!opts.fromHandle && (e.target as HTMLElement).closest(IGNORE)) return;
  const touch = e.pointerType === 'touch';
  const delay = touch ? (spec.touchDelay ?? 220) : 0;
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let x = startX;
  let y = startY;
  let started = false;
  let timer: number | undefined;

  const cleanupPending = () => {
    window.clearTimeout(timer);
    window.removeEventListener('pointermove', pendingMove);
    window.removeEventListener('pointerup', pendingUp);
    window.removeEventListener('pointercancel', pendingUp);
  };
  const pendingMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    x = ev.clientX;
    y = ev.clientY;
    const dist = Math.hypot(x - startX, y - startY);
    if (touch && dist > 8) cleanupPending(); // it's a scroll, not a drag
    else if (!touch && dist > 4) begin();
  };
  const pendingUp = () => cleanupPending();

  const begin = () => {
    if (started) return;
    started = true;
    cleanupPending();
    run(spec, x, y, startX, startY, pointerId, touch);
  };

  window.addEventListener('pointermove', pendingMove);
  window.addEventListener('pointerup', pendingUp);
  window.addEventListener('pointercancel', pendingUp);
  if (touch && delay === 0) begin(); // drag handle: no hold needed
  else if (touch) timer = window.setTimeout(begin, delay);
  if (opts.fromHandle && !touch) e.preventDefault();
}

function run(spec: DragSpec, x: number, y: number, startX: number, startY: number, pointerId: number, touch: boolean) {
  active = true;
  const src = spec.el.getBoundingClientRect();
  const offX = startX - src.left;
  const offY = startY - src.top;

  // Ghost: wrapper positioned with translate, inner copy carries tilt/scale/shadow
  const wrap = document.createElement('div');
  wrap.className = 'drag-ghost-wrap';
  wrap.style.width = `${src.width}px`;
  wrap.style.height = `${src.height}px`;
  const ghost = spec.el.cloneNode(true) as HTMLElement;
  ghost.classList.add('drag-ghost');
  ghost.removeAttribute('data-drag-id');
  ghost.style.width = `${src.width}px`;
  wrap.appendChild(ghost);
  document.body.appendChild(wrap);
  document.body.classList.add('dragging-any');

  let tilt = 0;
  let lastX = x;
  const place = () => {
    wrap.style.transform = `translate3d(${x - offX}px, ${y - offY}px, 0)`;
    if (spec.tilt) {
      const target = Math.max(-7, Math.min(7, (x - lastX) * 0.6)) + 2.5;
      tilt += (target - tilt) * 0.25;
      ghost.style.transform = `rotate(${tilt.toFixed(2)}deg) scale(1.03)`;
      lastX = x;
    }
  };
  place();
  ghost.animate(
    [
      { transform: 'rotate(0deg) scale(1)', boxShadow: 'var(--shadow-card)' },
      { transform: `rotate(${spec.tilt ? 2.5 : 0}deg) scale(1.03)`, boxShadow: 'var(--shadow-lift)' },
    ],
    { duration: 140, easing: 'ease-out' },
  );
  if (!spec.tilt) ghost.style.transform = 'scale(1.01)';
  if (touch) navigator.vibrate?.(8);

  // Where the item started
  const fromContainer = spec.el.closest<HTMLElement>(spec.container);
  const from = fromContainer
    ? { container: fromContainer.dataset.dropId!, index: items(fromContainer).findIndex((el) => el.dataset.dragId === spec.id) }
    : null;
  spec.onStart({ width: src.width, height: src.height, from });
  let over: { container: string; index: number } | null = from;

  function items(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>(spec.item)).filter(
      (el) => el.closest(spec.container) === container && el.offsetParent !== null,
    );
  }

  const hitTest = () => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const container = hit?.closest<HTMLElement>(spec.container);
    if (!container) return;
    const list = items(container).filter((el) => el.dataset.dragId !== spec.id);
    let index = list.length;
    for (let i = 0; i < list.length; i++) {
      const r = layoutRect(list[i]);
      const mid = spec.axis === 'y' ? r.top + r.height / 2 : r.left + r.width / 2;
      if ((spec.axis === 'y' ? y : x) < mid) {
        index = i;
        break;
      }
    }
    const id = container.dataset.dropId!;
    if (!over || over.container !== id || over.index !== index) {
      over = { container: id, index };
      spec.onOver(id, index);
    }
  };

  // Auto-scroll near edges
  let raf = 0;
  const tick = () => {
    for (const s of spec.scrollers()) {
      if (!s) continue;
      const r = s.getBoundingClientRect();
      const edge = Math.min(70, r.width / 4, r.height / 4);
      const speed = (d: number) => Math.round(((edge - d) / edge) * 18);
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        if (x - r.left < edge) s.scrollLeft -= speed(x - r.left);
        else if (r.right - x < edge) s.scrollLeft += speed(r.right - x);
        if (y - r.top < edge) s.scrollTop -= speed(y - r.top);
        else if (r.bottom - y < edge) s.scrollTop += speed(r.bottom - y);
      }
    }
    if (spec.tilt) place();
    hitTest();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    x = ev.clientX;
    y = ev.clientY;
    place();
    hitTest();
  };

  const finish = (drop: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    cancelAnimationFrame(raf);
    suppressClickUntil = Date.now() + 300;
    if (drop) hitTest(); // make sure the target reflects the final pointer position

    const target = drop ? over : null;
    // Spring the ghost into the placeholder (or back home when cancelled)
    const ph = document.querySelector<HTMLElement>('[data-placeholder]');
    const dest = target && ph ? ph.getBoundingClientRect() : spec.el.offsetParent ? spec.el.getBoundingClientRect() : src;
    const cur = wrap.getBoundingClientRect();
    wrap.animate(
      [
        { transform: `translate3d(${cur.left}px, ${cur.top}px, 0)` },
        { transform: `translate3d(${dest.left}px, ${dest.top}px, 0)` },
      ],
      { duration: SNAP_MS, easing: 'cubic-bezier(.2, 1.25, .4, 1)', fill: 'forwards' },
    );
    ghost.animate(
      [{ transform: ghost.style.transform || 'none' }, { transform: 'rotate(0deg) scale(1)', boxShadow: 'var(--shadow-card)' }],
      { duration: SNAP_MS, easing: 'cubic-bezier(.2, 1.25, .4, 1)', fill: 'forwards' },
    );
    // Commit on a timer rather than animation events: animations and animation
    // frames pause in background tabs, and the drop must still happen.
    window.setTimeout(() => {
      if (target) spec.onDrop(target.container, target.index);
      else spec.onCancel();
      // Give React a moment to render the real item in place before removing the ghost
      window.setTimeout(() => {
        wrap.remove();
        document.body.classList.remove('dragging-any');
      }, 16);
      active = false;
    }, SNAP_MS);
  };
  const up = (ev: PointerEvent) => ev.pointerId === pointerId && finish(true);
  const cancel = (ev: PointerEvent) => ev.pointerId === pointerId && finish(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      finish(false);
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}

/**
 * Smoothly animate items to their new positions whenever they move (FLIP).
 * Items need `data-flip-id`; positions are measured relative to the nearest
 * `data-flip-scope` ancestor so moving a whole column doesn't double-animate its cards.
 */
export function useFlip(root: RefObject<HTMLElement | null>) {
  const prev = useRef(new Map<string, { scope: Element | null; x: number; y: number }>());
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const next = new Map<string, { scope: Element | null; x: number; y: number }>();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((node) => {
      if (node.offsetParent === null) return;
      const scope = node.parentElement?.closest('[data-flip-scope]') ?? el;
      const s = scope.getBoundingClientRect();
      const r = layoutRect(node);
      const pos = { scope, x: r.left - s.left, y: r.top - s.top };
      const id = node.dataset.flipId!;
      next.set(id, pos);
      const p = prev.current.get(id);
      if (!p || p.scope !== scope || reduce) return;
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      // Continue from wherever a running animation currently has it
      const t = getComputedStyle(node).transform;
      const m = t && t !== 'none' ? new DOMMatrixReadOnly(t) : null;
      node.getAnimations().forEach((a) => a.cancel());
      node.animate(
        [{ transform: `translate(${dx + (m?.m41 ?? 0)}px, ${dy + (m?.m42 ?? 0)}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' },
      );
    });
    prev.current = next;
  });
}
