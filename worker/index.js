/**
 * FOCUS DRIVE account API.
 *
 * Local-first is preserved: the game is fully playable with no account and no network calls.
 * An account only adds an opt-in cloud backup of the player profile so the same progress can be
 * opened on another device. Nothing else is transmitted.
 *
 * Storage: Cloudflare D1 (SQLite). Passwords use PBKDF2-SHA256 with a per-user salt; sessions
 * are random 256-bit tokens stored only as SHA-256 hashes in an HttpOnly cookie.
 */

const SESSION_COOKIE = 'fd_session';
const SESSION_DAYS = 30;
/**
 * The expensive password KDF runs in the browser (see src/persistence/account.ts). Cloudflare's
 * free plan allows only ~10ms of CPU per request, and 210k PBKDF2 iterations measure ~111ms, so
 * a server-side KDF would fail outright. The server therefore receives an already-derived
 * verifier and adds a per-user random salt with a single cheap SHA-256.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{40,120}$/;
/** Verified in the browser before the KDF; recorded here for the client contract. */
const KDF_ITERATIONS = 600_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROFILE_BYTES = 512 * 1024;
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

const enc = new TextEncoder();

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Cheap per-user hardening of the client-derived verifier: one SHA-256 over salt + verifier. */
async function harden(verifier, saltHex) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${saltHex}:${verifier}`));
  return toHex(new Uint8Array(digest));
}

/** Constant-time comparison so a wrong password cannot be probed by timing. */
function sameSecret(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return toHex(new Uint8Array(digest));
}

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;

function cookieValue(request, name) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

const sessionCookie = (token, maxAgeSeconds) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}

/**
 * D1 has no "run this once" hook and the local simulator has no migrate command, so the
 * schema is created on first use. Every statement is IF NOT EXISTS, so this is idempotent.
 */
const schemaReady = new WeakSet();
async function ensureSchema(env) {
  // Keyed by the binding so a recycled isolate cannot skip a freshly created database.
  if (schemaReady.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL, created_at TEXT NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)'),
  ]);
  schemaReady.add(env.DB);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function publicUser(row) {
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

async function createSession(env, userId) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(await hashToken(token), userId, new Date().toISOString(), expires.toISOString()).run();
  return token;
}

async function currentUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT users.id, users.email, users.created_at, sessions.expires_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?1'
  ).bind(await hashToken(token)).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await hashToken(token)).run();
    return null;
  }
  return row;
}

async function register(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const verifier = String(body.key ?? '');
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address');
  if (!KEY_PATTERN.test(verifier)) throw new HttpError(400, 'Password key is malformed');
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (existing) throw new HttpError(409, 'That email is already registered');
  const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO users (id, email, password_hash, salt, iterations, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(id, email, await harden(verifier, saltHex), saltHex, KDF_ITERATIONS, createdAt).run();
  const token = await createSession(env, id);
  return json({ user: { id, email, createdAt } }, 201, { 'set-cookie': sessionCookie(token, SESSION_DAYS * 86_400) });
}

async function login(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const verifier = String(body.key ?? '');
  if (!KEY_PATTERN.test(verifier)) throw new HttpError(401, 'Email or password is incorrect');
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?1').bind(email).first();
  if (!user) throw new HttpError(401, 'Email or password is incorrect');
  const candidate = await harden(verifier, user.salt);
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new HttpError(429, 'Too many attempts. Try again later.');
  }
  if (!sameSecret(candidate, user.password_hash)) {
    const attempts = (user.failed_attempts ?? 0) + 1;
    const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null;
    await env.DB.prepare('UPDATE users SET failed_attempts = ?1, locked_until = ?2 WHERE id = ?3').bind(attempts, lockedUntil, user.id).run();
    throw new HttpError(401, 'Email or password is incorrect');
  }
  await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?1').bind(user.id).run();
  const token = await createSession(env, user.id);
  return json({ user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(token, SESSION_DAYS * 86_400) });
}

async function logout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await hashToken(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

async function handleApi(request, env, url) {
  if (!env.DB) return json({ error: 'Account storage is not configured' }, 503);
  await ensureSchema(env);
  if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(request, env);
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env);
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, env);
  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    // Always 200: this is a "who am I" probe, and a 401 on every page load would show up as a
    // console error for players who never sign in.
    const user = await currentUser(request, env);
    return json({ user: user ? publicUser(user) : null });
  }
  if (url.pathname === '/api/profile') {
    const user = await currentUser(request, env);
    if (!user) return json({ error: 'Sign in required' }, 401);
    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT payload, updated_at FROM profiles WHERE user_id = ?1').bind(user.id).first();
      return json({ profile: row ? JSON.parse(row.payload) : null, updatedAt: row?.updated_at ?? null });
    }
    if (request.method === 'PUT') {
      const body = await readJson(request);
      const payload = JSON.stringify(body?.profile ?? null);
      if (payload.length > MAX_PROFILE_BYTES) return json({ error: 'Profile is too large to back up' }, 413);
      const updatedAt = new Date().toISOString();
      await env.DB.prepare('INSERT INTO profiles (user_id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET payload = ?2, updated_at = ?3')
        .bind(user.id, payload, updatedAt).run();
      return json({ ok: true, updatedAt });
    }
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        if (error instanceof HttpError) return json({ error: error.message }, error.status);
        console.error('account api failure', error);
        return json({ error: 'Unexpected server error' }, 500);
      }
    }
    // Everything else is the static game. The lookup is what makes the SPA fallback work.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
