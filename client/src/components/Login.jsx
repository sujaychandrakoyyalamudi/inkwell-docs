import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { Avatar, Logo } from './ui.jsx';

export function Login({ onLogin }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api.users().then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  }, []);

  async function signIn(user) {
    setBusy(user.id);
    setError('');
    try {
      const { user: me } = await api.login(user.email);
      onLogin(me);
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <Logo />
        <h1>Sign in</h1>
        <p className="muted">
          Pick a demo account. This build uses mock authentication, so there is no password —
          switch accounts any time from the avatar menu to try sharing.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="login-users">
          {users === null && !error && <div className="muted">Loading accounts…</div>}
          {users?.map((u) => (
            <button key={u.id} className="login-user" onClick={() => signIn(u)} disabled={busy !== null}>
              <Avatar user={u} size={40} />
              <span className="login-user-text">
                <strong>{u.name}</strong>
                <span className="muted small">{u.email}</span>
              </span>
              <ArrowRight size={18} className="muted" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
