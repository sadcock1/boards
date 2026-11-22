<p align="center">
  <img src="public/icons/icon-192.png" width="96" height="96" alt="Boards logo">
</p>

<h1 align="center">Boards</h1>

<p align="center">
  Simple kanban and table boards you can share and edit together in real time.<br>
  Notion's board view without the rest of Notion. Self-hosted, one Node process, one SQLite file.
</p>

---

## Why Boards

- **Fast and focused.** Boards, cards, properties, done. Every edit is instant because the app edits a local copy first and syncs in the background.
- **Works offline.** Install it as an app on your phone or desktop. It opens without a connection and syncs your changes when you're back online.
- **Real-time collaboration.** Share a board and see each other's changes as they happen. Edits merge card by card, so two people working on different cards never overwrite each other.
- **Free for personal and non-commercial use.** See the [license](#license).
- **Easy to host.** No external database, no Redis, no build step on the server beyond Docker. Your data is a single SQLite file you can copy to back up.
- **Email is optional.** Plug in any SMTP provider to get email verification and password resets, or run without email entirely.

## Features

### Boards and cards
- **Multiple boards** in a sidebar with emoji icons. Rename, reorder by dragging, duplicate, delete
- **Notion-style columns**: group a board by any select property. Drag columns to reorder, rename, recolour or hide them, with a "No status" column for ungrouped cards
- **Cards**: drag within and between columns, create inline, right-click for more, duplicate, delete with undo
- **Custom properties**: text, number, select, multi-select, date, checkbox and URL. Choose which show on cards and in what order
- **Card pages** open as a side peek or a centred page, with editable properties, an emoji icon and Markdown notes (headings, lists, links, code, and `- [ ]` checklists you can tick). Checklist progress shows on the card
- **Overdue dates** are flagged in red, except in a "Done" column

### Views
- **Board and table views** share the same filters, sort and grouping
- **Table view**: edit any cell inline, resize and hide columns, drag rows, collapse groups, select rows to delete in bulk
- **Filter, sort and search**: filter chips per property, sort by any property or by hand, full-text search
- **Undo and redo** for everything (⌘Z / ⇧⌘Z), never undoing other people's changes
- **Light, dark or system theme**, and the browser tab shows the current board's emoji

### Sharing and accounts
- **Email and password accounts** with scrypt-hashed passwords, HttpOnly session cookies and rate-limited sign-in
- **Share by email** as *Can edit* or *Can view*. People who don't have an account yet get access when they sign up
- **Public read-only link** for anyone, no account needed
- **Change password** from the account menu, which signs you out on your other devices
- **Import and export** all your boards as JSON (format documented in [`docs/json-format.md`](docs/json-format.md))

### With email switched on
- **Email verification**: new accounts can use the app straight away and see a banner until they click the link. Boards shared with an email address only appear once that address is verified, so nobody can claim someone else's invites by signing up with their email
- **Forgot password**: a single-use reset link that expires after an hour. Resetting signs you out everywhere else
- **"Password changed" notices** after every reset or change

### For the admin
- **Admin dashboard** at `/admin`: total and new users, who's online, active users today / this week / this month, boards, cards, shares, a sign-ups chart and a searchable user table. Counts only: it never shows what's on anyone's boards

## Quick start

Needs **Node 22.18 or newer** (Boards uses the built-in `node:sqlite` module and runs its TypeScript server directly).

```bash
git clone https://github.com/sadcock1/boards.git
cd boards
npm install
npm run server   # API on http://localhost:5200, data in ./data/board.db
npm run dev      # app on http://localhost:5199
```

Open http://localhost:5199 and create an account. In development, emails (verification, password resets) aren't sent; they're printed in the `npm run server` output so you can click the links.

## Self-hosting

### With Docker (recommended)

```bash
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env     # optional: admin and email settings
docker compose up -d --build
```

Boards is now on port 3000, with its database in `./data`. Put it behind a reverse proxy that adds HTTPS (Caddy, nginx, Traefik), because sign-in cookies are marked secure in production.

### Without Docker

```bash
npm install
npm run build
NODE_ENV=production PORT=3000 npm start
```

One process serves both the app and the API.

### Configuration

Every setting is an environment variable, and all of them are optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `5200` | Port to listen on |
| `DB_FILE` | `./data/board.db` | Where the SQLite database lives |
| `STATIC_DIR` | `./dist` | Built app files to serve |
| `NODE_ENV` | | Set to `production` for secure cookies |
| `ADMIN_EMAILS` | none | Comma-separated accounts that can open `/admin` |
| `APP_URL` | the request's address | Public address of your site, used for links in emails. Set this in production |

### Email (optional)

Set `SMTP_HOST` to switch the email features on. Any SMTP provider works.

| Variable | Example | |
| --- | --- | --- |
| `SMTP_HOST` | `smtp.example.com` | Leave unset to run without email |
| `SMTP_PORT` | `465` | `465` for TLS, `587` for STARTTLS |
| `SMTP_USER` | `boards@example.com` | Usually your full email address |
| `SMTP_PASS` | | Your SMTP password or app password |
| `MAIL_FROM` | `Boards <boards@example.com>` | Sender shown in inboxes |

**Without email**, Boards works as before: there's no verification step, the "Forgot password?" link is hidden, and people get boards shared with their email as soon as they sign up. You can switch email on or off at any time; turning it off marks everyone as verified so nobody gets stuck.

To keep emails out of spam, set up SPF and DKIM for your sending domain. Your email provider will have instructions.

### Deploying updates

[`scripts/deploy.sh`](scripts/deploy.sh) uploads the source to a server running Docker Compose and rebuilds the container, without touching the database or the server's `.env`. Copy `scripts/deploy.env.example` to `scripts/deploy.env` and fill in your server's details; that file is ignored by git.

### Backups

Everything lives in the `data` folder (`board.db` plus its `-wal` file). Copy that folder to back up, ideally while the server is stopped or using `sqlite3 board.db ".backup backup.db"`.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌘\\ | Toggle the sidebar |
| ↑ / ↓ or J / K | Previous / next card while one is open |
| Esc | Close a card or menu |

## How it works

- The UI only ever edits a local copy of your boards, kept in `localStorage`, so it's instant and works offline.
- A sync engine diffs that copy against the last version the server confirmed and sends small patches: changed board settings, plus the cards that were added, changed or removed.
- Collaborators' changes arrive over Server-Sent Events and are merged in wherever you don't have an unsent edit of your own.
- A service worker caches the app so it opens without a connection. Data is never cached by the service worker; the sync engine handles it.

### Project layout

| Path | |
| --- | --- |
| `server/index.ts` | Express API: boards, sharing, live updates, admin stats |
| `server/auth.ts` | Passwords, sessions, CSRF and rate limiting |
| `server/db.ts` | SQLite schema and migrations |
| `server/mail.ts` | Optional SMTP email |
| `src/sync.ts` | Client sync engine: diffs, offline queue, live updates |
| `src/shared.ts` | Types and patch logic shared by client and server |
| `src/store.ts` | App state, actions and undo history |
| `src/components/` | React UI: board, table, card page, sharing, admin |
| `public/sw.js` | Service worker for offline use |

## Tech

React 18 and TypeScript, built with Vite. Express 5 on Node with the built-in SQLite driver. Nodemailer for email. No CSS framework, and no other runtime dependencies.

## License

Boards is released under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

- **Free** for personal use, hobby projects, study and research, and for charities, schools and other non-commercial organisations. You can run it, change it and share your changes under the same license.
- **Commercial use needs permission.** That includes using Boards inside a business or offering it as a paid service. [Open an issue](https://github.com/sadcock1/boards/issues) or get in touch through GitHub to ask.

Because commercial use is restricted, Boards is *source-available* rather than "open source" in the OSI sense.
