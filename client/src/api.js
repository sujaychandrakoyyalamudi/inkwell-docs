export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized = () => {};
/** Called whenever the server reports the session is gone (401). */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, url, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${url}`, init);
  } catch {
    throw new ApiError(0, 'Network error — is the server running?');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, data.error || res.statusText, data);
  }
  return data;
}

function fileForm(file) {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export const api = {
  me: () => request('GET', '/auth/me'),
  users: () => request('GET', '/users'),
  login: (email) => request('POST', '/auth/login', { email }),
  logout: () => request('POST', '/auth/logout'),

  listDocuments: () => request('GET', '/documents'),
  createDocument: (data = {}) => request('POST', '/documents', data),
  getDocument: (id) => request('GET', `/documents/${id}`),
  updateDocument: (id, patch) => request('PATCH', `/documents/${id}`, patch),
  deleteDocument: (id) => request('DELETE', `/documents/${id}`),
  importDocument: (file) => request('POST', '/documents/import', fileForm(file)),
  convertFile: (file) => request('POST', '/convert', fileForm(file)),

  getShares: (id) => request('GET', `/documents/${id}/shares`),
  share: (id, email, role) => request('POST', `/documents/${id}/shares`, { email, role }),
  unshare: (id, userId) => request('DELETE', `/documents/${id}/shares/${userId}`),
};

/** Fire-and-forget save that survives page unload. */
export function saveOnUnload(id, patch) {
  try {
    fetch(`/api/documents/${id}`, {
      method: 'PATCH',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {
    /* best effort */
  }
}
