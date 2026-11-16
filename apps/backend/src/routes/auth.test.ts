import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createSession } from '../auth/sessions.js';
import { sessions } from '../db/schema.js';

const ADMIN = { email: 'Admin@Example.com', password: 'correct-horse-battery' };

interface TestApp {
  app: FastifyInstance;
  cleanup: () => Promise<void>;
}

async function startTestApp(): Promise<TestApp> {
  const dir = await mkdtemp(path.join(tmpdir(), 'locternos-auth-'));
  const config = loadConfig({
    LOCTERNOS_DATA_DIR: dir,
    LOCTERNOS_FRONTEND_DIR: path.join(dir, 'no-frontend'),
    LOG_LEVEL: 'silent',
  });
  const app = await buildApp(config);
  return {
    app,
    cleanup: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Extracts `locternos_session=<token>` from a response's Set-Cookie header. */
function sessionCookieFrom(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? first.split(';')[0] : undefined;
}

describe('setup and authentication API', () => {
  let ctx: TestApp;

  before(async () => {
    ctx = await startTestApp();
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('reports setup as required on a fresh database', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { setupRequired: true });
  });

  it('rejects an invalid setup payload before creating anything', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { email: 'not-an-email', password: 'short' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('creates the Admin, signs them in and closes setup', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
    assert.equal(res.statusCode, 201);

    const body = res.json<{ user: { email: string; role: string } }>();
    assert.equal(body.user.email, 'admin@example.com');
    assert.equal(body.user.role, 'admin');
    assert.match(String(res.headers['set-cookie']), /HttpOnly/);
    assert.match(String(res.headers['set-cookie']), /SameSite=Lax/);

    const status = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    assert.deepEqual(status.json(), { setupRequired: false });
  });

  it('refuses a second setup attempt', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { email: 'other@example.com', password: 'another-password' },
    });
    assert.equal(res.statusCode, 409);
  });

  it('returns the same error for a wrong password and an unknown email', async () => {
    const wrongPassword = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: 'definitely-wrong' },
    });
    const unknownEmail = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: ADMIN.password },
    });

    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(unknownEmail.statusCode, 401);
    assert.deepEqual(wrongPassword.json(), unknownEmail.json());
    assert.equal(sessionCookieFrom(wrongPassword), undefined);
  });

  it('logs in with a case-insensitive email and grants access to /me', async () => {
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: '  ADMIN@example.com ', password: ADMIN.password },
    });
    assert.equal(login.statusCode, 200);
    const cookie = sessionCookieFrom(login);
    assert.ok(cookie?.startsWith('locternos_session='));

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json<{ user: { email: string } }>().user.email, 'admin@example.com');
  });

  it('rejects protected requests without a session cookie', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    assert.equal(res.statusCode, 401);
  });

  it('rejects an unknown session token', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'locternos_session=not-a-real-token' },
    });
    assert.equal(res.statusCode, 401);
  });

  it('revokes the session on logout', async () => {
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: ADMIN,
    });
    const cookie = sessionCookieFrom(login);

    const logout = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    assert.equal(logout.statusCode, 204);

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    assert.equal(me.statusCode, 401);
  });

  it('stores only a digest of the session token', async () => {
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: ADMIN,
    });
    const token = sessionCookieFrom(login)?.split('=')[1] ?? '';
    const digest = createHash('sha256').update(token).digest('hex');

    const rows = ctx.app.db.select().from(sessions).all();
    assert.ok(rows.some((row) => row.id === digest));
    assert.ok(rows.every((row) => row.id !== token));
  });

  it('rejects expired sessions', async () => {
    const user = ctx.app.db.select().from(sessions).all()[0];
    assert.ok(user, 'expected an existing session row to copy the user id from');

    // A session created at the Unix epoch expires long before "now".
    const expired = createSession(ctx.app.db, user.userId, new Date(0));
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `locternos_session=${expired.token}` },
    });
    assert.equal(res.statusCode, 401);
  });
});

describe('websocket session gate', () => {
  let ctx: TestApp;
  let url: string;
  let cookie: string;

  before(async () => {
    ctx = await startTestApp();
    await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
    cookie = sessionCookieFrom(login) ?? '';
    await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = ctx.app.server.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}/api/ws`;
  });

  after(async () => {
    await ctx.cleanup();
  });

  /** Resolves with the message types received, or with the failure reason. */
  function connect(headers: Record<string, string>): Promise<{ opened: boolean; hello?: boolean }> {
    return new Promise((resolve) => {
      const WebSocketCtor = WebSocket as unknown as new (
        address: string,
        options: { headers: Record<string, string> },
      ) => WebSocket;
      const socket = new WebSocketCtor(url, { headers });
      const timer = setTimeout(() => {
        socket.close();
        resolve({ opened: false });
      }, 3000);
      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as { type: string };
        if (msg.type === 'hello') {
          clearTimeout(timer);
          socket.close();
          resolve({ opened: true, hello: true });
        }
      };
      socket.onerror = () => {
        clearTimeout(timer);
        resolve({ opened: false });
      };
    });
  }

  it('refuses the upgrade without a session cookie', async () => {
    const result = await connect({});
    assert.equal(result.opened, false);
  });

  it('accepts the upgrade with a valid session cookie', async () => {
    const result = await connect({ cookie });
    assert.deepEqual(result, { opened: true, hello: true });
  });
});
