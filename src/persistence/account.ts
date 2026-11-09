/**
 * Optional account client.
 *
 * FOCUS DRIVE is local-first: nothing here runs unless the player opens the account panel and
 * signs in. Play, scoring and saving all work with no account and no network.
 */
export interface AccountUser { id: string; email: string; createdAt: string }
export interface AccountState { user: AccountUser | null; busy: boolean; error: string | null; notice: string | null; /** Kept so re-rendering the panel does not wipe what the player typed. */ draftEmail?: string }

const JSON_HEADERS = { 'content-type': 'application/json' };
/** Iterations for the browser-side PBKDF2. The server never runs this see worker/index.js. */
export const KDF_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 8;

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Derives the password verifier in the browser.
 *
 * The salt is a hash of the email rather than a server value, so signing in needs no extra
 * round trip and an attacker cannot use the endpoint to discover which emails are registered.
 * The verifier is what the server stores (further salted per user), so a database leak still
 * requires the expensive KDF for every password guess.
 */
export async function deriveVerifier(email: string, password: string, iterations = KDF_ITERATIONS): Promise<string> {
  const saltDigest = await crypto.subtle.digest('SHA-256', enc.encode(`focus-drive:v1:${email.trim().toLowerCase()}`));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(saltDigest), iterations, hash: 'SHA-256' }, key, 256);
  return b64url(new Uint8Array(bits));
}

export function validateCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return 'メールアドレスの形式を確認してください';
  if (password.length < MIN_PASSWORD_LENGTH) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`;
  return null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${response.status})`);
  return body as T;
}

export const account = {
  /** Resolves the signed-in player, or null when playing locally. Never throws. */
  async current(): Promise<AccountUser | null> {
    try {
      const body = await request<{ user: AccountUser | null }>('/api/auth/me');
      return body.user ?? null;
    } catch {
      // A static-only deploy has no API at all; accounts are simply unavailable there.
      return null;
    }
  },
  signIn: async (email: string, password: string) => request<{ user: AccountUser }>('/api/auth/login', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email, key: await deriveVerifier(email, password) }) }),
  register: async (email: string, password: string) => request<{ user: AccountUser }>('/api/auth/register', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email, key: await deriveVerifier(email, password) }) }),
  signOut: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  backup: (profile: unknown) => request<{ ok: boolean; updatedAt: string }>('/api/profile', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ profile }) }),
  restore: () => request<{ profile: unknown; updatedAt: string | null }>('/api/profile'),
};
