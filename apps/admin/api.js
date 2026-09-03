/* Supabase access for the admin app: auth, table CRUD and the RPCs.
 *
 * PostgREST is called directly rather than through the JS client library, which
 * keeps this app dependency-free and buildless. Every table request carries the
 * session token, so row level security — not this file — decides what is
 * allowed. A 401 here means the session expired; a 404 on a row usually means
 * RLS filtered it, not that it is missing.
 */

const CONFIG = window.ADMIN_CONFIG;
const SESSION_KEY = 'mv-admin:session';

let session = null;

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch {
    session = null;
  }
  return session;
}

export function currentSession() { return session; }

function persist(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* private browsing: the session simply will not survive a reload */ }
}

export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function headers(extra) {
  const base = {
    apikey: CONFIG.supabaseKey,
    Authorization: 'Bearer ' + (session ? session.access_token : CONFIG.supabaseKey),
    'Content-Type': 'application/json',
  };
  return Object.assign(base, extra || {});
}

async function request(path, options = {}) {
  const response = await fetch(CONFIG.supabaseUrl + path, {
    method: options.method || 'GET',
    headers: headers(options.headers),
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 && session) {
    // The token expired mid-session. Drop it so the router shows the login
    // screen rather than every panel failing one by one.
    persist(null);
    throw new ApiError('Your session expired. Please sign in again.', 401);
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    const message = (payload && (payload.message || payload.error_description || payload.error))
      || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }
  return payload;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { message: text }; }
}

// --- Auth ------------------------------------------------------------------

export async function signIn(email, password) {
  const response = await fetch(CONFIG.supabaseUrl + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      (payload && (payload.error_description || payload.msg || payload.message))
        || 'Sign in failed', response.status, payload);
  }

  persist(payload);

  // Authenticating is not the same as being allowed in: the allow-list is what
  // grants access, and a signed-in stranger must not see an empty dashboard and
  // wonder where the data went.
  const admin = await request('/rest/v1/admin_users?select=id,email&limit=1');
  if (!admin || admin.length === 0) {
    persist(null);
    throw new ApiError('That account is not an administrator for this system.', 403);
  }
  return payload;
}

export function signOut() { persist(null); }

// --- Events ----------------------------------------------------------------

export function listEvents() {
  return request('/rest/v1/events?select=*&order=created_at.desc');
}

export function getEvent(slug) {
  return request(`/rest/v1/events?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`)
    .then((rows) => (rows && rows[0]) || null);
}

export function createEvent(event) {
  return request('/rest/v1/events', {
    method: 'POST', body: event, headers: { Prefer: 'return=representation' },
  }).then((rows) => rows[0]);
}

export function updateEvent(id, patch) {
  return request(`/rest/v1/events?id=eq.${id}`, {
    method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' },
  }).then((rows) => rows[0]);
}

export function deleteEvent(id) {
  return request(`/rest/v1/events?id=eq.${id}`, { method: 'DELETE' });
}

// --- Guests ----------------------------------------------------------------

export function listGuests(eventId) {
  return request(`/rest/v1/guests?event_id=eq.${eventId}&select=*&order=full_name.asc`);
}

export function createGuest(guest) {
  return request('/rest/v1/guests', {
    method: 'POST', body: guest, headers: { Prefer: 'return=representation' },
  }).then((rows) => rows[0]);
}

export function updateGuest(id, patch) {
  return request(`/rest/v1/guests?id=eq.${id}`, {
    method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' },
  }).then((rows) => rows[0]);
}

export function deleteGuest(id) {
  return request(`/rest/v1/guests?id=eq.${id}`, { method: 'DELETE' });
}

export function deleteAllGuests(eventId) {
  return request(`/rest/v1/guests?event_id=eq.${eventId}`, { method: 'DELETE' });
}

/** Insert guests in batches — one request per thousand rows is plenty. */
export async function insertGuests(rows, onProgress) {
  const CHUNK = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await request('/rest/v1/guests', { method: 'POST', body: batch, headers: { Prefer: 'return=minimal' } });
    done += batch.length;
    if (onProgress) onProgress(done, rows.length);
  }
  return done;
}

export function updateGuestsTable(ids, tableNumber) {
  const list = ids.map((id) => `"${id}"`).join(',');
  return request(`/rest/v1/guests?id=in.(${list})`, {
    method: 'PATCH', body: { table_number: tableNumber },
  });
}

// --- Upload history --------------------------------------------------------

export function listUploads(eventId) {
  return request(`/rest/v1/csv_uploads?event_id=eq.${eventId}&select=*&order=uploaded_at.desc&limit=20`);
}

export function logUpload(entry) {
  return request('/rest/v1/csv_uploads', { method: 'POST', body: entry });
}

// --- Kiosk instances -------------------------------------------------------

export function listKiosks(eventId) {
  return request(`/rest/v1/kiosk_instances?event_id=eq.${eventId}&select=*&order=label.asc`);
}

export function createKiosk(kiosk) {
  return request('/rest/v1/kiosk_instances', {
    method: 'POST', body: kiosk, headers: { Prefer: 'return=representation' },
  }).then((rows) => rows[0]);
}

export function deleteKiosk(id) {
  return request(`/rest/v1/kiosk_instances?id=eq.${id}`, { method: 'DELETE' });
}

// --- Analytics -------------------------------------------------------------

export function analytics(slug) {
  return request('/rest/v1/rpc/event_analytics', { method: 'POST', body: { p_slug: slug } });
}

// --- Storage ---------------------------------------------------------------

export async function uploadLogo(eventSlug, file) {
  const path = `${eventSlug}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
  const response = await fetch(
    `${CONFIG.supabaseUrl}/storage/v1/object/${CONFIG.logoBucket}/${path}`, {
      method: 'POST',
      headers: {
        apikey: CONFIG.supabaseKey,
        Authorization: 'Bearer ' + (session ? session.access_token : ''),
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
  if (!response.ok) {
    throw new ApiError('Logo upload failed', response.status, await response.text());
  }
  return `${CONFIG.supabaseUrl}/storage/v1/object/public/${CONFIG.logoBucket}/${path}`;
}
