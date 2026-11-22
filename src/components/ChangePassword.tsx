import { useState } from 'react';
import { api, ApiError } from '../api';
import { toast } from './ui';

/** Change your password while signed in (from the account menu). */
export function ChangePassword({ email, onDone }: { email: string; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('The new passwords don’t match');
    setBusy(true);
    setError('');
    try {
      await api('/auth/password', { body: { current, password } });
      toast('Password changed. You’ve been signed out on your other devices.');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <form className="pw-form" onSubmit={submit}>
      <div className="pw-title">Change password</div>
      <input type="email" value={email} autoComplete="username" readOnly hidden />
      <label>
        Current password
        <input className="input" type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
      </label>
      <label>
        New password
        <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
      </label>
      <label>
        Confirm new password
        <input className="input" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      {error && <div className="auth-error">{error}</div>}
      <div className="pw-actions">
        <button type="button" className="btn-text" onClick={onDone}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      </div>
    </form>
  );
}
