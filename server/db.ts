import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const file = process.env.DB_FILE ?? './data/board.db';
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name       TEXT NOT NULL,
    pass_hash  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS boards (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    link_token TEXT UNIQUE,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS boards_owner ON boards(owner_id);

  CREATE TABLE IF NOT EXISTS members (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role     TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    PRIMARY KEY (board_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS members_user ON members(user_id);

  CREATE TABLE IF NOT EXISTS invites (
    board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    email      TEXT NOT NULL COLLATE NOCASE,
    role       TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    invited_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (board_id, email)
  );
`);

// Single-use password reset links (only a hash of the token is stored)
db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);
`);

// Email verification: single-use links, only a hash of the token is stored
db.exec(`
  CREATE TABLE IF NOT EXISTS email_verifications (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS email_verifications_user ON email_verifications(user_id);
`);
// Added later: when the user proved they own their email. Accounts from before this existed count as verified.
if (!(db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).some((c) => c.name === 'email_verified_at')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified_at INTEGER');
  db.exec('UPDATE users SET email_verified_at = created_at');
}

// Email is optional. Without it nobody can verify, so trust every account (switching email off later
// must not leave people stuck behind a verification step they can't complete)
if (!process.env.SMTP_HOST && process.env.MAIL_LOG !== '1') {
  db.exec('UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL');
}

// Added later: when each user last used the app (for the admin dashboard)
if (!(db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).some((c) => c.name === 'last_seen_at')) {
  db.exec('ALTER TABLE users ADD COLUMN last_seen_at INTEGER');
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Periodically clear expired sessions
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(Date.now());
  db.prepare('DELETE FROM email_verifications WHERE expires_at < ?').run(Date.now());
}, 3600_000).unref();
