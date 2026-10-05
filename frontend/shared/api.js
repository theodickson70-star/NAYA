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

  async function request(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Hakuna mawasiliano na mfumo. Angalia mtandao wako.', 0);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.success === false) {
      throw new ApiError(json?.message ?? `Hitilafu ya mfumo (HTTP ${res.status}). Jaribu tena.`, res.status);
    }
    return json.data;
  }

  return {
    get token() {
      return token;
    },
    setToken,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body ?? {}),
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
