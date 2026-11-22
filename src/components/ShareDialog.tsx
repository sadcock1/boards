import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { Role, SharingInfo, User } from '../shared';
import { Icon, toast } from './ui';

export function ShareDialog({ boardId, role, me, synced }: { boardId: string; role: Role; me: User; synced: boolean }) {
  const [info, setInfo] = useState<SharingInfo | null>(null);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isOwner = role === 'owner';

  useEffect(() => {
    if (!synced) return;
    api<SharingInfo>(`/boards/${boardId}/sharing`)
      .then(setInfo)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load sharing'));
  }, [boardId, synced]);

  const run = async (fn: () => Promise<SharingInfo & { added?: string }>) => {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      setInfo(r);
      return r;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    const r = await run(() => api(`/boards/${boardId}/invites`, { body: { email, role: inviteRole } }));
    if (r) {
      toast(r.added === 'member' ? `${email} can now open this board` : `Invite saved — ${email} gets access when they sign up`);
      setEmail('');
    }
  };

  const link = info?.linkToken ? `${location.origin}/s/${info.linkToken}` : '';

  if (!synced) {
    return <div className="share"><p className="muted small share-pad">This board hasn’t reached the server yet. Sharing will be available once you’re back online.</p></div>;
  }

  return (
    <div className="share">
      {isOwner && (
        <form className="share-invite" onSubmit={invite}>
          <input className="input" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <select className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'editor' | 'viewer')}>
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="btn-primary" disabled={busy || !email.trim()}>Invite</button>
        </form>
      )}
      {error && <div className="auth-error share-pad">{error}</div>}

      <div className="share-list">
        {!info && !error && <div className="muted small share-pad">Loading…</div>}
        {info?.members.map((m) => (
          <div key={m.userId} className="share-row">
            <span className="avatar">{(m.name || m.email)[0]?.toUpperCase()}</span>
            <span className="share-who">
              <span>{m.name}{m.userId === me.id ? ' (you)' : ''}</span>
              <span className="muted small">{m.email}</span>
            </span>
            {m.role === 'owner' || !isOwner ? (
              <span className="muted small share-role">{m.role === 'owner' ? 'Owner' : m.role === 'editor' ? 'Can edit' : 'Can view'}</span>
            ) : (
              <select
                className="select small-select"
                value={m.role}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'remove') void run(() => api(`/boards/${boardId}/members/${m.userId}`, { method: 'DELETE' }));
                  else void run(() => api(`/boards/${boardId}/members/${m.userId}`, { method: 'PATCH', body: { role: v } }));
                }}
              >
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
                <option value="remove">Remove</option>
              </select>
            )}
          </div>
        ))}
        {info?.invites.map((inv) => (
          <div key={inv.email} className="share-row">
            <span className="avatar pending">?</span>
            <span className="share-who">
              <span>{inv.email}</span>
              <span className="muted small">Invited · gets access when they sign up</span>
            </span>
            {isOwner ? (
              <button
                className="icon-btn small"
                title="Cancel invite"
                onClick={() => void run(() => api(`/boards/${boardId}/invites/${encodeURIComponent(inv.email)}`, { method: 'DELETE' }))}
              >
                <Icon name="x" size={12} />
              </button>
            ) : (
              <span className="muted small share-role">{inv.role === 'editor' ? 'Can edit' : 'Can view'}</span>
            )}
          </div>
        ))}
      </div>

      {isOwner && info && (
        <div className="share-link">
          <div className="share-link-head">
            <span className="share-who">
              <span>Anyone with the link can view</span>
              <span className="muted small">Read-only — no account needed</span>
            </span>
            <button
              className={`switch-btn`}
              onClick={() => void run(() => api(`/boards/${boardId}/link`, { body: { enabled: !info.linkToken } }))}
              aria-label="Toggle public link"
              disabled={busy}
            >
              <span className={`switch ${info.linkToken ? 'on' : ''}`} />
            </button>
          </div>
          {link && (
            <div className="share-link-row">
              <input className="input small" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button
                className="btn-secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(link);
                  toast('Link copied');
                }}
              >
                <Icon name="copy" size={14} /> Copy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
