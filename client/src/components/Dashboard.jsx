import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, FileUp, Plus, Trash2, Users, Upload } from 'lucide-react';
import { api } from '../api.js';
import { ACCEPTED_LABEL, ACCEPTED_TYPES, formatDateTime, openDocument, timeAgo } from '../lib.js';
import { AccountMenu } from './AccountMenu.jsx';
import { Avatar, Logo, RoleBadge, useToast } from './ui.jsx';

export function Dashboard({ user, onUserChange }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const dragDepth = useRef(0);
  const toast = useToast();

  const load = useCallback(() => {
    api
      .listDocuments()
      .then((r) => {
        setDocs(r);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load, user.id]);

  async function createBlank() {
    setBusy(true);
    try {
      const { document } = await api.createDocument({ title: 'Untitled document' });
      openDocument(document.id);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function importFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      const { document, warnings } = await api.importDocument(file);
      toast(`Imported “${file.name}”`, 'success');
      if (warnings?.length) toast(`Some formatting could not be converted (${warnings.length} warning${warnings.length > 1 ? 's' : ''}).`);
      openDocument(document.id);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  async function remove(doc) {
    if (!window.confirm(`Delete “${doc.title}”? This also removes access for anyone it is shared with.`)) return;
    try {
      await api.deleteDocument(doc.id);
      toast('Document deleted');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const dropHandlers = {
    onDragEnter: (e) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDragOver: (e) => e.dataTransfer.types.includes('Files') && e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      importFile(e.dataTransfer.files?.[0]);
    },
  };

  return (
    <div className="app-shell" {...dropHandlers}>
      <header className="topbar">
        <Logo />
        <div className="topbar-spacer" />
        <AccountMenu user={user} onUserChange={onUserChange} />
      </header>

      <main className="dashboard">
        <section className="dash-head">
          <div>
            <h1>Documents</h1>
            <p className="muted">Signed in as {user.name}</p>
          </div>
          <div className="dash-actions">
            <button className="btn btn-primary" onClick={createBlank} disabled={busy}>
              <Plus size={18} /> New document
            </button>
            <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
              <FileUp size={18} /> Import file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_TYPES}
              hidden
              onChange={(e) => {
                importFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </section>
        <p className="import-hint">
          <Upload size={14} /> Import a {ACCEPTED_LABEL} file — or drop it anywhere on this page — to turn it into a new editable document.
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {!docs && !error && <div className="muted pad">Loading…</div>}

        {docs && (
          <>
            <DocSection
              title="Owned by me"
              count={docs.owned.length}
              empty="You don't own any documents yet. Create one or import a file."
            >
              {docs.owned.map((d) => (
                <DocRow key={d.id} doc={d} onDelete={() => remove(d)} />
              ))}
            </DocSection>
            <DocSection
              title="Shared with me"
              icon={<Users size={16} />}
              count={docs.shared.length}
              empty="Nothing has been shared with you yet. Documents other people share with you appear here."
            >
              {docs.shared.map((d) => (
                <DocRow key={d.id} doc={d} />
              ))}
            </DocSection>
          </>
        )}
      </main>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <FileUp size={36} />
            <strong>Drop to import</strong>
            <span className="muted">{ACCEPTED_LABEL}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DocSection({ title, icon, count, empty, children }) {
  return (
    <section className="doc-section">
      <h2 className="section-title">
        {icon}
        {title} <span className="count">{count}</span>
      </h2>
      {count === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        <div className="doc-list" role="list">
          <div className="doc-row doc-row-head" aria-hidden="true">
            <span>Name</span>
            <span>Owner</span>
            <span>Access</span>
            <span>Last modified</span>
            <span />
          </div>
          {children}
        </div>
      )}
    </section>
  );
}

function DocRow({ doc, onDelete }) {
  const owned = doc.role === 'owner';
  return (
    <div className="doc-row" role="listitem" onClick={() => openDocument(doc.id)}>
      <span className="doc-name">
        <FileText size={20} className={owned ? 'doc-icon' : 'doc-icon shared'} />
        <a
          href={`#/d/${doc.id}`}
          onClick={(e) => e.stopPropagation()}
          className="doc-title-link"
        >
          {doc.title}
        </a>
        {doc.sourceFilename && <span className="chip" title="Imported from file">{doc.sourceFilename}</span>}
      </span>
      <span className="doc-owner">
        <Avatar user={doc.owner} size={22} />
        <span>{owned ? 'me' : doc.owner.name}</span>
      </span>
      <span className="doc-access">
        <RoleBadge role={doc.role} />
        {owned && doc.shareCount > 0 && (
          <span className="chip chip-shared" title="Shared with other people">
            <Users size={12} /> {doc.shareCount}
          </span>
        )}
      </span>
      <span className="muted small" title={formatDateTime(doc.updatedAt)}>
        {timeAgo(doc.updatedAt)}
        {doc.updatedByName && ` · ${doc.updatedByName.split(' ')[0]}`}
      </span>
      <span className="doc-actions">
        {onDelete && (
          <button
            className="icon-btn danger"
            title="Delete document"
            aria-label={`Delete ${doc.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={16} />
          </button>
        )}
      </span>
    </div>
  );
}
