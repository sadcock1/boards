import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { User } from '../shared';

type Mode = 'login' | 'signup' | 'forgot';

export function AuthScreen({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  // "Forgot password?" only makes sense when this server can send email
  const [emailOn, setEmailOn] = useState(false);
  useEffect(() => {
    api<{ email: boolean }>('/config').then((c) => setEmailOn(c.email)).catch(() => {});
  }, []);

  const go = (m: Mode) => {
    setMode(m);
    setError('');
    setSentTo(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'forgot') {
        await api('/auth/forgot', { body: { email } });
        setSentTo(email.trim());
        return;
      }
      const { user } = await api<{ user: User }>(`/auth/${mode}`, {
        body: mode === 'signup' ? { email, name, password } : { email, password },
      });
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'forgot' && sentTo)
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="auth-logo">B</div>
          <h1>Check your email</h1>
          <p className="muted">
            If there’s an account for <strong>{sentTo}</strong>, we’ve sent it a link to reset the password. It expires in an hour.
          </p>
          <p className="muted small">Nothing there? Check your spam folder, or make sure you typed the email you signed up with.</p>
          <button type="button" className="btn-primary auth-submit" onClick={() => go('login')}>Back to sign in</button>
        </div>
      </div>
    );

  const title = { login: 'Sign in to Boards', signup: 'Create your account', forgot: 'Reset your password' }[mode];
  const intro = {
    login: 'Welcome back.',
    signup: 'Simple boards you can share.',
    forgot: 'Enter the email you signed up with and we’ll send you a link to choose a new password.',
  }[mode];

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">B</div>
        <h1>{title}</h1>
        <p className="muted">{intro}</p>
        {mode === 'signup' && (
          <label>
            Name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" />
          </label>
        )}
        <label>
          Email
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
        </label>
        {mode !== 'forgot' && (
          <label>
            <span className="auth-label-row">
              Password
              {mode === 'login' && emailOn && (
                <button type="button" className="link-btn auth-forgot" onClick={() => go('forgot')}>Forgot password?</button>
              )}
            </span>
            <input
              className="input"
              type="password"
              required
              minLength={mode === 'signup' ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
            />
          </label>
        )}
        {error && <div className="auth-error">{error}</div>}
        <button className="btn-primary auth-submit" disabled={busy}>
          {busy ? 'Please wait…' : { login: 'Sign in', signup: 'Create account', forgot: 'Send reset link' }[mode]}
        </button>
        <div className="auth-switch">
          {mode === 'forgot' ? (
            <>
              Remembered it?{' '}
              <button type="button" className="link-btn" onClick={() => go('login')}>Sign in</button>
            </>
          ) : (
            <>
              {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
              <button type="button" className="link-btn" onClick={() => go(mode === 'login' ? 'signup' : 'login')}>
                {mode === 'login' ? 'Create an account' : 'Sign in'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

/** Page the reset email links to: /reset?token=… */
export function ResetPasswordPage() {
  // Read once: the token is removed from the address bar straight after
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? '');
  const [check, setCheck] = useState<{ valid: boolean; email?: string } | 'loading'>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Reset password · Boards';
    // Keep the token out of the address bar (and browser history) once we've read it
    history.replaceState(null, '', '/reset');
    api<{ valid: boolean; email?: string }>('/auth/reset/check', { body: { token } })
      .then(setCheck)
      .catch(() => setCheck({ valid: false }));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('The passwords don’t match');
    setBusy(true);
    setError('');
    try {
      await api('/auth/reset', { body: { token, password } });
      location.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  if (check === 'loading') return <div className="app-loading" />;
  if (!check.valid)
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="auth-logo">B</div>
          <h1>This link has expired</h1>
          <p className="muted">Reset links work once and only for an hour. Request a new one from the sign-in page.</p>
          <a className="btn-primary auth-submit link-as-btn auth-center" href="/">Back to sign in</a>
        </div>
      </div>
    );

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">B</div>
        <h1>Choose a new password</h1>
        <p className="muted">For {check.email}. You’ll be signed out everywhere else.</p>
        <input type="email" value={check.email} autoComplete="username" readOnly hidden />
        <label>
          New password
          <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" autoFocus />
        </label>
        <label>
          Confirm new password
          <input className="input" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="btn-primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : 'Save and sign in'}</button>
      </form>
    </div>
  );
}
