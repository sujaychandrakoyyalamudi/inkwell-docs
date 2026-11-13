import sanitizeHtml from 'sanitize-html';
import mammoth from 'mammoth';
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_TAGS,
  ALLOWED_TEXT_ALIGN,
  ALLOWED_URL_SCHEMES,
  DOCX_STYLE_MAP,
  LINK_REL,
  convertFile,
} from '../shared/content.js';

export {
  MAX_UPLOAD_BYTES,
  SUPPORTED_EXTENSIONS,
  UnsupportedFileError,
  textToHtml,
} from '../shared/content.js';

/**
 * Allow-list of markup the editor understands (see shared/content.js). Anything else
 * is stripped (its text is kept), so stored content can never carry scripts, event
 * handlers or styles beyond text alignment.
 */
const SANITIZE_OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedStyles: { '*': { 'text-align': [ALLOWED_TEXT_ALIGN] } },
  allowedSchemes: ALLOWED_URL_SCHEMES,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: LINK_REL }),
  },
};

export function sanitizeContent(html) {
  return sanitizeHtml(String(html ?? ''), SANITIZE_OPTIONS);
}

/**
 * Convert an uploaded file (multer's { originalname, buffer }) into sanitized editor HTML.
 * @returns {Promise<{ html: string, title: string, warnings: string[] }>}
 */
export function fileToHtml({ originalname, buffer }) {
  return convertFile({
    filename: originalname,
    bytes: buffer,
    sanitize: sanitizeContent,
    docxToHtml: (bytes) =>
      mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, { styleMap: DOCX_STYLE_MAP }),
  });
}
