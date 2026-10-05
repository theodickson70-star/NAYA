// Mlango mmoja wa kuongea na NAYA API — unatumika na kurasa zote (admin, dereva, mteja).
// API iko kwenye anwani ile ile ya ukurasa, kwa hiyo hakuna URL ya kuweka wala CORS.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status; // 0 = hakuna mtandao / server haifikiki
  }
}

export function createApi(storageKey) {
  let token = null;
  try {
    token = localStorage.getItem(storageKey);
  } catch {
    token = null;
  }

  function setToken(value) {
    token = value;
    try {
      if (value) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
    } catch {
      // storage imezuiwa — token inabaki kwenye kumbukumbu tu
    }
  }

  async function send(method, path, { json, file } = {}) {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    let body;
    if (file) {
      headers['content-type'] = file.type;
      body = file;
    } else if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    }
    try {
      return await fetch(path, { method, headers, body });
    } catch {
      throw new ApiError('Hakuna mawasiliano na mfumo. Angalia mtandao wako.', 0);
    }
  }

  async function request(method, path, options) {
    const res = await send(method, path, options);
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.success === false) {
      throw new ApiError(json?.message ?? `Hitilafu ya mfumo (HTTP ${res.status}). Jaribu tena.`, res.status);
    }
    return json.data;
  }

  /** Faili linalohitaji token (mf. picha ya nyaraka) → Blob. */
  async function blob(path) {
    const res = await send('GET', path);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new ApiError(json?.message ?? 'Faili halikupatikana', res.status);
    }
    return res.blob();
  }

  return {
    get token() {
      return token;
    },
    setToken,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, { json: body ?? {} }),
    put: (path, body) => request('PUT', path, { json: body ?? {} }),
    upload: (path, file) => request('PUT', path, { file }),
    blob,
  };
}

/** Hali ya mfumo (/health) — haihitaji login. */
export async function fetchHealth() {
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    const json = await res.json();
    return { api: true, database: json.database === 'ok', version: json.version };
  } catch {
    return { api: false, database: false, version: null };
  }
}

/** Andika maandishi kwa usalama (bila HTML) — kwa data inayotoka kwa watumiaji. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
