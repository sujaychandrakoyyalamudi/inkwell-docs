import { useEffect, useState } from 'react';

/** File types accepted by the import flow. Keep in sync with server/convert.js. */
export const ACCEPTED_TYPES = '.txt,.md,.markdown,.docx';
export const ACCEPTED_LABEL = '.txt, .md or .docx (max 5 MB)';

/** Tiny hash router: "#/" → home, "#/d/<id>" → document. Survives refresh. */
function parseHash() {
  const match = window.location.hash.match(/^#\/d\/([\w-]+)/);
  return match ? { name: 'doc', id: match[1] } : { name: 'home' };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path) {
  window.location.hash = path;
}

export const openDocument = (id) => navigate(`/d/${id}`);
export const goHome = () => navigate('/');

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return RTF.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return RTF.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 7) return RTF.format(Math.round(seconds / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '';
}

export const firstName = (user) => user?.name?.split(' ')[0] ?? '';

export const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
