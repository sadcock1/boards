import { useEffect, useMemo, useState } from 'react';
import type { AdminStats, User } from '../shared';
import { api, ApiError } from '../api';

const nf = new Intl.NumberFormat();

function ago(t: number | null, now: number): string {
  if (!t) return 'Never';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const bytes = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

type SortKey = 'createdAt' | 'lastSeenAt' | 'boardsOwned' | 'cards' | 'name';

/** Admin-only overview of accounts and usage. Lives at /admin. */
export function AdminPage() {
  const [stats, setStats] = useState<AdminStats | 'loading' | 'denied' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('createdAt');

  const load = () =>
    api<{ user: User | null }>('/auth/me')
      .then(({ user }) => {
        if (!user?.admin) return setStats('denied');
        return api<AdminStats>('/admin/stats').then(setStats);
      })
      .catch((e) => setStats(e instanceof ApiError && e.status === 404 ? 'denied' : 'error'));

  useEffect(() => {
    document.title = 'Admin · Boards';
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const users = useMemo(() => {
    if (typeof stats !== 'object') return [];
    const q = query.trim().toLowerCase();
    const list = stats.users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    const val = (u: AdminStats['users'][number]) => (sort === 'name' ? u.name.toLowerCase() : (u[sort] ?? 0));
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      return sort === 'name' ? (x < y ? -1 : x > y ? 1 : 0) : (y as number) - (x as number);
    });
  }, [stats, query, sort]);

  if (stats === 'loading') return <div className="app-loading" />;
  if (stats === 'denied' || stats === 'error')
    return (
      <div className="empty-state full">
        <div className="empty-emoji">{stats === 'denied' ? '🔒' : '⚠️'}</div>
        <h2>{stats === 'denied' ? 'Page not found' : 'Couldn’t load the dashboard'}</h2>
        {stats === 'error' && <p className="muted">Check your connection and try again.</p>}
        <a className="btn-primary link-as-btn" href="/">Go to Boards</a>
      </div>
    );

  const t = stats.totals;
  const now = stats.generatedAt;
  const avgCards = t.boards ? Math.round(t.cards / t.boards) : 0;

  return (
    <div className="admin">
      <header className="admin-head">
        <div className="auth-logo admin-logo">B</div>
        <h1>Admin</h1>
        <span className="muted small">Updated {new Date(now).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · refreshes every minute</span>
        <span className="topbar-spacer" />
        <a className="btn-text" href="/">Back to boards</a>
      </header>

      <section className="admin-tiles">
        <Tile label="Users" value={t.users} sub={`+${t.newUsers7d} this week · +${t.newUsers30d} in 30 days${t.unverified ? ` · ${t.unverified} unverified` : ''}`} hero />
        <Tile label="Online now" value={t.onlineNow} sub="With the app open" live={t.onlineNow > 0} />
        <Tile label="Active today" value={t.active1d} sub={`${t.active7d} this week · ${t.active30d} in 30 days`} />
        <Tile label="Boards" value={t.boards} sub={`${t.sharedBoards} shared · ${t.publicLinks} public link${t.publicLinks === 1 ? '' : 's'}`} />
        <Tile label="Cards" value={t.cards} sub={`About ${avgCards} per board`} />
        <Tile label="Pending invites" value={t.pendingInvites} sub={`${t.memberships} accepted share${t.memberships === 1 ? '' : 's'} · database ${bytes(t.dbBytes)}`} />
      </section>

      <section className="admin-panel">
        <h2>Sign-ups, last 30 days</h2>
        <SignupChart data={stats.signups} />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>Users <span className="muted">{users.length}</span></h2>
          <span className="topbar-spacer" />
          <input className="input small admin-search" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="input small" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort users">
            <option value="createdAt">Newest first</option>
            <option value="lastSeenAt">Recently active</option>
            <option value="cards">Most cards</option>
            <option value="boardsOwned">Most boards</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Joined</th>
                <th>Email verified</th>
                <th>Last active</th>
                <th className="num">Boards</th>
                <th className="num">Cards</th>
                <th className="num">Shared with them</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="admin-user">
                      <span className={`admin-dot ${u.online ? 'on' : ''}`} title={u.online ? 'Online now' : undefined} />
                      {u.name}
                    </span>
                  </td>
                  <td className="muted">{u.email}</td>
                  <td>{date(u.createdAt)}</td>
                  <td className={u.verified ? '' : 'admin-unverified'}>{u.verified ? 'Yes' : 'Not yet'}</td>
                  <td className={u.online ? 'admin-online' : ''}>{u.online ? 'Online now' : ago(u.lastSeenAt, now)}</td>
                  <td className="num">{nf.format(u.boardsOwned)}</td>
                  <td className="num">{nf.format(u.cards)}</td>
                  <td className="num">{nf.format(u.sharedWithThem)}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={8} className="muted admin-empty">No users match “{query}”</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted small admin-note">“Last active” is tracked from {date(Math.min(...stats.users.map((u) => u.lastSeenAt ?? now), now))} onward, so accounts that haven’t been back since then show “Never”.</p>
      </section>
    </div>
  );
}

function Tile({ label, value, sub, hero, live }: { label: string; value: number; sub: string; hero?: boolean; live?: boolean }) {
  return (
    <div className={`admin-tile ${hero ? 'hero' : ''}`}>
      <div className="admin-tile-label">
        {live && <span className="admin-dot on" aria-hidden />}
        {label}
      </div>
      <div className="admin-tile-value">{nf.format(value)}</div>
      <div className="admin-tile-sub">{sub}</div>
    </div>
  );
}

/** Single-series bar chart: one bar per day, hover for the exact count. */
function SignupChart({ data }: { data: AdminStats['signups'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  const niceMax = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const W = 720, H = 180, L = 28, B = 22, T = 8;
  const plotW = W - L, plotH = H - B - T;
  const slot = plotW / data.length;
  const barW = Math.max(2, slot - 2); // 2px surface gap between bars
  const y = (v: number) => T + plotH - (v / niceMax) * plotH;
  const ticks = niceMax <= 4 ? Array.from({ length: niceMax + 1 }, (_, i) => i) : [0, niceMax / 2, niceMax].map(Math.round);
  const label = (day: string) => new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const total = data.reduce((s, d) => s + d.count, 0);
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="admin-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sign-ups per day over the last 30 days, ${total} in total`} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} className="admin-grid" />
            <text x={L - 6} y={y(v)} dy="0.32em" textAnchor="end" className="admin-axis">{v}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + i * slot + 1;
          const bh = (d.count / niceMax) * plotH;
          const r = Math.min(4, barW / 2, bh);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={L + i * slot} y={T} width={slot} height={plotH} fill="transparent" />
              {d.count > 0 && (
                <path
                  className={`admin-bar ${hover === i ? 'hover' : ''}`}
                  d={`M${x},${T + plotH} V${T + plotH - bh + r} Q${x},${T + plotH - bh} ${x + r},${T + plotH - bh} H${x + barW - r} Q${x + barW},${T + plotH - bh} ${x + barW},${T + plotH - bh + r} V${T + plotH} Z`}
                />
              )}
            </g>
          );
        })}
        {[0, 10, 20, data.length - 1].map((i, n, all) => (
          <text
            key={i}
            x={n === 0 ? L : n === all.length - 1 ? W : L + i * slot + slot / 2}
            y={H - 6}
            textAnchor={n === 0 ? 'start' : n === all.length - 1 ? 'end' : 'middle'}
            className="admin-axis"
          >
            {label(data[i].day)}
          </text>
        ))}
      </svg>
      {h && hover !== null && (
        <div className="admin-tip" style={{ left: `${Math.min(92, Math.max(8, ((L + hover * slot + slot / 2) / W) * 100))}%` }}>
          <strong>{h.count}</strong> sign-up{h.count === 1 ? '' : 's'}
          <div className="muted">{label(h.day)}</div>
        </div>
      )}
    </div>
  );
}
