import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
import mammoth from 'mammoth';

/** File types the import flow accepts. Keep in sync with the client's ACCEPTED_TYPES. */
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx'];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export class UnsupportedFileError extends Error {
  constructor(filename) {
    super(
      `Unsupported file type "${path.extname(filename) || filename}". ` +
        `Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
    this.status = 400;
  }
}

/**
 * Allow-list of markup the editor understands. Anything else is stripped
 * (its text is kept), so stored content can never carry scripts, event
 * handlers or styles beyond text alignment.
 */
const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code', 'pre',
    'ul', 'ol', 'li', 'blockquote', 'hr', 'a',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    ol: ['start'],
    '*': ['style'],
  },
  allowedStyles: {
    '*': { 'text-align': [/^(left|right|center|justify)$/] },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }),
  },
};

export function sanitizeContent(html) {
  return sanitizeHtml(String(html ?? ''), SANITIZE_OPTIONS);
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

function decodeText(buffer) {
  return buffer.toString('utf8').replace(/^﻿/, '');
}

/**
 * Convert an uploaded file into sanitized editor HTML.
 * @returns {{ html: string, title: string, warnings: string[] }}
 */
export async function fileToHtml({ originalname, buffer }) {
  const ext = path.extname(originalname).toLowerCase();
  const title = path.basename(originalname, path.extname(originalname)).trim() || 'Imported document';
  let html;
  let warnings = [];

  switch (ext) {
    case '.txt':
      html = textToHtml(decodeText(buffer));
      break;
    case '.md':
    case '.markdown':
      html = await marked.parse(decodeText(buffer), { gfm: true });
      break;
    case '.docx': {
      try {
        // Mammoth drops underline by default; map it explicitly so formatting survives.
        const result = await mammoth.convertToHtml({ buffer }, { styleMap: ['u => u'] });
        html = result.value;
        warnings = result.messages.filter((m) => m.type === 'warning').map((m) => m.message);
      } catch {
        const err = new Error('Could not read that .docx file. Is it a valid Word document?');
        err.status = 400;
        throw err;
      }
      break;
    }
    default:
      throw new UnsupportedFileError(originalname);
  }

  const clean = sanitizeContent(html).trim();
  return { html: clean || '<p></p>', title, warnings };
}
