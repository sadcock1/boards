import express, { type Request, type Response } from 'express';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { db, tx } from './db.ts';
import {
  createSession, csrfGuard, destroyOtherSessions, destroySession, DUMMY_HASH, hashPassword, isAdmin, newId, newToken, rateLimit, requireUser,
  sha256, userFromRequest, verifyPassword,
} from './auth.ts';
import { mailEnabled, sendMail } from './mail.ts';
import { applyPatch, isEmptyPatch, META_KEYS } from '../src/shared.ts';
import type { AdminStats, BoardData, BoardPatch, Role, ServerBoard, ServerEvent, SharingInfo } from '../src/shared.ts';

const PORT = Number(process.env.PORT ?? 5200);
const MAX_CARDS = 5000;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback, uniquelocal');
app.use(express.json({ limit: '5mb' }));
app.use('/api', csrfGuard);
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
/** Visitor IP for rate limiting (behind Cloudflare every request comes from a Cloudflare address). */
const clientIp = (req: Request) => String(req.headers['cf-connecting-ip'] ?? req.ip);
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

interface BoardRow {
  id: string;
  owner_id: string;
  data: string;
  version: number;
  link_token: string | null;
}

function roleFor(boardId: string, userId: string): Role | null {
  const b = db.prepare('SELECT owner_id FROM boards WHERE id = ?').get(boardId) as { owner_id: string } | undefined;
  if (!b) return null;
  if (b.owner_id === userId) return 'owner';
  const m = db.prepare('SELECT role FROM members WHERE board_id = ? AND user_id = ?').get(boardId, userId) as
    | { role: Role }
    | undefined;
  return m?.role ?? null;
}

/** Everyone who can see a board (owner + members). */
function audience(boardId: string): string[] {
  const rows = db
    .prepare('SELECT owner_id AS id FROM boards WHERE id = ? UNION SELECT user_id FROM members WHERE board_id = ?')
    .all(boardId, boardId) as { id: string }[];
  return rows.map((r) => r.id);
}

function validBoardData(d: unknown): d is BoardData {
  if (!d || typeof d !== 'object') return false;
  const b = d as BoardData;
  return (
    typeof b.name === 'string' &&
    Array.isArray(b.props) &&
    Array.isArray(b.cards) &&
    b.cards.length <= MAX_CARDS &&
    b.cards.every((c) => c && typeof c.id === 'string') &&
    !!b.view &&
    typeof b.view === 'object'
  );
}

function validPatch(p: unknown): p is BoardPatch {
  if (!p || typeof p !== 'object') return false;
  const patch = p as BoardPatch;
  if (patch.meta !== undefined) {
    if (typeof patch.meta !== 'object' || patch.meta === null) return false;
    for (const k of Object.keys(patch.meta)) if (!(META_KEYS as readonly string[]).includes(k)) return false;
  }
  if (patch.upsert !== undefined && !(Array.isArray(patch.upsert) && patch.upsert.every((c) => c && typeof c.id === 'string')))
    return false;
  if (patch.remove !== undefined && !(Array.isArray(patch.remove) && patch.remove.every((x) => typeof x === 'string')))
    return false;
  return true;
}

/** Turn any pending invites for this email into memberships (only once the email is verified). */
function claimInvites(userId: string, email: string) {
  const v = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(userId) as { email_verified_at: number | null } | undefined;
  if (!v?.email_verified_at) return;
  const invites = db.prepare('SELECT board_id, role FROM invites WHERE email = ?').all(email) as { board_id: string; role: Role }[];
  for (const inv of invites) {
    db.prepare('INSERT OR IGNORE INTO members (board_id, user_id, role) VALUES (?, ?, ?)').run(inv.board_id, userId, inv.role);
  }
  db.prepare('DELETE FROM invites WHERE email = ?').run(email);
}

// ---------------------------------------------------------------------------
// Live updates (Server-Sent Events), one stream per open tab
// ---------------------------------------------------------------------------
const streams = new Map<string, Set<Response>>();

function send(userIds: string[], ev: ServerEvent) {
  const payload = `data: ${JSON.stringify(ev)}\n\n`;
  for (const id of userIds) streams.get(id)?.forEach((res) => res.write(payload));
}

app.get('/api/events', requireUser, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\ndata: ${JSON.stringify({ type: 'hello' })}\n\n`);
  const uid = req.user!.id;
  if (!streams.has(uid)) streams.set(uid, new Set());
  streams.get(uid)!.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    streams.get(uid)?.delete(res);
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.post('/api/auth/signup', async (req, res) => {
  const email = str(req.body?.email, 200).toLowerCase();
  const name = str(req.body?.name, 80);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!rateLimit(`signup:${clientIp(req)}`, 10, 3600_000)) return void res.status(429).json({ error: 'Too many attempts, try again later' });
  if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: 'Enter a valid email address' });
  const badPassword = checkNewPassword(password);
  if (badPassword) return void res.status(400).json({ error: badPassword });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return void res.status(409).json({ error: 'An account with that email already exists' });
  const id = newId();
  const hash = await hashPassword(password);
  const now = Date.now();
  tx(() => {
    // Without email there's no way to verify, so accounts are trusted straight away (as before verification existed)
    db.prepare('INSERT INTO users (id, email, name, pass_hash, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, email, name || email.split('@')[0], hash, now, mailEnabled ? null : now,
    );
    claimInvites(id, email);
  });
  createSession(res, id);
  if (mailEnabled) sendVerification(req, id, email, name || email.split('@')[0]);
  res.json({ user: { id, email, name: name || email.split('@')[0], verified: !mailEnabled } });
});

app.post('/api/auth/login', async (req, res) => {
  const email = str(req.body?.email, 200).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
  if (!rateLimit(`login:${clientIp(req)}:${email}`, 10, 15 * 60_000) || !rateLimit(`login:${clientIp(req)}`, 50, 15 * 60_000))
    return void res.status(429).json({ error: 'Too many attempts, try again in a few minutes' });
  const row = db.prepare('SELECT id, email, name, pass_hash, email_verified_at FROM users WHERE email = ?').get(email) as
    | { id: string; email: string; name: string; pass_hash: string; email_verified_at: number | null }
    | undefined;
  const ok = await verifyPassword(password, row?.pass_hash ?? DUMMY_HASH);
  if (!row || !ok) return void res.status(401).json({ error: 'Wrong email or password' });
  claimInvites(row.id, row.email);
  createSession(res, row.id);
  res.json({ user: { id: row.id, email: row.email, name: row.name, verified: !!row.email_verified_at } });
});

// ---------------------------------------------------------------------------
// Passwords: forgot / reset by email, change while signed in
// ---------------------------------------------------------------------------
const RESET_MINUTES = 60;
/** Links in emails always point at the real site, never at whatever Host header a request sent. */
const APP_URL_ENV = process.env.APP_URL?.replace(/\/$/, '');
if (mailEnabled && !APP_URL_ENV && process.env.NODE_ENV === 'production')
  console.warn('[mail] APP_URL is not set: links in emails will use the address each request came in on. Set APP_URL to your site, e.g. https://boards.example.com');
/** Base URL for links in emails. Set APP_URL in production so links never depend on a request's Host header. */
const appUrl = (req: Request) => APP_URL_ENV ?? (process.env.NODE_ENV === 'production' ? `${req.protocol}://${req.get('host')}` : 'http://localhost:5199');

/** Email features answer 404 when this server has no email set up. */
function requireMail(_req: Request, res: Response, next: () => void) {
  if (!mailEnabled) return void res.status(404).json({ error: 'Email isn’t set up on this server' });
  next();
}

function checkNewPassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 200) return 'Password is too long';
  return null;
}

function resetRow(token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return undefined;
  return db
    .prepare('SELECT r.user_id, u.email, u.name FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires_at > ?')
    .get(sha256(token), Date.now()) as { user_id: string; email: string; name: string } | undefined;
}

function passwordChangedMail(email: string, name: string) {
  void sendMail({
    to: email,
    subject: 'Your Boards password was changed',
    text: `Hi ${name},\n\nThe password for your Boards account (${email}) was just changed, and you've been signed out on your other devices.\n\nIf this wasn't you, reset your password straight away using “Forgot password?” on the sign-in page.`,
  });
}

app.post('/api/auth/forgot', requireMail, (req, res) => {
  const email = str(req.body?.email, 200).toLowerCase();
  if (!rateLimit(`forgot:${clientIp(req)}`, 10, 3600_000) || !rateLimit(`forgot:${email}`, 3, 3600_000))
    return void res.status(429).json({ error: 'Too many reset requests, try again later' });
  if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: 'Enter a valid email address' });
  // Same answer whether or not the account exists, so this can't be used to find out who has one
  res.json({ ok: true });
  const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email) as
    | { id: string; email: string; name: string }
    | undefined;
  if (!user) return;
  const token = newToken();
  tx(() => {
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      sha256(token), user.id, Date.now() + RESET_MINUTES * 60_000,
    );
  });
  void sendMail({
    to: user.email,
    subject: 'Reset your Boards password',
    text: `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset the password for your Boards account. The link below works once and expires in ${RESET_MINUTES} minutes.\n\nIf you didn't ask for this, you can ignore this email and your password won't change.`,
    action: { label: 'Choose a new password', url: `${appUrl(req)}/reset?token=${token}` },
  });
});

/** Lets the reset page say "this link has expired" before asking for a password. */
app.post('/api/auth/reset/check', requireMail, (req, res) => {
  if (!rateLimit(`reset:${clientIp(req)}`, 30, 3600_000)) return void res.status(429).json({ error: 'Too many attempts, try again later' });
  const row = resetRow(req.body?.token);
  res.json({ valid: !!row, email: row?.email });
});

app.post('/api/auth/reset', requireMail, async (req, res) => {
  if (!rateLimit(`reset:${clientIp(req)}`, 30, 3600_000)) return void res.status(429).json({ error: 'Too many attempts, try again later' });
  const row = resetRow(req.body?.token);
  if (!row) return void res.status(400).json({ error: 'This reset link has expired or was already used. Request a new one.' });
  const bad = checkNewPassword(req.body?.password);
  if (bad) return void res.status(400).json({ error: bad });
  const hash = await hashPassword(req.body.password);
  tx(() => {
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hash, row.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
    // The reset link went to their inbox, so this also proves they own the email
    markVerified(row.user_id);
  });
  destroyOtherSessions(req, row.user_id, false);
  claimInvites(row.user_id, row.email);
  createSession(res, row.user_id);
  passwordChangedMail(row.email, row.name);
  res.json({ user: { id: row.user_id, email: row.email, name: row.name, verified: true } });
});

app.post('/api/auth/password', requireUser, async (req, res) => {
  const user = req.user!;
  if (!rateLimit(`password:${user.id}`, 10, 15 * 60_000)) return void res.status(429).json({ error: 'Too many attempts, try again in a few minutes' });
  const current = typeof req.body?.current === 'string' ? req.body.current.slice(0, 200) : '';
  const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(user.id) as { pass_hash: string };
  if (!(await verifyPassword(current, row.pass_hash))) return void res.status(400).json({ error: 'Your current password is wrong' });
  const bad = checkNewPassword(req.body?.password);
  if (bad) return void res.status(400).json({ error: bad });
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(req.body.password), user.id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
  destroyOtherSessions(req, user.id, true);
  passwordChangedMail(user.email, user.name);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Email verification ("soft": the app works straight away, but shared invites wait until verified)
// ---------------------------------------------------------------------------
const VERIFY_HOURS = 24;

function markVerified(userId: string) {
  db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(Date.now(), userId);
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(userId);
}

function sendVerification(req: Request, userId: string, email: string, name: string) {
  const token = newToken();
  tx(() => {
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(userId);
    db.prepare('INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      sha256(token), userId, Date.now() + VERIFY_HOURS * 3600_000,
    );
  });
  void sendMail({
    to: email,
    subject: 'Verify your email for Boards',
    text: `Hi ${name},\n\nThanks for signing up to Boards. Confirm this is your email address so people can share boards with you. The link works once and expires in ${VERIFY_HOURS} hours.\n\nIf you didn't create a Boards account, you can ignore this email.`,
    action: { label: 'Verify email', url: `${appUrl(req)}/verify?token=${token}` },
  });
}

app.post('/api/auth/verify', requireMail, (req, res) => {
  if (!rateLimit(`verify:${clientIp(req)}`, 30, 3600_000)) return void res.status(429).json({ error: 'Too many attempts, try again later' });
  const token = req.body?.token;
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return void res.status(400).json({ error: 'This verification link isn’t valid' });
  const row = db
    .prepare('SELECT v.user_id, u.email FROM email_verifications v JOIN users u ON u.id = v.user_id WHERE v.token_hash = ? AND v.expires_at > ?')
    .get(sha256(token), Date.now()) as { user_id: string; email: string } | undefined;
  if (!row) return void res.status(400).json({ error: 'This verification link has expired or was already used' });
  tx(() => markVerified(row.user_id));
  claimInvites(row.user_id, row.email);
  send([row.user_id], { type: 'access' }); // open tabs pick up boards that were waiting
  res.json({ ok: true, email: row.email });
});

app.post('/api/auth/verify/resend', requireMail, requireUser, (req, res) => {
  const user = req.user!;
  if (user.verified) return void res.json({ ok: true, alreadyVerified: true });
  if (!rateLimit(`verify-resend:${user.id}`, 3, 3600_000)) return void res.status(429).json({ error: 'We’ve sent a few already. Check your spam folder, or try again in an hour.' });
  sendVerification(req, user.id, user.email, user.name);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

/** What this server supports, so the sign-in screen can hide what isn't available. */
app.get('/api/config', (_req, res) => {
  res.json({ email: mailEnabled });
});

app.get('/api/auth/me', (req, res) => {
  const user = userFromRequest(req);
  res.json({ user: user && (isAdmin(user) ? { ...user, admin: true } : user) });
});

app.patch('/api/auth/me', requireUser, (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) return void res.status(400).json({ error: 'Name is required' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user!.id);
  res.json({ user: { ...req.user!, name } });
});

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------
app.get('/api/boards', requireUser, (req, res) => {
  const uid = req.user!.id;
  const rows = db
    .prepare(
      `SELECT b.id, b.data, b.version, b.owner_id, u.name AS owner_name, u.email AS owner_email,
              CASE WHEN b.owner_id = ? THEN 'owner' ELSE m.role END AS role
       FROM boards b
       JOIN users u ON u.id = b.owner_id
       LEFT JOIN members m ON m.board_id = b.id AND m.user_id = ?
       WHERE b.owner_id = ? OR m.user_id IS NOT NULL`,
    )
    .all(uid, uid, uid) as {
    id: string; data: string; version: number; owner_id: string; owner_name: string; owner_email: string; role: Role;
  }[];
  const boards: ServerBoard[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    version: r.version,
    owner: { id: r.owner_id, name: r.owner_name, email: r.owner_email },
    data: JSON.parse(r.data),
  }));
  res.json({ boards });
});

app.post('/api/boards', requireUser, (req, res) => {
  const id = str(req.body?.id, 64);
  const data = req.body?.data;
  if (!ID_RE.test(id)) return void res.status(400).json({ error: 'Bad board id' });
  if (!validBoardData(data)) return void res.status(400).json({ error: 'Bad board data' });
  const existing = db.prepare('SELECT owner_id, version FROM boards WHERE id = ?').get(id) as
    | { owner_id: string; version: number }
    | undefined;
  if (existing) {
    // Idempotent retry of a create from the same owner
    if (existing.owner_id === req.user!.id) return void res.json({ version: existing.version });
    return void res.status(409).json({ error: 'Board id taken' });
  }
  db.prepare('INSERT INTO boards (id, owner_id, data, version, updated_at) VALUES (?, ?, ?, 1, ?)').run(
    id, req.user!.id, JSON.stringify(data), Date.now(),
  );
  res.json({ version: 1 });
});

app.patch('/api/boards/:id', requireUser, (req, res) => {
  const id = String(req.params.id);
  const patch = req.body?.patch;
  const clientId = str(req.body?.clientId, 64);
  const role = roleFor(id, req.user!.id);
  if (!role) return void res.status(404).json({ error: 'Board not found' });
  if (role === 'viewer') return void res.status(403).json({ error: 'View-only access' });
  if (!validPatch(patch)) return void res.status(400).json({ error: 'Bad patch' });
  if (isEmptyPatch(patch)) {
    const v = db.prepare('SELECT version FROM boards WHERE id = ?').get(id) as { version: number };
    return void res.json({ version: v.version });
  }
  const version = tx(() => {
    const row = db.prepare('SELECT data, version FROM boards WHERE id = ?').get(id) as { data: string; version: number };
    const data = applyPatch(JSON.parse(row.data) as BoardData, patch);
    if (data.cards.length > MAX_CARDS) throw Object.assign(new Error('Too many cards'), { status: 400 });
    const next = row.version + 1;
    db.prepare('UPDATE boards SET data = ?, version = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), next, Date.now(), id);
    return next;
  });
  send(audience(id), { type: 'patch', boardId: id, version, patch, clientId });
  res.json({ version });
});

app.delete('/api/boards/:id', requireUser, (req, res) => {
  const id = String(req.params.id);
  const role = roleFor(id, req.user!.id);
  if (!role) return void res.json({ ok: true });
  if (role !== 'owner') return void res.status(403).json({ error: 'Only the owner can delete a board' });
  const who = audience(id);
  db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  send(who, { type: 'access' });
  res.json({ ok: true });
});

app.post('/api/boards/:id/leave', requireUser, (req, res) => {
  const id = String(req.params.id);
  db.prepare('DELETE FROM members WHERE board_id = ? AND user_id = ?').run(id, req.user!.id);
  send([req.user!.id], { type: 'access' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------
function sharingInfo(boardId: string): SharingInfo {
  const board = db.prepare('SELECT b.owner_id, b.link_token, u.name, u.email FROM boards b JOIN users u ON u.id = b.owner_id WHERE b.id = ?')
    .get(boardId) as { owner_id: string; link_token: string | null; name: string; email: string };
  const members = db
    .prepare('SELECT m.user_id, m.role, u.name, u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? ORDER BY u.name')
    .all(boardId) as { user_id: string; role: Role; name: string; email: string }[];
  const invites = db.prepare('SELECT email, role FROM invites WHERE board_id = ? ORDER BY created_at').all(boardId) as unknown as SharingInfo['invites'];
  return {
    members: [
      { userId: board.owner_id, name: board.name, email: board.email, role: 'owner' },
      ...members.map((m) => ({ userId: m.user_id, name: m.name, email: m.email, role: m.role })),
    ],
    invites,
    linkToken: board.link_token,
  };
}

/** Members can see who has access; only the owner can change it. */
function sharingAccess(req: Request, res: Response, ownerOnly: boolean): boolean {
  const role = roleFor(String(req.params.id), req.user!.id);
  if (!role) return void res.status(404).json({ error: 'Board not found' }), false;
  if (ownerOnly && role !== 'owner') return void res.status(403).json({ error: 'Only the owner can change sharing' }), false;
  return true;
}

app.get('/api/boards/:id/sharing', requireUser, (req, res) => {
  if (!sharingAccess(req, res, false)) return;
  res.json(sharingInfo(String(req.params.id)));
});

app.post('/api/boards/:id/invites', requireUser, (req, res) => {
  if (!sharingAccess(req, res, true)) return;
  const id = String(req.params.id);
  const email = str(req.body?.email, 200).toLowerCase();
  const role = req.body?.role === 'viewer' ? 'viewer' : 'editor';
  if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: 'Enter a valid email address' });
  if (email === req.user!.email.toLowerCase()) return void res.status(400).json({ error: 'You already own this board' });
  // Only give access straight away to an account that has proved it owns this email;
  // otherwise keep a pending invite, which is claimed when they verify
  const user = db.prepare('SELECT id FROM users WHERE email = ? AND email_verified_at IS NOT NULL').get(email) as { id: string } | undefined;
  if (user) {
    db.prepare('INSERT INTO members (board_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET role = excluded.role').run(id, user.id, role);
    send([user.id], { type: 'access' });
  } else {
    db.prepare(
      'INSERT INTO invites (board_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET role = excluded.role',
    ).run(id, email, role, req.user!.id, Date.now());
  }
  res.json({ ...sharingInfo(id), added: user ? 'member' : 'invite' });
});

app.patch('/api/boards/:id/members/:userId', requireUser, (req, res) => {
  if (!sharingAccess(req, res, true)) return;
  const role = req.body?.role === 'viewer' ? 'viewer' : 'editor';
  db.prepare('UPDATE members SET role = ? WHERE board_id = ? AND user_id = ?').run(role, String(req.params.id), String(req.params.userId));
  send([String(req.params.userId)], { type: 'access' });
  res.json(sharingInfo(String(req.params.id)));
});

app.delete('/api/boards/:id/members/:userId', requireUser, (req, res) => {
  if (!sharingAccess(req, res, true)) return;
  db.prepare('DELETE FROM members WHERE board_id = ? AND user_id = ?').run(String(req.params.id), String(req.params.userId));
  send([String(req.params.userId)], { type: 'access' });
  res.json(sharingInfo(String(req.params.id)));
});

app.delete('/api/boards/:id/invites/:email', requireUser, (req, res) => {
  if (!sharingAccess(req, res, true)) return;
  db.prepare('DELETE FROM invites WHERE board_id = ? AND email = ?').run(String(req.params.id), String(req.params.email));
  res.json(sharingInfo(String(req.params.id)));
});

app.post('/api/boards/:id/link', requireUser, (req, res) => {
  if (!sharingAccess(req, res, true)) return;
  const token = req.body?.enabled ? newToken(18) : null;
  db.prepare('UPDATE boards SET link_token = ? WHERE id = ?').run(token, String(req.params.id));
  res.json(sharingInfo(String(req.params.id)));
});

// Public, read-only board by link
app.get('/api/shared/:token', (req, res) => {
  const row = db
    .prepare('SELECT b.id, b.data, b.version, u.name FROM boards b JOIN users u ON u.id = b.owner_id WHERE b.link_token = ?')
    .get(String(req.params.token)) as (BoardRow & { name: string }) | undefined;
  if (!row) return void res.status(404).json({ error: 'This link is no longer active' });
  res.json({ id: row.id, version: row.version, ownerName: row.name, data: JSON.parse(row.data) });
});

// ---------------------------------------------------------------------------
// Admin dashboard (only for ADMIN_EMAILS; everyone else gets a plain 404)
// ---------------------------------------------------------------------------
app.get('/api/admin/stats', requireUser, (req, res) => {
  if (!isAdmin(req.user)) return void res.status(404).json({ error: 'Not found' });
  const now = Date.now();
  const DAY = 86400_000;
  const users = db.prepare('SELECT id, name, email, created_at, last_seen_at, email_verified_at FROM users ORDER BY created_at DESC').all() as {
    id: string; name: string; email: string; created_at: number; last_seen_at: number | null; email_verified_at: number | null;
  }[];
  const boards = db.prepare('SELECT id, owner_id, data, link_token FROM boards').all() as {
    id: string; owner_id: string; data: string; link_token: string | null;
  }[];
  const members = db.prepare('SELECT board_id, user_id FROM members').all() as { board_id: string; user_id: string }[];
  const pendingInvites = (db.prepare('SELECT COUNT(*) AS n FROM invites').get() as { n: number }).n;

  const owned = new Map<string, { boards: number; cards: number }>();
  let cards = 0;
  for (const b of boards) {
    let n = 0;
    try {
      n = (JSON.parse(b.data) as BoardData).cards?.length ?? 0;
    } catch {
      /* corrupt row: count as empty */
    }
    cards += n;
    const o = owned.get(b.owner_id) ?? { boards: 0, cards: 0 };
    o.boards++;
    o.cards += n;
    owned.set(b.owner_id, o);
  }
  const sharedWith = new Map<string, number>();
  for (const m of members) sharedWith.set(m.user_id, (sharedWith.get(m.user_id) ?? 0) + 1);
  const isOnline = (id: string) => (streams.get(id)?.size ?? 0) > 0;
  const seenWithin = (ms: number) => users.filter((u) => u.last_seen_at && now - u.last_seen_at < ms).length;

  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  const signups: AdminStats['signups'] = [];
  for (let i = 29; i >= 0; i--) signups.push({ day: dayKey(now - i * DAY), count: 0 });
  const byDay = new Map(signups.map((d) => [d.day, d]));
  for (const u of users) {
    const d = byDay.get(dayKey(u.created_at));
    if (d) d.count++;
  }

  let dbBytes = 0;
  for (const f of [process.env.DB_FILE ?? './data/board.db']) {
    for (const suffix of ['', '-wal']) {
      try {
        dbBytes += statSync(f + suffix).size;
      } catch {
        /* missing */
      }
    }
  }

  const stats: AdminStats = {
    generatedAt: now,
    totals: {
      users: users.length,
      unverified: users.filter((u) => !u.email_verified_at).length,
      newUsers7d: users.filter((u) => now - u.created_at < 7 * DAY).length,
      newUsers30d: users.filter((u) => now - u.created_at < 30 * DAY).length,
      active1d: seenWithin(DAY),
      active7d: seenWithin(7 * DAY),
      active30d: seenWithin(30 * DAY),
      onlineNow: users.filter((u) => isOnline(u.id)).length,
      boards: boards.length,
      cards,
      sharedBoards: new Set(members.map((m) => m.board_id)).size,
      publicLinks: boards.filter((b) => b.link_token).length,
      memberships: members.length,
      pendingInvites,
      dbBytes,
    },
    signups,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
      verified: !!u.email_verified_at,
      online: isOnline(u.id),
      boardsOwned: owned.get(u.id)?.boards ?? 0,
      cards: owned.get(u.id)?.cards ?? 0,
      sharedWithThem: sharedWith.get(u.id) ?? 0,
    })),
  };
  res.json(stats);
});

app.use('/api', (_req, res) => void res.status(404).json({ error: 'Not found' }));

// ---------------------------------------------------------------------------
// Static app (production)
// ---------------------------------------------------------------------------
const dist = resolve(process.env.STATIC_DIR ?? 'dist');
if (existsSync(dist)) {
  app.use(
    express.static(dist, {
      index: false,
      setHeaders(res, path) {
        if (path.includes(`${join('assets', '')}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(dist, 'index.html'));
  });
}

// Errors
app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: unknown) => {
  if (err.type === 'entity.too.large') return void res.status(413).json({ error: 'Too large' });
  if (err.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Bad JSON' });
  if (err.status && err.status < 500) return void res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, () => console.log(`board server on http://localhost:${PORT}`));
