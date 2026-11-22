// Types shared by the client and the server.
import type { Board, Card } from './types';

export type Role = 'owner' | 'editor' | 'viewer';

/** The part of a board that is stored on the server (everything but the id). */
export type BoardData = Omit<Board, 'id'>;

/** Board-level metadata fields that are replaced wholesale when patched. */
export const META_KEYS = ['name', 'icon', 'props', 'view'] as const;
export type MetaKey = (typeof META_KEYS)[number];

export interface BoardPatch {
  meta?: Partial<Pick<Board, MetaKey>>;
  upsert?: Card[];
  remove?: string[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  /** Has clicked the link in their verification email */
  verified?: boolean;
  /** Can open the admin dashboard (only sent by /api/auth/me) */
  admin?: boolean;
}

export interface AdminStats {
  generatedAt: number;
  totals: {
    users: number;
    unverified: number;
    newUsers7d: number;
    newUsers30d: number;
    active1d: number;
    active7d: number;
    active30d: number;
    onlineNow: number;
    boards: number;
    cards: number;
    sharedBoards: number;
    publicLinks: number;
    memberships: number;
    pendingInvites: number;
    dbBytes: number;
  };
  /** Sign-ups per day for the last 30 days, oldest first */
  signups: { day: string; count: number }[];
  users: {
    id: string;
    name: string;
    email: string;
    createdAt: number;
    lastSeenAt: number | null;
    verified: boolean;
    online: boolean;
    boardsOwned: number;
    cards: number;
    sharedWithThem: number;
  }[];
}

export interface ServerBoard {
  id: string;
  role: Role;
  version: number;
  owner: { id: string; name: string; email: string };
  data: BoardData;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface Invite {
  email: string;
  role: Exclude<Role, 'owner'>;
}

export interface SharingInfo {
  members: Member[];
  invites: Invite[];
  linkToken: string | null;
}

export type ServerEvent =
  | { type: 'patch'; boardId: string; version: number; patch: BoardPatch; clientId: string }
  | { type: 'access' } // board list / roles changed: refetch
  | { type: 'hello' };

/** Apply a patch to a board in place. */
export function applyPatch<T extends { cards: Card[] } & Partial<Pick<Board, MetaKey>>>(board: T, patch: BoardPatch): T {
  if (patch.meta) {
    for (const k of META_KEYS) {
      if (k in patch.meta) (board as Record<string, unknown>)[k] = structuredClone(patch.meta[k]);
    }
  }
  if (patch.remove?.length) {
    const rm = new Set(patch.remove);
    board.cards = board.cards.filter((c) => !rm.has(c.id));
  }
  if (patch.upsert?.length) {
    const idx = new Map(board.cards.map((c, i) => [c.id, i]));
    for (const c of patch.upsert) {
      const i = idx.get(c.id);
      if (i === undefined) {
        idx.set(c.id, board.cards.length);
        board.cards.push(structuredClone(c));
      } else board.cards[i] = structuredClone(c);
    }
  }
  return board;
}

export const isEmptyPatch = (p: BoardPatch) => !p.meta && !p.upsert?.length && !p.remove?.length;
