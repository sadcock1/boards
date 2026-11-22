/**
 * Sync engine: keeps the local store in step with the server.
 *
 * - The UI only ever edits the local store (so it works offline and feels instant).
 * - `lastSynced` holds the server's copy of each board as of our last exchange.
 *   Local changes are found by diffing the store against it and sent as small
 *   patches (board metadata + changed / removed cards).
 * - Patches from collaborators arrive over Server-Sent Events and are applied to
 *   `lastSynced`, and to the store wherever we have no unsent edit of our own.
 * - Everything (store + lastSynced) is cached per user in localStorage, so the
 *   app opens instantly and unsent edits survive reloads and going offline.
 */
import { useSyncExternalStore } from 'react';
import type { AppState, Board, BoardAccess } from './types';
import type { BoardPatch, ServerBoard, ServerEvent, User } from './shared';
import { applyPatch, isEmptyPatch, META_KEYS } from './shared';
import { api, ApiError } from './api';
import { applyEverywhere, clearHistory, emptyState, getState, LEGACY_KEY, loadState, migrateBoard, onChange, roleOf, update } from './store';
import { seedState } from './seed';
import { uid } from './utils';
import { toast } from './components/ui';

type Status = 'saved' | 'saving' | 'offline' | 'error';

const clientId = uid();
const cacheKey = (userId: string) => `board-cache-v2:${userId}`;
const LAST_USER = 'board-last-user';

let user: User | null = null;
let lastSynced: Record<string, Board> = {};
let status: Status = 'saved';
let flushing = false;
let again = false;
let flushTimer: number | undefined;
let retryTimer: number | undefined;
let events: EventSource | null = null;
let unsub: (() => void) | null = null;
let connectedOnce = false;

// ----- status for the UI -----
const statusListeners = new Set<() => void>();
function setStatus(s: Status) {
  if (s === status) return;
  status = s;
  statusListeners.forEach((l) => l());
}
export function useSyncStatus(): Status {
  return useSyncExternalStore(
    (cb) => (statusListeners.add(cb), () => statusListeners.delete(cb)),
    () => status,
  );
}

// ----- helpers -----
const toData = (b: Board) => {
  const { id: _id, ...data } = b;
  return data;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Which tab (board / table) you're looking at is personal, not shared. */
const sharedPart = (k: string, v: unknown) => (k === 'view' && v ? { ...(v as Board['view']), layout: null } : v);
const sameMeta = (k: string, a: unknown, b: unknown) => same(sharedPart(k, a), sharedPart(k, b));
const keepLayout = (target: Board, layout: Board['view']['layout'] | undefined) => {
  if (layout) target.view.layout = layout;
};

export function diffBoard(base: Board, cur: Board): BoardPatch {
  const patch: BoardPatch = {};
  for (const k of META_KEYS) {
    if (!sameMeta(k, base[k], cur[k])) (patch.meta ??= {})[k] = structuredClone(cur[k]) as never;
  }
  const baseCards = new Map(base.cards.map((c) => [c.id, c]));
  const upsert = cur.cards.filter((c) => {
    const b = baseCards.get(c.id);
    return !b || !same(b, c);
  });
  const curIds = new Set(cur.cards.map((c) => c.id));
  const remove = base.cards.filter((c) => !curIds.has(c.id)).map((c) => c.id);
  if (upsert.length) patch.upsert = upsert;
  if (remove.length) patch.remove = remove;
  return patch;
}

/**
 * Keep only the parts of a remote patch that don't collide with an unsent local
 * edit. `before` is the server copy the local board was last synced against.
 */
function mergeRemote(local: Board, before: Board, patch: BoardPatch) {
  const filtered: BoardPatch = {};
  if (patch.meta) {
    for (const k of META_KEYS) {
      if (k in patch.meta && sameMeta(k, local[k], before[k])) (filtered.meta ??= {})[k] = patch.meta[k] as never;
    }
  }
  const localCards = new Map(local.cards.map((c) => [c.id, c]));
  const beforeCards = new Map(before.cards.map((c) => [c.id, c]));
  const untouched = (id: string) => same(localCards.get(id), beforeCards.get(id));
  filtered.upsert = patch.upsert?.filter((c) => untouched(c.id));
  filtered.remove = patch.remove?.filter((id) => untouched(id));
  const layout = local.view.layout;
  applyPatch(local, filtered);
  keepLayout(local, layout);
}

function saveCache(s: AppState = getState()) {
  if (!user) return;
  try {
    localStorage.setItem(cacheKey(user.id), JSON.stringify({ state: s, lastSynced }));
  } catch {
    /* storage full */
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
export function start(u: User) {
  stop();
  user = u;
  try {
    localStorage.setItem(LAST_USER, JSON.stringify(u));
  } catch {
    /* ignore */
  }
  let cached: { state: AppState; lastSynced: Record<string, Board> } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(cacheKey(u.id)) ?? 'null');
  } catch {
    /* corrupt cache */
  }
  lastSynced = cached?.lastSynced ?? {};
  Object.values(lastSynced).forEach(migrateBoard);
  loadState(cached?.state ?? emptyState(), saveCache);
  unsub = onChange(scheduleFlush);
  window.addEventListener('online', onOnline);
  void reconcile(true);
  connect();
}

export function stop() {
  unsub?.();
  unsub = null;
  events?.close();
  events = null;
  connectedOnce = false;
  window.removeEventListener('online', onOnline);
  window.clearTimeout(flushTimer);
  window.clearTimeout(retryTimer);
  user = null;
  lastSynced = {};
}

/** Sign out: drop the local cache for this user on this device. */
export function forget(userId: string) {
  try {
    localStorage.removeItem(cacheKey(userId));
    localStorage.removeItem(LAST_USER);
  } catch {
    /* ignore */
  }
}

export function lastUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_USER) ?? 'null');
  } catch {
    return null;
  }
}

function onOnline() {
  void reconcile(false);
  if (!events || events.readyState === EventSource.CLOSED) connect();
}

function connect() {
  events?.close();
  events = new EventSource('/api/events');
  events.onmessage = (e) => {
    let ev: ServerEvent;
    try {
      ev = JSON.parse(e.data);
    } catch {
      return;
    }
    if (ev.type === 'hello') {
      // After a reconnect we may have missed patches: re-fetch everything
      if (connectedOnce) void reconcile(false);
      connectedOnce = true;
    } else if (ev.type === 'access') void reconcile(false);
    else if (ev.type === 'patch') onRemotePatch(ev);
  };
}

function onRemotePatch(ev: Extract<ServerEvent, { type: 'patch' }>) {
  if (ev.clientId === clientId) return; // our own echo
  const before = lastSynced[ev.boardId];
  if (!before) return void reconcile(false);
  const snapshot = structuredClone(before);
  applyPatch(before, ev.patch);
  applyEverywhere((s) => {
    const local = s.boards.find((b) => b.id === ev.boardId);
    if (local) mergeRemote(local, snapshot, ev.patch);
  });
  saveCache();
}

/**
 * Fetch every board from the server and rebuild local state from it, replaying
 * any unsent local edits on top.
 */
async function reconcile(initial: boolean) {
  if (!user) return;
  let serverBoards: ServerBoard[];
  try {
    serverBoards = (await api<{ boards: ServerBoard[] }>('/boards')).boards;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return void window.dispatchEvent(new Event('signed-out'));
    setStatus('offline');
    scheduleRetry();
    return;
  }
  if (!user) return;

  const s = getState();
  const next = structuredClone(s);
  const access: Record<string, BoardAccess> = {};
  const nextSynced: Record<string, Board> = {};
  const byId = new Map(s.boards.map((b) => [b.id, b]));
  const result: Board[] = [];

  for (const sb of serverBoards) {
    const server = migrateBoard({ id: sb.id, ...sb.data } as Board);
    nextSynced[sb.id] = server;
    access[sb.id] = { role: sb.role, ownerName: sb.role === 'owner' ? undefined : sb.owner.name };
    const local = byId.get(sb.id);
    const base = lastSynced[sb.id];
    const merged = structuredClone(server);
    if (local && base && sb.role !== 'viewer') applyPatch(merged, diffBoard(base, local));
    else if (local && sb.role === 'viewer') merged.view = local.view; // viewers keep their own filters
    keepLayout(merged, local?.view.layout);
    result.push(merged);
  }
  // Boards created on this device that the server hasn't seen yet
  for (const b of s.boards) if (!nextSynced[b.id] && !lastSynced[b.id]) result.push(b);

  // Keep the user's own board order; new boards go at the end
  const order = new Map(s.boards.map((b, i) => [b.id, i]));
  result.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));

  next.boards = result;
  next.access = access;
  if (!result.some((b) => b.id === next.activeBoardId)) next.activeBoardId = result[0]?.id ?? null;
  lastSynced = nextSynced;
  clearHistory();
  loadState(next, saveCache);

  if (initial) firstRunImports(serverBoards.length);
  setStatus('saved');
  scheduleFlush(0);
}

/** Bring boards from the pre-accounts version over, or give new users a starter board. */
function firstRunImports(serverCount: number) {
  let legacy: AppState | null = null;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null');
  } catch {
    /* ignore */
  }
  if (legacy?.boards?.length) {
    const have = new Set(getState().boards.map((b) => b.id));
    const fresh = legacy.boards.filter((b) => !have.has(b.id));
    if (fresh.length) {
      update((s) => {
        s.boards.push(...fresh.map((b) => migrateBoard(structuredClone(b))));
        s.activeBoardId ??= fresh[0].id;
      }, { history: false });
      toast(`Moved ${fresh.length} board${fresh.length > 1 ? 's' : ''} from this browser into your account`);
    }
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  if (serverCount === 0 && getState().boards.length === 0) {
    const starter = seedState().boards[0];
    update((s) => {
      s.boards.push(starter);
      s.activeBoardId = starter.id;
    }, { history: false });
  }
}

// ---------------------------------------------------------------------------
// Pushing local changes
// ---------------------------------------------------------------------------
function scheduleFlush(delay = 400) {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), delay);
}

function scheduleRetry() {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void reconcile(false), 8000);
}

async function flush() {
  if (!user) return;
  if (flushing) {
    again = true;
    return;
  }
  flushing = true;
  let sent = false;
  try {
    const s = getState();

    // Deleted (or left) boards
    for (const id of Object.keys(lastSynced)) {
      if (s.boards.some((b) => b.id === id)) continue;
      setStatus('saving');
      sent = true;
      if (roleOf(s, id) === 'owner') await api(`/boards/${id}`, { method: 'DELETE' });
      else await api(`/boards/${id}/leave`, { body: {} });
      delete lastSynced[id];
    }

    for (const b of s.boards) {
      const base = lastSynced[b.id];
      if (!base) {
        // New board
        setStatus('saving');
        sent = true;
        await api('/boards', { body: { id: b.id, data: toData(b) } });
        lastSynced[b.id] = structuredClone(b);
        if (!getState().access?.[b.id]) {
          applyEverywhere((st) => void ((st.access ??= {})[b.id] = { role: 'owner' }));
        }
        continue;
      }
      if (roleOf(s, b.id) === 'viewer') continue;
      const patch = diffBoard(base, b);
      if (isEmptyPatch(patch)) continue;
      setStatus('saving');
      sent = true;
      await api(`/boards/${b.id}`, { method: 'PATCH', body: { clientId, patch } });
      // Apply what we sent to the server copy (keeps any remote changes that arrived meanwhile)
      if (lastSynced[b.id]) applyPatch(lastSynced[b.id], patch);
    }
    setStatus('saved');
    if (sent) saveCache();
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      setStatus('offline');
      scheduleRetry();
    } else if (e instanceof ApiError && e.status === 401) {
      window.dispatchEvent(new Event('signed-out'));
    } else {
      // Permission changed, board deleted, etc: resync from the server
      setStatus('error');
      if (e instanceof ApiError && e.status === 403) toast(e.message);
      void reconcile(false);
    }
  } finally {
    flushing = false;
    if (again) {
      again = false;
      scheduleFlush(0);
    }
  }
}

/** Has this board reached the server yet? */
export const isSynced = (boardId: string) => !!lastSynced[boardId];
