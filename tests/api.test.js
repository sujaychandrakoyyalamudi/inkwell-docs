import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

const sample = (name) => readFileSync(new URL(`../samples/${name}`, import.meta.url));

let app;

/** A supertest agent keeps cookies, so each one is a signed-in browser. */
async function signIn(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email }).expect(200);
  return agent;
}

beforeEach(() => {
  app = createApp(openDb(':memory:', { seedDemoDocs: false }));
});

describe('auth', () => {
  test('document routes require a session', async () => {
    await request(app).get('/api/documents').expect(401);
  });

  test('login with a seeded account, then /me returns the user', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice.get('/api/auth/me').expect(200);
    assert.equal(body.user.name, 'Alice Chen');
  });

  test('unknown accounts are rejected', async () => {
    await request(app).post('/api/auth/login').send({ email: 'mallory@example.com' }).expect(404);
  });

  test('logout ends the session', async () => {
    const alice = await signIn('alice@example.com');
    await alice.post('/api/auth/logout').expect(200);
    await alice.get('/api/documents').expect(401);
  });
});

describe('documents', () => {
  test('create, rename, edit and reopen with formatting intact', async () => {
    const alice = await signIn('alice@example.com');
    const created = await alice.post('/api/documents').send({}).expect(201);
    const doc = created.body.document;
    assert.equal(doc.title, 'Untitled document');
    assert.equal(doc.role, 'owner');

    const html =
      '<h2>Plan</h2><p><strong>Bold</strong> <em>italic</em> <u>under</u></p>' +
      '<ul><li><p>one</p></li></ul><ol><li><p>first</p></li></ol>' +
      '<p style="text-align: center">centered</p>';
    const saved = await alice
      .patch(`/api/documents/${doc.id}`)
      .send({ title: '  Roadmap   2026 ', content: html, version: doc.version })
      .expect(200);
    assert.equal(saved.body.document.title, 'Roadmap 2026');
    assert.equal(saved.body.document.version, doc.version + 1);

    const reopened = await alice.get(`/api/documents/${doc.id}`).expect(200);
    // The sanitizer canonicalizes inline styles ("text-align: center" → "text-align:center").
    assert.equal(reopened.body.document.content, html.replace('text-align: center', 'text-align:center'));

    const list = await alice.get('/api/documents').expect(200);
    assert.deepEqual(list.body.owned.map((d) => d.title), ['Roadmap 2026']);
    assert.equal(list.body.shared.length, 0);
  });

  test('content is sanitized before it is stored', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice
      .post('/api/documents')
      .send({
        content:
          '<p onclick="steal()">hi<script>alert(1)</script></p>' +
          '<a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)>' +
          '<p style="color:red;text-align:right">r</p>',
      })
      .expect(201);
    const { content } = body.document;
    assert.doesNotMatch(content, /script|onclick|onerror|javascript:|<img|color/);
    assert.match(content, /<p>hi<\/p>/);
    assert.match(content, /text-align:right/);
  });

  test('stale versions are rejected with 409 and the latest copy', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice.post('/api/documents').send({ content: '<p>v1</p>' }).expect(201);
    const { id, version } = body.document;

    await alice.patch(`/api/documents/${id}`).send({ content: '<p>v2</p>', version }).expect(200);
    const conflict = await alice
      .patch(`/api/documents/${id}`)
      .send({ content: '<p>stale</p>', version })
      .expect(409);
    assert.equal(conflict.body.document.content, '<p>v2</p>');
  });

  test('validation errors', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice.post('/api/documents').send({}).expect(201);
    await alice.patch(`/api/documents/${body.document.id}`).send({}).expect(400);
    await alice.patch(`/api/documents/${body.document.id}`).send({ content: 42 }).expect(400);
    await alice.get('/api/documents/does-not-exist').expect(404);
  });

  test('owner can delete; document disappears', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice.post('/api/documents').send({}).expect(201);
    await alice.delete(`/api/documents/${body.document.id}`).expect(204);
    await alice.get(`/api/documents/${body.document.id}`).expect(404);
  });
});

describe('sharing', () => {
  async function setup() {
    const alice = await signIn('alice@example.com');
    const bob = await signIn('bob@example.com');
    const carol = await signIn('carol@example.com');
    const { body } = await alice
      .post('/api/documents')
      .send({ title: 'Secret plan', content: '<p>hello</p>' })
      .expect(201);
    return { alice, bob, carol, id: body.document.id };
  }

  test('unshared documents are invisible to other users', async () => {
    const { bob, id } = await setup();
    await bob.get(`/api/documents/${id}`).expect(404);
    const { body } = await bob.get('/api/documents').expect(200);
    assert.equal(body.shared.length, 0);
  });

  test('viewer can read but not edit, rename, share or delete', async () => {
    const { alice, bob, id } = await setup();
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@example.com', role: 'viewer' }).expect(201);

    const list = await bob.get('/api/documents').expect(200);
    assert.equal(list.body.owned.length, 0);
    assert.equal(list.body.shared.length, 1);
    assert.equal(list.body.shared[0].role, 'viewer');
    assert.equal(list.body.shared[0].owner.email, 'alice@example.com');

    const doc = await bob.get(`/api/documents/${id}`).expect(200);
    assert.equal(doc.body.document.content, '<p>hello</p>');
    assert.equal(doc.body.document.role, 'viewer');

    await bob.patch(`/api/documents/${id}`).send({ content: '<p>hacked</p>' }).expect(403);
    await bob.patch(`/api/documents/${id}`).send({ title: 'mine now' }).expect(403);
    await bob.post(`/api/documents/${id}/shares`).send({ email: 'carol@example.com' }).expect(403);
    await bob.delete(`/api/documents/${id}`).expect(403);
  });

  test('editor can edit; owner sees the change; role upgrade is an upsert', async () => {
    const { alice, bob, id } = await setup();
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@example.com', role: 'viewer' }).expect(201);
    const upgraded = await alice
      .post(`/api/documents/${id}/shares`)
      .send({ email: 'BOB@example.com', role: 'editor' })
      .expect(201);
    assert.equal(upgraded.body.shares.length, 1);
    assert.equal(upgraded.body.shares[0].role, 'editor');

    await bob.patch(`/api/documents/${id}`).send({ content: '<p>edited by bob</p>' }).expect(200);
    const { body } = await alice.get(`/api/documents/${id}`).expect(200);
    assert.equal(body.document.content, '<p>edited by bob</p>');
    assert.equal(body.document.updatedBy.name, 'Bob Martinez');

    // Editors still cannot manage access or delete.
    await bob.delete(`/api/documents/${id}`).expect(403);
  });

  test('revoking access removes the document from the collaborator', async () => {
    const { alice, bob, id } = await setup();
    const shared = await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@example.com' }).expect(201);
    const bobId = shared.body.shares[0].user.id;
    await alice.delete(`/api/documents/${id}/shares/${bobId}`).expect(200);
    await bob.get(`/api/documents/${id}`).expect(404);
  });

  test('collaborators can leave, but cannot remove others', async () => {
    const { alice, bob, carol, id } = await setup();
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@example.com' }).expect(201);
    const both = await alice.post(`/api/documents/${id}/shares`).send({ email: 'carol@example.com' }).expect(201);
    const ids = Object.fromEntries(both.body.shares.map((s) => [s.user.email, s.user.id]));

    await bob.delete(`/api/documents/${id}/shares/${ids['carol@example.com']}`).expect(403);
    await bob.delete(`/api/documents/${id}/shares/${ids['bob@example.com']}`).expect(200);
    await bob.get(`/api/documents/${id}`).expect(404);
    await carol.get(`/api/documents/${id}`).expect(200);
  });

  test('share input validation', async () => {
    const { alice, id } = await setup();
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'nobody@example.com' }).expect(404);
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'alice@example.com' }).expect(400);
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@example.com', role: 'admin' }).expect(400);
  });

  test('deleting a document removes it for collaborators too', async () => {
    const { alice, bob, id } = await setup();
    await alice.post(`/api/documents/${id}/shares`).send({ email: 'bob@example.com' }).expect(201);
    await alice.delete(`/api/documents/${id}`).expect(204);
    const { body } = await bob.get('/api/documents').expect(200);
    assert.equal(body.shared.length, 0);
  });
});

describe('file import', () => {
  test('.docx becomes a new document with headings, marks and lists', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice
      .post('/api/documents/import')
      .attach('file', sample('kickoff-memo.docx'), 'kickoff-memo.docx')
      .expect(201);
    const { document } = body;
    assert.equal(document.title, 'kickoff-memo');
    assert.equal(document.sourceFilename, 'kickoff-memo.docx');
    assert.match(document.content, /<h1>Project Kickoff Memo<\/h1>/);
    assert.match(document.content, /<strong>Microsoft Word<\/strong>/);
    assert.match(document.content, /<u>underlined<\/u>/);
    assert.match(document.content, /<ul><li>Introductions<\/li>/);
    assert.match(document.content, /<ol><li>Draft the spec<\/li>/);
  });

  test('.md is converted from Markdown', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice
      .post('/api/documents/import')
      .attach('file', sample('meeting-notes.md'), 'meeting-notes.md')
      .expect(201);
    assert.match(body.document.content, /<h2>Decisions<\/h2>/);
    assert.match(body.document.content, /<strong>Markdown<\/strong>/);
    assert.match(body.document.content, /<blockquote>/);
  });

  test('.txt keeps paragraphs and escapes markup', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice
      .post('/api/documents/import')
      .attach('file', Buffer.from('Hello <b>world</b>\nline two\n\nSecond para'), 'notes.txt')
      .expect(201);
    assert.equal(
      body.document.content,
      '<p>Hello &lt;b&gt;world&lt;/b&gt;<br />line two</p><p>Second para</p>',
    );
  });

  test('unsupported and oversized files are rejected', async () => {
    const alice = await signIn('alice@example.com');
    const bad = await alice
      .post('/api/documents/import')
      .attach('file', Buffer.from('%PDF-1.4'), 'scan.pdf')
      .expect(400);
    assert.match(bad.body.error, /Unsupported file type/);

    await alice
      .post('/api/documents/import')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1, 'a'), 'huge.txt')
      .expect(413);

    await alice.post('/api/documents/import').expect(400);
  });

  test('corrupt .docx gives a readable error', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice
      .post('/api/documents/import')
      .attach('file', Buffer.from('not a zip'), 'broken.docx')
      .expect(400);
    assert.match(body.error, /valid Word document/);
  });

  test('/convert returns HTML for inserting into an existing draft', async () => {
    const alice = await signIn('alice@example.com');
    const { body } = await alice
      .post('/api/convert')
      .attach('file', sample('meeting-notes.md'), 'meeting-notes.md')
      .expect(200);
    assert.match(body.html, /<h1>Weekly sync/);
    const list = await alice.get('/api/documents').expect(200);
    assert.equal(list.body.owned.length, 0, 'convert must not create a document');
  });
});

describe('persistence', () => {
  test('data survives reopening the database file', async (t) => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'inkwell-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'test.db');

    const db1 = openDb(file, { seedDemoDocs: false });
    app = createApp(db1);
    const alice = await signIn('alice@example.com');
    const { body } = await alice.post('/api/documents').send({ title: 'Durable', content: '<p><em>kept</em></p>' });
    await alice.post(`/api/documents/${body.document.id}/shares`).send({ email: 'bob@example.com', role: 'viewer' });
    db1.close();

    app = createApp(openDb(file, { seedDemoDocs: false }));
    const bob = await signIn('bob@example.com');
    const list = await bob.get('/api/documents').expect(200);
    assert.equal(list.body.shared[0].title, 'Durable');
    const doc = await bob.get(`/api/documents/${body.document.id}`).expect(200);
    assert.equal(doc.body.document.content, '<p><em>kept</em></p>');
  });

  test('demo seed creates one owned and one shared document per demo user', () => {
    const db = openDb(':memory:');
    const rows = db.prepare('SELECT COUNT(*) AS n FROM document_shares').get();
    assert.equal(rows.n, 2);
  });
});
