import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';
import type { User } from '../src/shared.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 30;
const COOKIE = 'sid';
const secure = process.env.NODE_ENV === 'production';

export const newId = () => randomBytes(9).toString('base64url');
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

/** Used to make login timing the same whether or not the email exists. */
export const DUMMY_HASH = await hashPassword(newToken());

export function createSession(res: Response, userId: string) {
  const token = newToken();
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  res.cookie(COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400_000 });
}

/** Sign a user out everywhere, optionally keeping the session making this request. */
export function destroyOtherSessions(req: Request, userId: string, keepCurrent: boolean) {
  const token = keepCurrent ? readCookie(req, COOKIE) : undefined;
  if (token) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(token));
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function destroySession(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function userFromRequest(req: Request): User | null {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.last_seen_at, u.email_verified_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as
    | { id: string; email: string; name: string; last_seen_at: number | null; email_verified_at: number | null; expires_at: number }
    | undefined;
  const now = Date.now();
  if (!row || row.expires_at < now) return null;
  // Record activity, at most every 5 minutes per user
  if (!row.last_seen_at || now - row.last_seen_at > 5 * 60_000) {
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, row.id);
  }
  return { id: row.id, email: row.email, name: row.name, verified: !!row.email_verified_at };
}

/** Accounts that can open the admin dashboard (comma-separated ADMIN_EMAILS). */
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
);
export const isAdmin = (user: User | null | undefined) => !!user && ADMIN_EMAILS.has(user.email.toLowerCase());

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = userFromRequest(req);
  if (!user) return void res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

/**
 * CSRF defence on top of SameSite=Lax cookies: state-changing requests must be
 * JSON and, when the browser sends an Origin header, it must match our host.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    try {
      if (new URL(origin).host !== host) return void res.status(403).json({ error: 'Bad origin' });
    } catch {
      return void res.status(403).json({ error: 'Bad origin' });
    }
  }
  if (req.headers['content-length'] !== '0' && req.headers['content-length'] && !req.is('application/json')) {
    return void res.status(415).json({ error: 'JSON required' });
  }
  next();
}

// Very small in-memory limiter for auth endpoints
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  h.n++;
  return h.n <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 60_000).unref();
