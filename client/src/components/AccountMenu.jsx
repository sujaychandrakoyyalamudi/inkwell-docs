import { useEffect, useRef, useState } from 'react';
import { LogOut, Repeat } from 'lucide-react';
import { api } from '../api.js';
import { Avatar, useToast } from './ui.jsx';

/**
 * Avatar button with a menu to sign out or switch to another demo account.
 * Switching keeps the current URL, which makes it easy to check what another
 * user sees for the same document.
 */
export function AccountMenu({ user, onUserChange, beforeSwitch }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const ref = useRef(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    api.users().then((r) => setUsers(r.users)).catch(() => {});
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  async function switchTo(other) {
    setOpen(false);
    await beforeSwitch?.();
    try {
      const { user: next } = await api.login(other.email);
      onUserChange(next);
      toast(`Signed in as ${next.name}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function signOut() {
    setOpen(false);
    await beforeSwitch?.();
    await api.logout().catch(() => {});
    onUserChange(null);
  }

  return (
    <div className="account" ref={ref}>
      <button
        className="account-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.name}`}
      >
        <Avatar user={user} size={32} title={`Signed in as ${user.name}`} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-user">
            <Avatar user={user} size={40} />
            <div>
              <div className="menu-name">{user.name}</div>
              <div className="muted small">{user.email}</div>
            </div>
          </div>
          <div className="menu-section-label">Switch demo account</div>
          {users
            .filter((u) => u.id !== user.id)
            .map((u) => (
              <button key={u.id} className="menu-item" role="menuitem" onClick={() => switchTo(u)}>
                <Avatar user={u} size={24} />
                <span>{u.name}</span>
                <Repeat size={14} className="muted push-right" />
              </button>
            ))}
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" onClick={signOut}>
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
