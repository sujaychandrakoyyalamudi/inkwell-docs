// Tests for the browser-only backend used by the GitHub Pages build. It runs the
// same shared core on sql.js; here it gets Node's sanitizer and .docx converter
// and an in-memory stand-in for localStorage.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import mammoth from 'mammoth';
import { createLocalBackend, STORAGE_KEYS } from '../client/src/static/backend.js';
import { sanitizeContent } from '../server/convert.js';
import { DOCX_STYLE_MAP } from '../shared/content.js';

const SQL = await initSqlJs();
const sample = (name) => readFileSync(new URL(`../samples/${name}`, import.meta.url));

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const backendFor = (storage) =>
  createLocalBackend({
    SQL,
    storage,
    sanitize: sanitizeContent,
    docxToHtml: (bytes) =>
      mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, { styleMap: DOCX_STYLE_MAP }),
  });

/** Assert a request rejects with the given HTTP status. */
async function rejectsWith(promise, status) {
  await assert.rejects(promise, (err) => err.status === status);
}

function upload(name, bytes) {
  const form = new FormData();
  form.append('file', new File([bytes], name));
  return form;
}

let storage;
let api;
const as = async (email) => (await api.handle('POST', '/auth/login', { email })).user;

beforeEach(() => {
  storage = memoryStorage();
  api = backendFor(storage);
});

describe('static backend', () => {
  test('seeds demo users and documents, and requires a session', async () => {
    await rejectsWith(api.handle('GET', '/documents'), 401);
    assert.deepEqual((await api.handle('GET', '/auth/me')).user, null);

    const alice = await as('alice@example.com');
    assert.equal(alice.name, 'Alice Chen');
    const { owned, shared } = await api.handle('GET', '/documents');
    assert.deepEqual(owned.map((d) => d.title), ['Welcome to Inkwell']);
    assert.deepEqual(shared.map((d) => [d.title, d.role]), [['Q3 planning notes', 'viewer']]);
  });

  test('enforces the same sharing rules as the server', async () => {
    await as('alice@example.com');
    const { document } = await api.handle('POST', '/documents', { title: 'Plan', content: '<p>hi</p>' });

    await as('bob@example.com');
    await rejectsWith(api.handle('GET', `/documents/${document.id}`), 404);

    await as('alice@example.com');
    const shares = await api.handle('POST', `/documents/${document.id}/shares`, {
      email: 'bob@example.com',
      role: 'viewer',
    });
    assert.equal(shares.shares[0].role, 'viewer');

    await as('bob@example.com');
    await rejectsWith(api.handle('PATCH', `/documents/${document.id}`, { content: '<p>x</p>' }), 403);
    await rejectsWith(api.handle('DELETE', `/documents/${document.id}`), 403);

    await as('alice@example.com');
    await api.handle('POST', `/documents/${document.id}/shares`, { email: 'bob@example.com', role: 'editor' });
    await as('bob@example.com');
    const saved = await api.handle('PATCH', `/documents/${document.id}`, {
      content: '<p>by bob<script>x()</script></p>',
      version: 1,
    });
    assert.equal(saved.document.content, '<p>by bob</p>');
    assert.equal(saved.document.updatedBy.name, 'Bob Martinez');
  });

  test('rejects stale versions with 409 and the latest copy', async () => {
    await as('alice@example.com');
    const { document } = await api.handle('POST', '/documents', { content: '<p>v1</p>' });
    await api.handle('PATCH', `/documents/${document.id}`, { content: '<p>v2</p>', version: 1 });
    await assert.rejects(
      api.handle('PATCH', `/documents/${document.id}`, { content: '<p>stale</p>', version: 1 }),
      (err) => err.status === 409 && err.extra.document.content === '<p>v2</p>',
    );
  });

  test('persists to storage and does not re-seed deleted demo documents', async () => {
    await as('alice@example.com');
    const { owned } = await api.handle('GET', '/documents');
    await api.handle('DELETE', `/documents/${owned[0].id}`);
    await api.handle('POST', '/documents', { title: 'Mine' });

    const reopened = backendFor(storage); // e.g. after a page reload
    const docs = await reopened.handle('GET', '/documents');
    assert.deepEqual(docs.owned.map((d) => d.title), ['Mine']);
  });

  test('a second tab sees writes from the first, and stale saves conflict', async () => {
    await as('alice@example.com');
    const { document } = await api.handle('POST', '/documents', { content: '<p>a</p>' });
    const otherTab = backendFor(storage);

    await api.handle('PATCH', `/documents/${document.id}`, { content: '<p>from tab 1</p>', version: 1 });
    const seen = await otherTab.handle('GET', `/documents/${document.id}`);
    assert.equal(seen.document.content, '<p>from tab 1</p>');
    await rejectsWith(
      otherTab.handle('PATCH', `/documents/${document.id}`, { content: '<p>old</p>', version: 1 }),
      409,
    );
  });

  test('imports .docx, .md and .txt; rejects other types and big files', async () => {
    await as('alice@example.com');
    const docx = await api.handle('POST', '/documents/import', upload('kickoff-memo.docx', sample('kickoff-memo.docx')));
    assert.equal(docx.document.title, 'kickoff-memo');
    assert.match(docx.document.content, /<u>underlined<\/u>/);

    const md = await api.handle('POST', '/convert', upload('meeting-notes.md', sample('meeting-notes.md')));
    assert.match(md.html, /<h2>Decisions<\/h2>/);

    const txt = await api.handle('POST', '/documents/import', upload('a.txt', 'one\n\ntwo'));
    assert.equal(txt.document.content, '<p>one</p><p>two</p>');

    await rejectsWith(api.handle('POST', '/documents/import', upload('scan.pdf', '%PDF')), 400);
    await rejectsWith(
      api.handle('POST', '/documents/import', upload('big.txt', new Uint8Array(5 * 1024 * 1024 + 1))),
      413,
    );
  });

  test('reset clears this browser and re-seeds', async () => {
    await as('alice@example.com');
    await api.handle('POST', '/documents', { title: 'Temp' });
    api.reset();
    assert.equal(storage.getItem(STORAGE_KEYS.session), null);
    await as('alice@example.com');
    const { owned } = await api.handle('GET', '/documents');
    assert.deepEqual(owned.map((d) => d.title), ['Welcome to Inkwell']);
  });
});
