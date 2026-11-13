// Browser twin of server/convert.js#sanitizeContent, built on DOMPurify with the
// same allow-list from shared/content.js.
import DOMPurify from 'dompurify';
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_TAGS,
  ALLOWED_TEXT_ALIGN,
  LINK_REL,
} from '../../../shared/content.js';

const purifier = DOMPurify(window);
const allowedAttrs = new Set(Object.values(ALLOWED_ATTRIBUTES).flat());

purifier.addHook('uponSanitizeAttribute', (node, data) => {
  const tag = node.nodeName.toLowerCase();
  const allowedHere = [...(ALLOWED_ATTRIBUTES[tag] ?? []), ...ALLOWED_ATTRIBUTES['*']];
  if (!allowedHere.includes(data.attrName)) {
    data.keepAttr = false;
    return;
  }
  if (data.attrName === 'style') {
    // Keep text-align only, normalized like sanitize-html does on the server.
    const match = /(?:^|;)\s*text-align\s*:\s*([a-z]+)\s*(?:;|$)/i.exec(data.attrValue);
    const value = match?.[1].toLowerCase();
    if (value && ALLOWED_TEXT_ALIGN.test(value)) data.attrValue = `text-align:${value}`;
    else data.keepAttr = false;
  }
});

purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node.hasAttribute('href')) node.setAttribute('rel', LINK_REL);
});

const CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: [...allowedAttrs],
  // http(s) and mailto links, or relative URLs (no scheme at all).
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^:]*$)/i,
  KEEP_CONTENT: true,
};

export function sanitizeContent(html) {
  return purifier.sanitize(String(html ?? ''), CONFIG);
}
