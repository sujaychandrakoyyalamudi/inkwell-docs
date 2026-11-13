import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextAlign } from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions';
import {
  ArrowLeft,
  Check,
  CloudOff,
  Eye,
  FileText,
  LoaderCircle,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { api, saveOnUnload } from '../api.js';
import { firstName, formatDateTime, goHome, timeAgo } from '../lib.js';
import { AccountMenu } from './AccountMenu.jsx';
import { ShareDialog } from './ShareDialog.jsx';
import { Toolbar } from './Toolbar.jsx';
import { Logo, RoleBadge, useToast } from './ui.jsx';

const AUTOSAVE_DELAY_MS = 800;
const POLL_INTERVAL_MS = 4000;

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    link: { openOnClick: false, autolink: true },
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Placeholder.configure({ placeholder: 'Start writing…' }),
];

/** Loads the document, then hands off to the editor. Handles 404 / no access. */
export function EditorPage({ id, user, onUserChange }) {
  const [state, setState] = useState({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getDocument(id)
      .then(({ document: doc }) => !cancelled && setState({ status: 'ready', doc }))
      .catch((error) => !cancelled && setState({ status: 'error', error }));
    return () => {
      cancelled = true;
    };
  }, [id, user.id, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  if (state.status === 'ready') {
    return (
      <DocEditor
        // Remount when the viewer or their role changes so editability is re-derived.
        key={`${state.doc.id}:${user.id}:${state.doc.role}`}
        initialDoc={state.doc}
        user={user}
        onUserChange={onUserChange}
        onAccessChanged={reload}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-btn" onClick={goHome} title="Back to documents" aria-label="Back to documents">
          <ArrowLeft size={20} />
        </button>
        <Logo />
        <div className="topbar-spacer" />
        <AccountMenu user={user} onUserChange={onUserChange} />
      </header>
      <main className="center-message">
        {state.status === 'loading' ? (
          <div className="muted">Loading document…</div>
        ) : (
          <div className="message-card">
            <h2>{state.error.status === 404 ? 'Document unavailable' : 'Could not open document'}</h2>
            <p className="muted">
              {state.error.status === 404
                ? `This document doesn't exist, or it hasn't been shared with ${user.name}.`
                : state.error.message}
            </p>
            <button className="btn btn-primary" onClick={goHome}>
              Back to documents
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function DocEditor({ initialDoc, user, onUserChange, onAccessChanged }) {
  const id = initialDoc.id;
  const canEdit = initialDoc.role !== 'viewer';
  const toast = useToast();

  const [meta, setMeta] = useState(initialDoc); // owner, role, updatedAt, updatedBy...
  const [title, setTitle] = useState(initialDoc.title);
  const [saveState, setSaveState] = useState('saved'); // saved | dirty | saving | error | conflict
  const [conflict, setConflict] = useState(null); // newer server copy when a save is rejected
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCount, setShareCount] = useState(null);

  // Mutable save machinery lives in refs so editor callbacks never see stale state.
  const editorRef = useRef(null);
  const titleInput = useRef(null);
  const versionRef = useRef(initialDoc.version);
  const titleRef = useRef(initialDoc.title);
  const dirty = useRef({ content: false, title: false });
  const inFlight = useRef(null);
  const queued = useRef(false);
  const timer = useRef(null);
  const inConflict = useRef(false);
  const saveRef = useRef(null);

  const isDirty = () => dirty.current.content || dirty.current.title;

  const buildPatch = (flags) => {
    const patch = { version: versionRef.current };
    if (flags.content) patch.content = editorRef.current?.getHTML() ?? '';
    if (flags.title) patch.title = titleRef.current;
    return patch;
  };

  const markDirty = (kind) => {
    dirty.current[kind] = true;
    if (inConflict.current) return;
    setSaveState((s) => (s === 'saving' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(), AUTOSAVE_DELAY_MS);
  };

  const editor = useEditor({
    extensions,
    content: initialDoc.content,
    editable: canEdit,
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true', 'aria-label': 'Document body' },
    },
    onUpdate: () => markDirty('content'),
  });
  editorRef.current = editor;

  /** Replace the editor with a newer server copy without polluting undo history. */
  const applyRemote = useCallback((latest) => {
    const ed = editorRef.current;
    if (ed && !ed.isDestroyed) {
      const { from, to } = ed.state.selection;
      ed.chain().setMeta('addToHistory', false).setContent(latest.content, { emitUpdate: false }).run();
      if (ed.isFocused) {
        const max = ed.state.doc.content.size;
        ed.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
      }
    }
    versionRef.current = latest.version;
    setMeta(latest);
    if (globalThis.document.activeElement !== titleInput.current) {
      titleRef.current = latest.title;
      setTitle(latest.title);
    }
  }, []);

  /** Save pending changes. Only one request is in flight; edits made meanwhile are queued. */
  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (inConflict.current || !canEdit) return;
    if (inFlight.current) {
      queued.current = true;
      return inFlight.current;
    }
    if (!isDirty()) return;

    const flags = { ...dirty.current };
    const patch = buildPatch(flags);
    dirty.current = { content: false, title: false };
    setSaveState('saving');

    const run = (async () => {
      try {
        const { document: saved } = await api.updateDocument(id, patch);
        versionRef.current = saved.version;
        setMeta(saved);
        if (flags.title && globalThis.document.activeElement !== titleInput.current) {
          titleRef.current = saved.title;
          setTitle(saved.title);
        }
        setSaveState(isDirty() ? 'dirty' : 'saved');
      } catch (e) {
        // Put the unsaved flags back so nothing is lost.
        dirty.current = {
          content: dirty.current.content || flags.content,
          title: dirty.current.title || flags.title,
        };
        if (e.status === 409) {
          inConflict.current = true;
          setConflict(e.body.document);
          setSaveState('conflict');
        } else if (e.status === 403 || e.status === 404) {
          toast('Your access to this document changed.', 'error');
          onAccessChanged();
        } else {
          setSaveState('error');
          timer.current = setTimeout(() => saveRef.current(), 4000);
        }
      } finally {
        inFlight.current = null;
        if (queued.current) {
          queued.current = false;
          saveRef.current();
        }
      }
    })();
    inFlight.current = run;
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, canEdit]);
  saveRef.current = save;

  /** Save everything now and wait for it (used before navigating away). */
  const flush = useCallback(async () => {
    await saveRef.current();
    while (inFlight.current) await inFlight.current;
  }, []);

  // Keyboard save, unload protection, and best-effort save when the page goes away.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    const onBeforeUnload = (e) => {
      if (isDirty() || inFlight.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onPageHide = () => {
      if (isDirty() && !inConflict.current && canEdit) saveOnUnload(id, buildPatch(dirty.current));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      clearTimeout(timer.current);
      // Leaving via browser back/forward: don't drop the last keystrokes.
      try {
        onPageHide();
      } catch {
        /* editor already torn down */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, canEdit]);

  // Pick up changes saved by collaborators while this tab is idle.
  useEffect(() => {
    const interval = setInterval(async () => {
      if (globalThis.document.hidden || inFlight.current || isDirty() || inConflict.current) return;
      try {
        const { document: latest } = await api.getDocument(id);
        if (latest.role !== initialDoc.role) {
          toast(`Your access changed to ${latest.role}.`);
          onAccessChanged();
          return;
        }
        if (latest.version > versionRef.current && !isDirty() && !inFlight.current) {
          applyRemote(latest);
        }
      } catch (e) {
        if (e.status === 404) {
          toast('Your access to this document was removed.', 'error');
          onAccessChanged();
        }
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    globalThis.document.title = `${title || 'Untitled document'} – Inkwell`;
  }, [title]);

  useEffect(() => {
    api.getShares(id).then((r) => setShareCount(r.shares.length)).catch(() => {});
  }, [id]);

  function resolveWithLatest() {
    inConflict.current = false;
    dirty.current = { content: false, title: false };
    applyRemote(conflict);
    titleRef.current = conflict.title;
    setTitle(conflict.title);
    setConflict(null);
    setSaveState('saved');
  }

  function resolveWithMine() {
    versionRef.current = conflict.version;
    inConflict.current = false;
    dirty.current = { content: true, title: true };
    setConflict(null);
    saveRef.current();
  }

  async function back() {
    await flush();
    goHome();
  }

  const ownerLabel = meta.role === 'owner' ? 'you' : meta.owner.name;

  return (
    <div className="app-shell editor-shell">
      <header className="topbar editor-topbar">
        <button className="icon-btn" onClick={back} title="Back to documents" aria-label="Back to documents">
          <ArrowLeft size={20} />
        </button>
        <FileText size={30} className="doc-icon big" />
        <div className="title-block">
          <div className="title-row">
            <input
              ref={titleInput}
              className="title-input"
              value={title}
              readOnly={!canEdit}
              aria-label="Document title"
              placeholder="Untitled document"
              maxLength={200}
              onChange={(e) => {
                setTitle(e.target.value);
                titleRef.current = e.target.value;
                markDirty('title');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  editor?.commands.focus();
                }
                if (e.key === 'Escape') e.currentTarget.blur();
              }}
              onBlur={() => saveRef.current()}
            />
            <RoleBadge role={meta.role} />
          </div>
          <div className="meta-row">
            <span>Owned by {ownerLabel}</span>
            <span className="dot">·</span>
            <SaveStatus state={canEdit ? saveState : 'viewer'} meta={meta} />
          </div>
        </div>
        <div className="topbar-spacer" />
        <button className="btn btn-primary" onClick={() => setShareOpen(true)}>
          <Users size={16} />
          <span className="share-label">{meta.role === 'owner' ? 'Share' : 'People'}</span>
          {shareCount > 0 && (
            <span className="btn-count" title={`Shared with ${shareCount} ${shareCount === 1 ? 'person' : 'people'}`}>
              {shareCount}
            </span>
          )}
        </button>
        <AccountMenu user={user} onUserChange={onUserChange} beforeSwitch={flush} />
      </header>

      {canEdit && editor && <Toolbar editor={editor} />}

      <div className="canvas">
        {!canEdit && (
          <div className="banner banner-info">
            <Eye size={16} />
            You have view-only access. Ask {meta.owner.name} for edit access. Changes made by editors appear here automatically.
          </div>
        )}
        {conflict && (
          <div className="banner banner-warn" role="alert">
            <TriangleAlert size={16} />
            <span>
              {conflict.updatedBy?.name ?? 'Someone'} saved a newer version while you were editing. Your latest
              changes are not saved yet.
            </span>
            <span className="banner-actions">
              <button className="btn btn-sm" onClick={resolveWithLatest}>
                Load their version
              </button>
              <button className="btn btn-sm btn-primary" onClick={resolveWithMine}>
                Keep mine
              </button>
            </span>
          </div>
        )}
        <article className={`page${canEdit ? '' : ' read-only'}`}>
          <EditorContent editor={editor} />
        </article>
      </div>

      {shareOpen && (
        <ShareDialog
          doc={{ ...meta, title }}
          user={user}
          onClose={() => setShareOpen(false)}
          onChanged={(r) => setShareCount(r.shares.length)}
        />
      )}
    </div>
  );
}

function SaveStatus({ state, meta }) {
  const edited = `Last edited ${timeAgo(meta.updatedAt)}${meta.updatedBy ? ` by ${firstName(meta.updatedBy)}` : ''}`;
  const title = `${edited} — ${formatDateTime(meta.updatedAt)}`;
  switch (state) {
    case 'viewer':
      return (
        <span className="save-status" title={title}>
          <Eye size={14} /> View only · {edited}
        </span>
      );
    case 'saving':
      return (
        <span className="save-status">
          <LoaderCircle size={14} className="spin" /> Saving…
        </span>
      );
    case 'dirty':
      return <span className="save-status">Unsaved changes</span>;
    case 'error':
      return (
        <span className="save-status error">
          <CloudOff size={14} /> Couldn't save — retrying
        </span>
      );
    case 'conflict':
      return (
        <span className="save-status warn">
          <TriangleAlert size={14} /> Not saved — conflict
        </span>
      );
    default:
      return (
        <span className="save-status ok" title={title}>
          <Check size={14} /> Saved · {edited}
        </span>
      );
  }
}
