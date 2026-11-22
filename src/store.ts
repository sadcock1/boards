import { useSyncExternalStore } from 'react';
import type { AppState, Board, Card, PropDef, PropValue, SelectOption } from './types';
import { NONE_GROUP } from './types';
import { findOption, groupKeyOf, randomColor, uid } from './utils';
import { newBoard } from './seed';

export const LEGACY_KEY = 'board-app-v1';
const HISTORY_LIMIT = 100;

/** Fill in view fields added after a board was saved. */
export function migrateBoard(b: Board): Board {
  b.view.layout ??= 'board';
  b.view.tableHidden ??= [];
  b.view.colWidths ??= {};
  b.view.collapsedGroups ??= [];
  return b;
}

export function emptyState(): AppState {
  return { version: 1, boards: [], activeBoardId: null, theme: 'system', sidebarOpen: true, access: {} };
}

let state: AppState = emptyState();
let past: AppState[] = [];
let future: AppState[] = [];
let lastCoalesce: { key: string; at: number } | null = null;
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();
let persist: ((s: AppState) => void) | null = null;
let saveTimer: number | undefined;

function emit() {
  listeners.forEach((l) => l());
  changeListeners.forEach((l) => l());
  if (!persist) return;
  window.clearTimeout(saveTimer);
  const save = persist;
  saveTimer = window.setTimeout(() => save(state), 150);
}

/** Notified after every state change (used by the sync engine). */
export function onChange(fn: () => void) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** Load a whole new state (e.g. after sign-in), clearing undo history. */
export function loadState(s: AppState, saver: ((s: AppState) => void) | null) {
  s.access ??= {};
  s.boards.forEach(migrateBoard);
  state = s;
  past = [];
  future = [];
  lastCoalesce = null;
  persist = saver;
  emit();
}

export function getState() {
  return state;
}

export const roleOf = (s: AppState, boardId: string) => s.access?.[boardId]?.role ?? 'owner';

let onReadOnly: (() => void) | null = null;
export const setReadOnlyHandler = (fn: () => void) => (onReadOnly = fn);

/**
 * Apply a mutation to a deep copy of state. `coalesce` merges rapid edits with the
 * same key (e.g. typing in a field) into one undo step. Changes to boards the
 * user can only view are rejected.
 */
export function update(mutator: (s: AppState) => void, opts: { coalesce?: string; history?: boolean } = {}) {
  const next = structuredClone(state);
  mutator(next);
  for (const b of state.boards) {
    if (roleOf(state, b.id) !== 'viewer') continue;
    const nb = next.boards.find((x) => x.id === b.id);
    if (nb && JSON.stringify({ ...nb, view: null }) !== JSON.stringify({ ...b, view: null })) {
      onReadOnly?.();
      return;
    }
  }
  const now = Date.now();
  const merge =
    opts.coalesce && lastCoalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.at < 1200;
  if (opts.history !== false && !merge) {
    past.push(state);
    if (past.length > HISTORY_LIMIT) past.shift();
  }
  if (opts.history !== false) future = [];
  lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
  state = next;
  emit();
}

/**
 * Apply a change coming from elsewhere (another device / collaborator) to the
 * current state *and* every undo snapshot, so undo never reverts other people's work.
 */
export function applyEverywhere(fn: (s: AppState) => void) {
  const next = structuredClone(state);
  fn(next);
  state = next;
  past = past.map((p) => {
    const c = structuredClone(p);
    fn(c);
    return c;
  });
  future = future.map((p) => {
    const c = structuredClone(p);
    fn(c);
    return c;
  });
  emit();
}

export function clearHistory() {
  past = [];
  future = [];
}

export function undo() {
  const prev = past.pop();
  if (!prev) return false;
  future.push(state);
  state = { ...prev, access: state.access, activeBoardId: prev.boards.some((b) => b.id === state.activeBoardId) ? state.activeBoardId : prev.activeBoardId };
  lastCoalesce = null;
  emit();
  return true;
}

export function redo() {
  const next = future.pop();
  if (!next) return false;
  past.push(state);
  state = { ...next, access: state.access };
  lastCoalesce = null;
  emit();
  return true;
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function boardIn(s: AppState, boardId: string): Board {
  const b = s.boards.find((x) => x.id === boardId);
  if (!b) throw new Error('Board not found');
  return b;
}

function cardIn(b: Board, cardId: string): Card {
  const c = b.cards.find((x) => x.id === cardId);
  if (!c) throw new Error('Card not found');
  return c;
}

export const actions = {
  // ----- app -----
  setTheme(theme: AppState['theme']) {
    update((s) => void (s.theme = theme), { history: false });
  },
  toggleSidebar() {
    update((s) => void (s.sidebarOpen = !s.sidebarOpen), { history: false });
  },
  setActiveBoard(id: string) {
    update((s) => void (s.activeBoardId = id), { history: false });
  },

  // ----- boards -----
  addBoard(): string {
    const b = newBoard('Untitled board');
    update((s) => {
      s.boards.push(b);
      s.activeBoardId = b.id;
    });
    return b.id;
  },
  renameBoard(id: string, name: string) {
    update((s) => void (boardIn(s, id).name = name), { coalesce: `board-name-${id}` });
  },
  setBoardIcon(id: string, icon: string) {
    update((s) => void (boardIn(s, id).icon = icon));
  },
  duplicateBoard(id: string) {
    update((s) => {
      const src = boardIn(s, id);
      const copy = structuredClone(src);
      copy.id = uid();
      copy.name = `${src.name} (copy)`;
      copy.createdAt = Date.now();
      copy.cards.forEach((c) => (c.id = uid()));
      s.boards.splice(s.boards.indexOf(src) + 1, 0, copy);
      s.activeBoardId = copy.id;
    });
  },
  deleteBoard(id: string) {
    update((s) => {
      const i = s.boards.findIndex((b) => b.id === id);
      if (i < 0) return;
      s.boards.splice(i, 1);
      if (s.activeBoardId === id) s.activeBoardId = s.boards[Math.max(0, i - 1)]?.id ?? null;
    });
  },
  moveBoard(id: string, toIndex: number) {
    update((s) => {
      const i = s.boards.findIndex((b) => b.id === id);
      if (i < 0) return;
      const [b] = s.boards.splice(i, 1);
      s.boards.splice(toIndex > i ? toIndex - 1 : toIndex, 0, b);
    });
  },

  // ----- view -----
  updateView(boardId: string, fn: (v: Board['view']) => void, coalesce?: string) {
    update((s) => fn(boardIn(s, boardId).view), { coalesce });
  },

  // ----- cards -----
  addCard(boardId: string, groupKey: string, position: 'top' | 'bottom', extra: Partial<Card> = {}): string {
    const id = uid();
    update((s) => {
      const b = boardIn(s, boardId);
      const g = b.view.groupBy;
      const gp = b.props.find((p) => p.id === g);
      const inGroup = b.cards.filter((c) => groupKeyOf(c, gp) === groupKey);
      const orders = inGroup.map((c) => c.order);
      const order = orders.length === 0 ? 1000 : position === 'top' ? Math.min(...orders) - 1000 : Math.max(...orders) + 1000;
      const props: Record<string, PropValue> = {};
      if (g && groupKey !== NONE_GROUP) props[g] = groupKey;
      // Carry over values from active "is" filters so the new card stays visible
      for (const f of b.view.filters) {
        const p = b.props.find((x) => x.id === f.propId);
        if (!p || f.op !== 'is' || !f.value || p.id === g) continue;
        if (p.type === 'select') props[p.id] = f.value;
        else if (p.type === 'multi_select') props[p.id] = [f.value];
      }
      const now = Date.now();
      b.cards.push({ id, title: '', props, content: '', order, createdAt: now, updatedAt: now, ...extra });
    });
    return id;
  },
  updateCard(boardId: string, cardId: string, fn: (c: Card) => void, coalesce?: string) {
    update(
      (s) => {
        const c = cardIn(boardIn(s, boardId), cardId);
        fn(c);
        c.updatedAt = Date.now();
      },
      { coalesce },
    );
  },
  setCardProp(boardId: string, cardId: string, propId: string, value: PropValue, coalesce?: string) {
    actions.updateCard(boardId, cardId, (c) => {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) delete c.props[propId];
      else c.props[propId] = value;
    }, coalesce);
  },
  duplicateCard(boardId: string, cardId: string): string {
    const id = uid();
    update((s) => {
      const b = boardIn(s, boardId);
      const src = cardIn(b, cardId);
      const sorted = [...b.cards].sort((a, z) => a.order - z.order);
      const next = sorted[sorted.indexOf(src) + 1];
      const copy = structuredClone(src);
      copy.id = id;
      copy.title = src.title ? `${src.title} (copy)` : '';
      copy.order = next ? (src.order + next.order) / 2 : src.order + 1000;
      copy.createdAt = copy.updatedAt = Date.now();
      b.cards.push(copy);
    });
    return id;
  },
  deleteCards(boardId: string, cardIds: string[]) {
    update((s) => {
      const b = boardIn(s, boardId);
      b.cards = b.cards.filter((c) => !cardIds.includes(c.id));
    });
  },
  /**
   * Move a card into a group, placing it between the given neighbours (by id) in
   * the currently displayed order. Neighbours are ignored when a sort is active.
   */
  moveCard(boardId: string, cardId: string, groupKey: string, beforeId: string | null, afterId: string | null) {
    update((s) => {
      const b = boardIn(s, boardId);
      const card = cardIn(b, cardId);
      const g = b.view.groupBy;
      if (g) {
        if (groupKey === NONE_GROUP) delete card.props[g];
        else card.props[g] = groupKey;
      }
      if (!b.view.sort) {
        const prev = beforeId ? b.cards.find((c) => c.id === beforeId) : null;
        const next = afterId ? b.cards.find((c) => c.id === afterId) : null;
        let order: number;
        if (prev && next) order = (prev.order + next.order) / 2;
        else if (prev) order = prev.order + 1000;
        else if (next) order = next.order - 1000;
        else order = card.order;
        card.order = order;
        if (prev && next && Math.abs(next.order - prev.order) < 1e-6) {
          // Renormalise to keep plenty of room between cards
          [...b.cards].sort((a, z) => a.order - z.order).forEach((c, i) => (c.order = (i + 1) * 1000));
        }
      }
      card.updatedAt = Date.now();
    });
  },

  // ----- properties -----
  addProp(boardId: string, type: PropDef['type'], name?: string): string {
    const id = uid();
    update((s) => {
      const b = boardIn(s, boardId);
      const base = name ?? defaultPropName(type);
      let n = base;
      let i = 2;
      while (b.props.some((p) => p.name === n)) n = `${base} ${i++}`;
      const prop: PropDef = { id, name: n, type };
      if (type === 'select' || type === 'multi_select') prop.options = [];
      b.props.push(prop);
      b.view.visibleProps.push(id);
    });
    return id;
  },
  updateProp(boardId: string, propId: string, fn: (p: PropDef) => void, coalesce?: string) {
    update((s) => {
      const p = boardIn(s, boardId).props.find((x) => x.id === propId);
      if (p) fn(p);
    }, { coalesce });
  },
  changePropType(boardId: string, propId: string, type: PropDef['type']) {
    update((s) => {
      const b = boardIn(s, boardId);
      const p = b.props.find((x) => x.id === propId);
      if (!p || p.type === type) return;
      const old = p.type;
      // Convert existing values as sensibly as we can
      for (const c of b.cards) {
        const v = c.props[propId];
        if (v === undefined) continue;
        let nv: PropValue = undefined;
        const asText = Array.isArray(v)
          ? v.map((id) => findOption(p, id)?.name ?? '').filter(Boolean).join(', ')
          : old === 'select' ? findOption(p, v)?.name ?? '' : String(v);
        if (type === 'text' || type === 'url') nv = asText;
        else if (type === 'number') nv = Number.isFinite(Number(asText)) && asText !== '' ? Number(asText) : undefined;
        else if (type === 'checkbox') nv = v === true || asText.toLowerCase() === 'true' || asText.toLowerCase() === 'yes';
        else if (type === 'date') nv = /^\d{4}-\d{2}-\d{2}$/.test(asText) ? asText : undefined;
        else if (type === 'select' || type === 'multi_select') {
          p.options ??= [];
          const names = (old === 'multi_select' || old === 'text') ? asText.split(',').map((x) => x.trim()).filter(Boolean) : asText ? [asText] : [];
          const ids = names.map((n) => {
            let o = p.options!.find((x) => x.name === n);
            if (!o) {
              o = { id: uid(), name: n, color: randomColor() };
              p.options!.push(o);
            }
            return o.id;
          });
          nv = type === 'select' ? ids[0] : ids;
        }
        if (nv === undefined || nv === '' || (Array.isArray(nv) && !nv.length)) delete c.props[propId];
        else c.props[propId] = nv;
      }
      p.type = type;
      if ((type === 'select' || type === 'multi_select')) p.options ??= [];
      if (b.view.groupBy === propId && type !== 'select') b.view.groupBy = null;
      b.view.filters = b.view.filters.filter((f) => f.propId !== propId);
    });
  },
  deleteProp(boardId: string, propId: string) {
    update((s) => {
      const b = boardIn(s, boardId);
      b.props = b.props.filter((p) => p.id !== propId);
      b.cards.forEach((c) => delete c.props[propId]);
      b.view.visibleProps = b.view.visibleProps.filter((x) => x !== propId);
      b.view.filters = b.view.filters.filter((f) => f.propId !== propId);
      if (b.view.sort?.propId === propId) b.view.sort = null;
      if (b.view.groupBy === propId) b.view.groupBy = b.props.find((p) => p.type === 'select')?.id ?? null;
    });
  },
  moveProp(boardId: string, propId: string, toIndex: number) {
    update((s) => {
      const b = boardIn(s, boardId);
      const i = b.props.findIndex((p) => p.id === propId);
      if (i < 0) return;
      const [p] = b.props.splice(i, 1);
      b.props.splice(toIndex > i ? toIndex - 1 : toIndex, 0, p);
    });
  },

  // ----- select options (which are also board columns) -----
  addOption(boardId: string, propId: string, name: string, color?: SelectOption['color']): string {
    const id = uid();
    update((s) => {
      const p = boardIn(s, boardId).props.find((x) => x.id === propId);
      if (!p) return;
      p.options ??= [];
      p.options.push({ id, name, color: color ?? randomColor() });
    });
    return id;
  },
  updateOption(boardId: string, propId: string, optionId: string, fn: (o: SelectOption) => void, coalesce?: string) {
    update((s) => {
      const o = boardIn(s, boardId).props.find((x) => x.id === propId)?.options?.find((x) => x.id === optionId);
      if (o) fn(o);
    }, { coalesce });
  },
  deleteOption(boardId: string, propId: string, optionId: string) {
    update((s) => {
      const b = boardIn(s, boardId);
      const p = b.props.find((x) => x.id === propId);
      if (!p?.options) return;
      p.options = p.options.filter((o) => o.id !== optionId);
      for (const c of b.cards) {
        const v = c.props[propId];
        if (v === optionId) delete c.props[propId];
        else if (Array.isArray(v)) {
          const nv = v.filter((x) => x !== optionId);
          if (nv.length) c.props[propId] = nv;
          else delete c.props[propId];
        }
      }
      b.view.hiddenGroups = b.view.hiddenGroups.filter((x) => x !== optionId);
      b.view.filters = b.view.filters.filter((f) => !(f.propId === propId && f.value === optionId));
    });
  },
  moveOption(boardId: string, propId: string, optionId: string, toIndex: number) {
    update((s) => {
      const p = boardIn(s, boardId).props.find((x) => x.id === propId);
      if (!p?.options) return;
      const i = p.options.findIndex((o) => o.id === optionId);
      if (i < 0) return;
      const [o] = p.options.splice(i, 1);
      p.options.splice(toIndex > i ? toIndex - 1 : toIndex, 0, o);
    });
  },
};

function defaultPropName(type: PropDef['type']): string {
  return {
    text: 'Text',
    number: 'Number',
    select: 'Select',
    multi_select: 'Tags',
    date: 'Date',
    checkbox: 'Checkbox',
    url: 'URL',
  }[type];
}

export function exportJSON(): string {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text: string): number {
  try {
    const parsed = JSON.parse(text) as AppState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.boards)) return 0;
    update((s) => {
      for (const b of parsed.boards) {
        const copy = migrateBoard(structuredClone(b));
        copy.id = uid();
        s.boards.push(copy);
      }
      if (parsed.boards[0]) s.activeBoardId = s.boards[s.boards.length - parsed.boards.length].id;
    });
    return parsed.boards.length;
  } catch {
    return 0;
  }
}
