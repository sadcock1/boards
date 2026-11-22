import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { User } from '../shared';

/** Slim bar shown until the user clicks the link in their verification email. */
export function VerifyBanner({ user }: { user: User }) {
  const [verified, setVerified] = useState(!!user.verified);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  // They'll usually verify in another tab: re-check when they come back
  useEffect(() => {
    if (verified) return;
    const check = () =>
      api<{ user: User | null }>('/auth/me')
        .then((r) => r.user?.verified && setVerified(true))
        .catch(() => {});
    const onVis = () => document.visibilityState === 'visible' && check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [verified]);

  if (verified) return null;

  const resend = async () => {
    setState('sending');
    try {
      const r = await api<{ alreadyVerified?: boolean }>('/auth/verify/resend', { body: {} });
      if (r.alreadyVerified) setVerified(true);
      else setState('sent');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t send. Try again.');
      setState('error');
    }
  };

  return (
    <div className="verify-banner" role="status">
      <span className="verify-text">
        Verify your email so people can share boards with you. We sent a link to <strong>{user.email}</strong>.
      </span>
      {state === 'idle' && <button className="link-btn" onClick={resend}>Resend email</button>}
      {state === 'sending' && <span className="muted">Sending…</span>}
      {state === 'sent' && <span className="muted">Sent. Check your inbox and spam folder.</span>}
      {state === 'error' && <span className="verify-error">{error}</span>}
    </div>
  );
}

// One request per link, even if the page's effect runs twice: the first call uses the link up
const verifyCalls = new Map<string, Promise<{ email: string }>>();
const verifyOnce = (token: string) => {
  if (!verifyCalls.has(token)) verifyCalls.set(token, api<{ email: string }>('/auth/verify', { body: { token } }));
  return verifyCalls.get(token)!;
};

/** Page the verification email links to: /verify?token=… */
export function VerifyEmailPage() {
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? '');
  const [result, setResult] = useState<{ ok: true; email: string } | { ok: false; error: string } | null>(null);

  useEffect(() => {
    document.title = 'Verify email · Boards';
    history.replaceState(null, '', '/verify');
    verifyOnce(token)
      .then((r) => setResult({ ok: true, email: r.email }))
      .catch((e) => setResult({ ok: false, error: e instanceof ApiError ? e.message : 'Couldn’t verify your email. Check your connection and try again.' }));
  }, [token]);

  if (!result) return <div className="app-loading" />;
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo">B</div>
        <h1>{result.ok ? 'Email verified' : 'Couldn’t verify'}</h1>
        <p className="muted">
          {result.ok
            ? <>Thanks, <strong>{result.email}</strong> is confirmed. Any boards shared with you are now in your sidebar.</>
            : <>{result.error}. Sign in and use “Resend email” on the banner to get a new link.</>}
        </p>
        <a className="btn-primary auth-submit link-as-btn auth-center" href="/">Open Boards</a>
      </div>
    </div>
  );
}
