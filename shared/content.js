// Content rules shared by the Node server and the browser-only (static) build.
import { marked } from 'marked';
import { HttpError } from './errors.js';

/** File types the import flow accepts. Keep in sync with the client's ACCEPTED_TYPES. */
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx'];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 200;

/** Markup the editor understands. Everything else is stripped (its text is kept). */
export const ALLOWED_TAGS = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code', 'pre',
  'ul', 'ol', 'li', 'blockquote', 'hr', 'a',
];
export const ALLOWED_ATTRIBUTES = { a: ['href', 'target', 'rel'], ol: ['start'], '*': ['style'] };
export const ALLOWED_TEXT_ALIGN = /^(left|right|center|justify)$/;
export const ALLOWED_URL_SCHEMES = ['http', 'https', 'mailto'];
export const LINK_REL = 'noopener noreferrer nofollow';

/** Mammoth ignores underline by default; map it explicitly so formatting survives. */
export const DOCX_STYLE_MAP = ['u => u'];

export class UnsupportedFileError extends HttpError {
  constructor(filename) {
    super(
      400,
      `Unsupported file type "${extname(filename) || filename}". ` +
        `Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }
}

export function fileTooLargeError() {
  return new HttpError(413, `File is too large. Max size is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
}

/** Lower-cased extension including the dot, e.g. ".docx" ("" if none). */
export function extname(filename) {
  const name = String(filename).split(/[\\/]/).pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

export function isSupportedFile(filename) {
  return SUPPORTED_EXTENSIONS.includes(extname(filename));
}

export function normalizeTitle(raw) {
  const title = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
  return title || 'Untitled document';
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain text → paragraphs. Blank lines split paragraphs; single newlines become <br>. */
export function textToHtml(text) {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '<p></p>';
  return normalized
    .split(/\n{2,}/)
    .map((para) => `<p>${para.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('');
}

function decodeText(bytes) {
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

/**
 * Convert an uploaded file into sanitized editor HTML.
 * The environment supplies the sanitizer and the .docx converter (mammoth's Node or browser build).
 * @param {{ filename: string, bytes: Uint8Array, sanitize: (html: string) => string,
 *           docxToHtml: (bytes: Uint8Array) => Promise<{ value: string, messages: any[] }> }} input
 * @returns {Promise<{ html: string, title: string, warnings: string[] }>}
 */
export async function convertFile({ filename, bytes, sanitize, docxToHtml }) {
  const ext = extname(filename);
  const base = String(filename).split(/[\\/]/).pop();
  const title = (ext ? base.slice(0, -ext.length) : base).trim() || 'Imported document';
  let html;
  let warnings = [];

  switch (ext) {
    case '.txt':
      html = textToHtml(decodeText(bytes));
      break;
    case '.md':
    case '.markdown':
      html = await marked.parse(decodeText(bytes), { gfm: true });
      break;
    case '.docx': {
      try {
        const result = await docxToHtml(bytes);
        html = result.value;
        warnings = result.messages.filter((m) => m.type === 'warning').map((m) => m.message);
      } catch {
        throw new HttpError(400, 'Could not read that .docx file. Is it a valid Word document?');
      }
      break;
    }
    default:
      throw new UnsupportedFileError(filename);
  }

  const clean = sanitize(html).trim();
  return { html: clean || '<p></p>', title, warnings };
}
