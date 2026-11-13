import { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { api } from '../api.js';
import { goHome } from '../lib.js';
import { Avatar, Modal, useToast } from './ui.jsx';

/**
 * Owners grant/revoke access and change roles. Collaborators see who has
 * access (read-only) and can remove themselves.
 */
export function ShareDialog({ doc, user, onClose, onChanged }) {
  const isOwner = doc.role === 'owner';
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.getShares(doc.id).then(setData).catch((e) => setError(e.message));
    if (isOwner) api.users().then((r) => setUsers(r.users)).catch(() => {});
  }, [doc.id, isOwner]);

  const hasAccess = new Set([data?.owner.id, ...(data?.shares.map((s) => s.user.id) ?? [])]);
  const suggestions = users.filter((u) => !hasAccess.has(u.id));

  function update(next) {
    setData(next);
    onChanged?.(next);
  }

  async function share(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.share(doc.id, email, role);
      const added = next.shares.find((s) => s.user.email === email.trim().toLowerCase());
      update(next);
      setEmail('');
      toast(`Shared with ${added?.user.name ?? email} as ${role}`, 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(target, nextRole) {
    setError('');
    try {
      update(await api.share(doc.id, target.email, nextRole));
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(target) {
    const leaving = target.id === user.id;
    if (leaving && !window.confirm('Remove your access to this document?')) return;
    setError('');
    try {
      const next = await api.unshare(doc.id, target.id);
      if (leaving) {
        toast('You left the document');
        goHome();
        return;
      }
      update(next);
      toast(`Removed ${target.name}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal
      title={`Share “${doc.title}”`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small">
            Demo accounts: alice@, bob@, carol@example.com
          </span>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {isOwner ? (
        <form className="share-form" onSubmit={share}>
          <input
            type="email"
            className="input"
            placeholder="Add people by email"
            value={email}
            list="share-suggestions"
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email address"
            autoComplete="off"
          />
          <datalist id="share-suggestions">
            {suggestions.map((u) => (
              <option key={u.id} value={u.email}>
                {u.name}
              </option>
            ))}
          </datalist>
          <select className="input select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button className="btn btn-primary" disabled={busy || !email.trim()}>
            <UserPlus size={16} /> Share
          </button>
        </form>
      ) : (
        <p className="muted">
          Only the owner, {data?.owner.name ?? 'the owner'}, can change who has access.
        </p>
      )}

      {isOwner && suggestions.length > 0 && (
        <div className="suggestions">
          <span className="muted small">Suggested:</span>
          {suggestions.map((u) => (
            <button key={u.id} type="button" className="suggestion" onClick={() => setEmail(u.email)}>
              <Avatar user={u} size={18} /> {u.name}
            </button>
          ))}
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <h3 className="people-title">People with access</h3>
      {!data && !error && <div className="muted">Loading…</div>}
      {data && (
        <ul className="people">
          <li className="person">
            <Avatar user={data.owner} size={34} />
            <div className="person-text">
              <strong>
                {data.owner.name}
                {data.owner.id === user.id && ' (you)'}
              </strong>
              <span className="muted small">{data.owner.email}</span>
            </div>
            <span className="person-role muted">Owner</span>
          </li>
          {data.shares.map(({ user: u, role: r }) => (
            <li key={u.id} className="person">
              <Avatar user={u} size={34} />
              <div className="person-text">
                <strong>
                  {u.name}
                  {u.id === user.id && ' (you)'}
                </strong>
                <span className="muted small">{u.email}</span>
              </div>
              {isOwner ? (
                <select
                  className="input select select-sm"
                  value={r}
                  onChange={(e) => changeRole(u, e.target.value)}
                  aria-label={`Role for ${u.name}`}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className="person-role muted">{r === 'editor' ? 'Editor' : 'Viewer'}</span>
              )}
              {(isOwner || u.id === user.id) && (
                <button
                  className="icon-btn danger"
                  title={u.id === user.id ? 'Leave document' : `Remove ${u.name}`}
                  aria-label={u.id === user.id ? 'Leave document' : `Remove ${u.name}`}
                  onClick={() => remove(u)}
                >
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
          {data.shares.length === 0 && <li className="muted small pad-y">Not shared with anyone yet.</li>}
        </ul>
      )}
    </Modal>
  );
}
