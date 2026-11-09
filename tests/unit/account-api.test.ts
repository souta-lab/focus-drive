import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import accountWorker from '../../worker/index.js';

/**
 * Runs the real account Worker against a real SQLite database by shimming the small slice of
 * the D1 API it uses. This exercises password derivation, session cookies, lockout and the
 * profile backup end to end without needing a Cloudflare account.
 */
function createD1(): { DB: { prepare: (sql: string) => unknown; batch: (statements: unknown[]) => Promise<unknown[]> }; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const make = (sql: string) => {
    let params: unknown[] = [];
    const api = {
      bind(...values: unknown[]) { params = values; return api; },
      async first() { return raw.prepare(sql).get(...(params as never[])) ?? null; },
      async run() { raw.prepare(sql).run(...(params as never[])); return { success: true }; },
      async all() { return { results: raw.prepare(sql).all(...(params as never[])) }; },
    };
    return api;
  };
  return {
    DB: {
      prepare: make,
      batch: async (statements: unknown[]) => {
        const results = [];
        for (const statement of statements as { run: () => Promise<unknown> }[]) results.push(await statement.run());
        return results;
      },
    },
    raw,
  };
}

const env = (db: ReturnType<typeof createD1>) => ({ DB: db.DB, ASSETS: { fetch: async () => new Response('assets') } }) as never;

async function call(db: ReturnType<typeof createD1>, path: string, init: RequestInit = {}): Promise<Response> {
  return accountWorker.fetch(new Request(`https://focus-drive.test${path}`, init), env(db));
}

/** Fast stand-in for the browser KDF; the server never derives, it only hardens. */
const verifierFor = (password: string): string => btoa(`verifier:${password}`.padEnd(48, '.')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const post = (body: unknown, cookie?: string): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

const cookieFrom = (response: Response): string => (response.headers.get('set-cookie') ?? '').split(';')[0]!;

describe('account API runtime portability', () => {
  it('avoids Node-only globals that the Workers runtime does not provide', async () => {
    const source = await readFile(new URL('../../worker/index.js', import.meta.url), 'utf8');
    // A Buffer reference passes in Node tests but throws a 500 on real Workers.
    expect(source).not.toMatch(/\bBuffer\s*[.(]/);
    expect(source).not.toMatch(/\bprocess\./);
    expect(source).not.toMatch(/\brequire\(/);
  });
});

describe('account API on a D1-compatible database', () => {
  let db: ReturnType<typeof createD1>;
  beforeEach(() => { db = createD1(); });

  it('registers, identifies and logs out a player', async () => {
    const created = await call(db, '/api/auth/register', post({ email: 'Player@Example.com ', key: verifierFor('correct horse') }));
    expect(created.status).toBe(201);
    const body = await created.json() as { user: { id: string; email: string } };
    expect(body.user.email).toBe('player@example.com');
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    const cookie = cookieFrom(created);
    expect(cookie).toContain('fd_session=');
    expect(created.headers.get('set-cookie')).toContain('HttpOnly');
    expect(await (await call(db, '/api/auth/me', { headers: { cookie } })).json()).toMatchObject({ user: { email: 'player@example.com' } });
    // Signed out is a normal 200 answer so the browser console stays clean.
    const anonymous = await call(db, '/api/auth/me');
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toMatchObject({ user: null });
    await call(db, '/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect(await (await call(db, '/api/auth/me', { headers: { cookie } })).json()).toMatchObject({ user: null });
    // The raw password must never be stored.
    const rows = db.raw.prepare('SELECT password_hash, salt, iterations FROM users').all() as { password_hash: string; iterations: number }[];
    expect(rows[0]!.password_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.password_hash).not.toContain('correct');
    expect(rows[0]!.iterations).toBeGreaterThanOrEqual(100_000);
  });

  it('rejects duplicates, weak passwords and bad emails', async () => {
    await call(db, '/api/auth/register', post({ email: 'a@b.co', key: verifierFor('longenough') }));
    expect((await call(db, '/api/auth/register', post({ email: 'a@b.co', key: verifierFor('longenough') }))).status).toBe(409);
    expect((await call(db, '/api/auth/register', post({ email: 'nope', key: verifierFor('longenough') }))).status).toBe(400);
    expect((await call(db, '/api/auth/register', post({ email: 'c@d.co', key: 'tooshort' }))).status).toBe(400);
  });

  it('logs in with the right password and locks out repeated failures', async () => {
    await call(db, '/api/auth/register', post({ email: 'lock@me.co', key: verifierFor('longenough') }));
    expect((await call(db, '/api/auth/login', post({ email: 'lock@me.co', key: verifierFor('wrongpass') }))).status).toBe(401);
    const good = await call(db, '/api/auth/login', post({ email: 'lock@me.co', key: verifierFor('longenough') }));
    expect(good.status).toBe(200);
    for (let i = 0; i < 8; i++) await call(db, '/api/auth/login', post({ email: 'lock@me.co', key: verifierFor('wrongpass') }));
    const locked = await call(db, '/api/auth/login', post({ email: 'lock@me.co', key: verifierFor('longenough') }));
    expect(locked.status).toBe(429);
    // Unknown accounts must not reveal whether the email exists.
    expect((await call(db, '/api/auth/login', post({ email: 'ghost@me.co', key: verifierFor('longenough') }))).status).toBe(401);
  });

  it('backs up and restores a profile only for the signed-in player', async () => {
    const cookie = cookieFrom(await call(db, '/api/auth/register', post({ email: 'sync@me.co', key: verifierFor('longenough') })));
    expect((await call(db, '/api/profile')).status).toBe(401);
    const profile = { schemaVersion: 1, completedMissions: 7, coins: 240 };
    const put = await call(db, '/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ profile }) });
    expect(put.status).toBe(200);
    const got = await call(db, '/api/profile', { headers: { cookie } });
    expect(await got.json()).toMatchObject({ profile });
    // A second account must never see the first player's backup.
    const other = cookieFrom(await call(db, '/api/auth/register', post({ email: 'other@me.co', key: verifierFor('longenough') })));
    expect(await (await call(db, '/api/profile', { headers: { cookie: other } })).json()).toMatchObject({ profile: null });
  });

  it('serves the static game for non-API routes and refuses oversized backups', async () => {
    expect(await (await call(db, '/some/spa/route')).text()).toBe('assets');
    const cookie = cookieFrom(await call(db, '/api/auth/register', post({ email: 'big@me.co', key: verifierFor('longenough') })));
    const huge = { profile: { blob: 'x'.repeat(600 * 1024) } };
    const tooBig = await call(db, '/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(huge) });
    expect(tooBig.status).toBe(413);
  });
});
