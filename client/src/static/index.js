// Boots the in-browser backend for the static (GitHub Pages) build. Loaded lazily,
// and only when the app is built with `--mode static`.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { DOCX_STYLE_MAP } from '../../../shared/content.js';
import { createLocalBackend } from './backend.js';
import { sanitizeContent } from './sanitize.js';

/** localStorage when available; otherwise an in-memory stand-in (data lasts until reload). */
function pickStorage() {
  try {
    const probe = '__inkwell_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map();
    return {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, String(v)),
      removeItem: (k) => memory.delete(k),
    };
  }
}

async function docxToHtml(bytes) {
  // mammoth's self-contained browser build (~0.6 MB) is only fetched when a .docx is imported.
  const { default: mammoth } = await import('mammoth/mammoth.browser.js');
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return mammoth.convertToHtml({ arrayBuffer }, { styleMap: DOCX_STYLE_MAP });
}

export async function startLocalBackend() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return createLocalBackend({ SQL, storage: pickStorage(), sanitize: sanitizeContent, docxToHtml });
}
