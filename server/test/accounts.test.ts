import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createSocketServer } from '../src/socket';
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma';
import { stopAll } from '../src/services/timerService';
import { removeExpiredDemos } from '../src/services/demoAccounts';

/**
 * Accounts (AUTH_PROVIDER=supabase) against a fake Supabase Auth: people sign in with the
 * credentials the administrator created, and each person only ever sees their own events.
 */

const USERS: Record<string, { id: string; password: string; name: string }> = {
  'alice@example.com': { id: 'uuid-alice', password: 'alice-pass-1', name: 'Alice' },
  'bob@example.com': { id: 'uuid-bob', password: 'bob-pass-1', name: 'Bob' },
  'carol@example.com': { id: 'uuid-carol', password: 'carol-pass-1', name: 'Carol' },
};
/** Accounts the administrator deleted in Supabase. */
const removed = new Set<string>();
/** Logins created through Request access (admin API): locked until confirmed. */
const created = new Map<string, { id: string; email: string; password: string; name: string; confirmed: boolean }>();
/** Emails "sent" through the fake Brevo. */
const mailbox: { to: string; subject: string; text: string }[] = [];
let supabaseDown = false;

const app = createApp();
let server: http.Server;
let baseUrl = '';
let fake: http.Server;
const sockets: Socket[] = [];

beforeAll(async () => {
  fake = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.url === '/auth/v1/health' && req.headers.apikey === 'anon-key') return json(200, { name: 'GoTrue' });
    if (req.url === '/brevo' && req.headers['api-key'] === 'brevo-key') {
      const m = JSON.parse(body);
      mailbox.push({ to: m.to[0].email, subject: m.subject, text: m.textContent });
      return json(201, { messageId: 'x' });
    }
    if (req.url === '/auth/v1/admin/users' && req.method === 'POST' && req.headers.apikey === 'sb_secret_test') {
      const { email, password, email_confirm, user_metadata } = JSON.parse(body);
      if (USERS[email] || [...created.values()].some((c) => c.email === email)) return json(422, { msg: 'A user with this email address has already been registered', error_code: 'email_exists' });
      const id = `uuid-new-${created.size + 1}`;
      created.set(id, { id, email, password, name: user_metadata?.full_name ?? '', confirmed: !!email_confirm });
      return json(200, { id, email });
    }
    const admin = req.url?.match(/^\/auth\/v1\/admin\/users\/([^/?]+)$/);
    if (admin && req.headers.apikey === 'sb_secret_test') {
      if (supabaseDown) return json(503, {});
      const c = created.get(admin[1]);
      if (req.method === 'PUT') {
        const update = JSON.parse(body);
        const known = Object.values(USERS).find((x) => x.id === admin[1]);
        if (update.password && (c || known)) {
          (c ?? known)!.password = update.password;
          return json(200, { id: admin[1] });
        }
        if (!c) return json(404, { msg: 'User not found' });
        c.confirmed = !!update.email_confirm;
        return json(200, { id: c.id });
      }
      if (req.method === 'DELETE') return created.delete(admin[1]) ? json(200, {}) : json(404, { msg: 'User not found' });
      const u = c ?? Object.values(USERS).find((x) => x.id === admin[1]);
      return !u || removed.has(u.id) ? json(404, { msg: 'User not found' }) : json(200, { id: u.id, banned_until: null });
    }
    if (req.url?.startsWith('/auth/v1/token') && req.headers.apikey === 'anon-key') {
      const { email, password } = JSON.parse(body || '{}');
      const c = [...created.values()].find((x) => x.email === email);
      if (c && c.password === password) {
        return c.confirmed
          ? json(200, { access_token: 'x', user: { id: c.id, email, user_metadata: { full_name: c.name } } })
          : json(400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
      }
      const u = USERS[email] && !removed.has(USERS[email].id) ? USERS[email] : undefined;
      if (email === 'pending@example.com') return json(400, { error: 'invalid_grant', error_description: 'Email not confirmed' });
      if (!u || u.password !== password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return json(200, { access_token: 'x', user: { id: u.id, email, user_metadata: { full_name: u.name } } });
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  config.auth.provider = 'supabase';
  config.supabase.url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  config.supabase.anonKey = 'anon-key';
  config.demo.enabled = true;
  config.access.enabled = true;

  server = http.createServer(app);
  createSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  sockets.forEach((s) => s.close());
  stopAll();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => fake.close(resolve));
  config.supabase.url = '';
  config.supabase.serviceKey = '';
  vi.useRealTimers();
  await prisma.$disconnect();
});

async function signIn(email: string, password = USERS[email]?.password) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  return { agent, res, cookie: String(res.headers['set-cookie'] ?? '').split(';')[0] };
}

function join(eventId: string, role: 'operator' | 'display', cookie?: string) {
  const socket = connect(baseUrl, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : {} });
  sockets.push(socket);
  return new Promise<{ ok: boolean; status?: number }>((resolve) => socket.emit('event:join', { eventId, role }, resolve));
}

describe('accounts', () => {
  let legacyId = '';
  let alice: Awaited<ReturnType<typeof signIn>>;
  let bob: Awaited<ReturnType<typeof signIn>>;
  let aliceEvent = '';

  it('requires signing in; wrong or unconfirmed credentials are refused', async () => {
    legacyId = (await prisma.event.create({ data: { name: 'Before accounts', date: new Date('2026-10-01') } })).id;
    expect((await request(app).get('/api/events')).status).toBe(401);
    expect((await request(app).get('/api/auth/status')).body).toMatchObject({ provider: 'supabase', enabled: true, authenticated: false });
    expect((await signIn('alice@example.com', 'wrong')).res.status).toBe(401);
    const pending = await signIn('pending@example.com', 'x');
    expect(pending.res.status).toBe(401);
    expect(pending.res.body.error).toMatch(/confirm/);
  });

  it('signs people in with the credentials created in Supabase', async () => {
    alice = await signIn('alice@example.com');
    expect(alice.res.status).toBe(200);
    const status = (await alice.agent.get('/api/auth/status')).body;
    expect(status).toMatchObject({ authenticated: true, account: { email: 'alice@example.com', name: 'Alice', plan: 'free' } });
    bob = await signIn('bob@example.com');
    expect(bob.res.status).toBe(200);
  });

  it('gives events from before accounts to the first account', async () => {
    const list = (await alice.agent.get('/api/events')).body;
    expect(list.map((e: any) => e.id)).toContain(legacyId);
    expect((await bob.agent.get('/api/events')).body.map((e: any) => e.id)).not.toContain(legacyId);
  });

  it('keeps each person’s events private', async () => {
    aliceEvent = (await alice.agent.post('/api/events').send({ name: 'Alice Show', date: '2026-10-02' })).body.id;
    const screens = (await alice.agent.get(`/api/events/${aliceEvent}/screens`)).body;
    const item = (await alice.agent.post(`/api/events/${aliceEvent}/queue`).send({ kind: 'screen', screenId: screens[0].id, script: 'Good evening everyone…' })).body;
    expect(item.script).toBe('Good evening everyone…');

    // Bob can't list, read, change, control or delete Alice's event, or anything in it.
    expect((await bob.agent.get('/api/events')).body.map((e: any) => e.id)).not.toContain(aliceEvent);
    expect((await bob.agent.get(`/api/events/${aliceEvent}`)).status).toBe(404);
    expect((await bob.agent.put(`/api/events/${aliceEvent}`).send({ name: 'Hijacked' })).status).toBe(404);
    expect((await bob.agent.get(`/api/events/${aliceEvent}/queue`)).status).toBe(404);
    expect((await bob.agent.patch(`/api/queue/${item.id}`).send({ title: 'x' })).status).toBe(404);
    expect((await bob.agent.delete(`/api/queue/${item.id}`)).status).toBe(404);
    expect((await bob.agent.patch(`/api/screens/${screens[0].id}`).send({ title: 'x' })).status).toBe(404);
    expect((await bob.agent.post(`/api/events/${aliceEvent}/control`).send({ type: 'black' })).status).toBe(404);
    expect((await bob.agent.delete(`/api/events/${aliceEvent}`)).status).toBe(404);
    expect((await alice.agent.get(`/api/events/${aliceEvent}`)).body.name).toBe('Alice Show');
  });

  it('lets only the owner control an event live; the projector link stays open', async () => {
    expect(await join(aliceEvent, 'operator', alice.cookie)).toMatchObject({ ok: true });
    expect(await join(aliceEvent, 'operator', bob.cookie)).toMatchObject({ ok: false, status: 404 });
    expect(await join(aliceEvent, 'operator')).toMatchObject({ ok: false, status: 401 });
    expect(await join(aliceEvent, 'display')).toMatchObject({ ok: true });
  });

  it('saves console settings to the account, separately per person', async () => {
    const prefs = { theme: 'blue', ui: { controlLayout: 'script', shortcuts: { next: ['N'] } } };
    expect((await alice.agent.put('/api/account/preferences').send({ preferences: prefs })).status).toBe(200);
    expect((await alice.agent.get('/api/account')).body).toMatchObject({ email: 'alice@example.com', preferences: prefs });
    expect((await bob.agent.get('/api/account')).body.preferences).toEqual({});
    // Signing in again (another computer) brings the same settings back.
    const again = await signIn('alice@example.com');
    expect((await again.agent.get('/api/account')).body.preferences).toEqual(prefs);
    const tooBig = { blob: 'x'.repeat(25_000) };
    expect((await alice.agent.put('/api/account/preferences').send({ preferences: tooBig })).status).toBe(400);
  });

  it('signs someone out within minutes of their account being removed in Supabase', async () => {
    config.supabase.serviceKey = 'sb_secret_test';
    vi.useFakeTimers({ toFake: ['Date'] });
    const later = (minutes: number) => vi.setSystemTime(Date.now() + minutes * 60_000);

    const carol = await signIn('carol@example.com');
    const event = (await carol.agent.post('/api/events').send({ name: 'Carol Show', date: '2026-10-03' })).body.id;
    const socket = connect(baseUrl, { transports: ['websocket'], extraHeaders: { cookie: carol.cookie } });
    sockets.push(socket);
    const emit = (name: string, payload: unknown) => new Promise<any>((resolve) => socket.emit(name, payload, resolve));
    expect(await emit('event:join', { eventId: event, role: 'operator' })).toMatchObject({ ok: true });
    expect(await emit('control', { type: 'black' })).toMatchObject({ ok: true });

    // Supabase unreachable: nobody is thrown out of a running show over it.
    supabaseDown = true;
    later(3);
    expect((await carol.agent.get('/api/events')).status).toBe(200);
    supabaseDown = false;

    removed.add('uuid-carol');
    later(3);
    expect((await carol.agent.get('/api/events')).status).toBe(401);
    const status = await carol.agent.get('/api/auth/status');
    expect(status.body).toMatchObject({ authenticated: false, account: null });
    expect(String(status.headers['set-cookie'])).toMatch(/ec_session=;/);
    expect(await emit('control', { type: 'black' })).toMatchObject({ ok: false, status: 401 });
    expect((await signIn('carol@example.com')).res.status).toBe(401);
    // Everyone else carries on.
    expect((await alice.agent.get('/api/events')).status).toBe(200);
  });

  it('lets visitors try a private demo that is deleted after 10 minutes', async () => {
    expect((await request(app).get('/api/auth/status')).body.demo).toBe(true);
    const guest = request.agent(app);
    const started = await guest.post('/api/auth/demo');
    expect(started.status).toBe(201);
    const eventId = started.body.eventId;

    // Their own copy of the demo show — and nobody else's events.
    const status = (await guest.get('/api/auth/status')).body;
    expect(status).toMatchObject({ authenticated: true, account: { plan: 'demo', name: 'Demo guest' } });
    expect(status.account.demoEndsAt).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(status.account.demoEndsAt).toBeLessThan(Date.now() + 11 * 60_000);
    const events = (await guest.get('/api/events')).body;
    expect(events.map((e: any) => e.id)).toEqual([eventId]);
    expect((await guest.get(`/api/events/${eventId}/queue`)).body.length).toBeGreaterThan(5);
    expect((await guest.get(`/api/events/${aliceEvent}`)).status).toBe(404);
    expect((await alice.agent.get(`/api/events/${eventId}`)).status).toBe(404);
    // A second visitor gets a separate copy.
    const other = request.agent(app);
    const otherEvent = (await other.post('/api/auth/demo')).body.eventId;
    expect(otherEvent).not.toBe(eventId);
    expect((await other.get(`/api/events/${eventId}`)).status).toBe(404);

    // A small budget, and no outside accounts.
    expect((await guest.get('/api/integrations/google/connect')).status).toBe(403);
    for (let i = 0; i < 4; i++) expect((await guest.post('/api/events').send({ name: `Test ${i}`, date: '2026-10-04' })).status).toBe(201);
    const over = await guest.post('/api/events').send({ name: 'One too many', date: '2026-10-04' });
    expect(over.status).toBe(403);
    expect(over.body.error).toMatch(/demo/i);

    // Time's up: signed out, then everything is deleted.
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect((await guest.get('/api/events')).status).toBe(401);
    await removeExpiredDemos();
    expect(await prisma.event.count({ where: { id: { in: [eventId, otherEvent] } } })).toBe(0);
    expect(await prisma.user.count({ where: { plan: 'demo' } })).toBe(0);
    expect((await alice.agent.get(`/api/events/${aliceEvent}`)).status).toBe(200);
  });

  it('limits how many demos one visitor can start', async () => {
    vi.setSystemTime(Date.now() + 61 * 60_000); // a new hour for this visitor
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await request(app).post('/api/auth/demo')).status);
    expect(results).toEqual([201, 201, 201, 201, 201, 429]);
    await prisma.user.updateMany({ where: { plan: 'demo' }, data: { createdAt: new Date(0) } });
    await removeExpiredDemos();
  });

  it('lets people ask for access: email code, then the administrator approves or removes them', async () => {
    config.email.brevoApiKey = 'brevo-key';
    config.email.from = 'noreply@example.com';
    config.email.apiUrl = `${config.supabase.url}/brevo`;
    const codeFor = (to: string) => mailbox.filter((m) => m.to === to).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];

    expect((await request(app).get('/api/auth/status')).body.access).toEqual({ verify: true });
    const ask = await request(app).post('/api/auth/request-access').send({ name: 'Dave', email: 'Dave@Example.com', password: 'dave-pass-1' });
    expect(ask.status).toBe(201);
    expect(ask.body).toEqual({ verify: true });
    // Locked until the email is confirmed and the administrator approves.
    const early = await request(app).post('/api/auth/login').send({ email: 'dave@example.com', password: 'dave-pass-1' });
    expect(early.status).toBe(403);
    expect(early.body.error).toMatch(/code/);
    expect((await request(app).post('/api/auth/request-access/verify').send({ email: 'dave@example.com', code: '000000' === codeFor('dave@example.com') ? '111111' : '000000' })).status).toBe(400);
    expect((await request(app).post('/api/auth/request-access/verify').send({ email: 'dave@example.com', code: codeFor('dave@example.com') })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200)); // the note to the administrator is sent in the background
    expect(mailbox.some((m) => m.to === 'alice@example.com' && /Dave/.test(m.subject))).toBe(true);
    const waiting = await request(app).post('/api/auth/login').send({ email: 'dave@example.com', password: 'dave-pass-1' });
    expect(waiting.status).toBe(403);
    expect(waiting.body.error).toMatch(/approval/);

    // Only the administrator (the first account) manages people.
    expect((await alice.agent.get('/api/auth/status')).body.account).toMatchObject({ admin: true, pendingRequests: 1, awaitingCode: 0 });
    expect((await bob.agent.get('/api/admin/people')).status).toBe(403);
    const people = (await alice.agent.get('/api/admin/people')).body;
    const dave = people.find((p: any) => p.email === 'dave@example.com');
    expect(dave).toMatchObject({ status: 'pending', emailVerified: true, name: 'Dave' });
    expect((await bob.agent.post(`/api/admin/people/${dave.id}/approve`)).status).toBe(403);
    expect((await alice.agent.post(`/api/admin/people/${dave.id}/approve`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(mailbox.at(-1)).toMatchObject({ to: 'dave@example.com', subject: expect.stringMatching(/sign in/i) });

    const daveIn = await signIn('dave@example.com', 'dave-pass-1');
    expect(daveIn.res.status).toBe(200);
    expect((await daveIn.agent.get('/api/events')).body).toEqual([]);
    // Asking again with an existing email is refused.
    expect((await request(app).post('/api/auth/request-access').send({ name: 'D', email: 'dave@example.com', password: 'whatever-1' })).status).toBe(409);

    // Removing someone ends their session and their login.
    expect((await alice.agent.delete(`/api/admin/people/${dave.id}`)).status).toBe(204);
    expect((await daveIn.agent.get('/api/events')).status).toBe(401);
    expect((await signIn('dave@example.com', 'dave-pass-1')).res.status).toBe(401);
    expect((await alice.agent.delete(`/api/admin/people/${(await prisma.user.findFirst({ where: { email: 'alice@example.com' } }))!.id}`)).status).toBe(400);

    // At most 5 new requests an hour, from everyone together.
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await request(app).post('/api/auth/request-access').send({ name: `P${i}`, email: `p${i}@example.com`, password: 'password-1' })).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    config.email.brevoApiKey = '';
  });

  it('lets people reset a forgotten password with an emailed code', async () => {
    config.email.brevoApiKey = 'brevo-key';
    const before = mailbox.length;
    expect((await request(app).get('/api/auth/status')).body.passwordReset).toBe(true);
    // Same answer for unknown addresses, and nothing is sent.
    expect((await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' })).status).toBe(200);
    expect(mailbox.length).toBe(before);
    expect((await request(app).post('/api/auth/forgot-password').send({ email: 'bob@example.com' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    const code = mailbox.filter((m) => m.to === 'bob@example.com').at(-1)!.text.match(/\b(\d{6})\b/)![1];
    const wrong = code === '123456' ? '654321' : '123456';
    expect((await request(app).post('/api/auth/forgot-password/reset').send({ email: 'bob@example.com', code: wrong, password: 'bob-new-pass' })).status).toBe(400);
    expect((await request(app).post('/api/auth/forgot-password/reset').send({ email: 'bob@example.com', code, password: 'short' })).status).toBe(400);
    const bobElsewhere = await signIn('bob@example.com');
    expect((await bobElsewhere.agent.get('/api/events')).status).toBe(200);
    vi.setSystemTime(Date.now() + 1000); // the test clock is frozen; real time moves on
    expect((await request(app).post('/api/auth/forgot-password/reset').send({ email: 'bob@example.com', code, password: 'bob-new-pass' })).status).toBe(200);
    // The new password signs Bob out everywhere he was signed in.
    expect((await bobElsewhere.agent.get('/api/events')).status).toBe(401);
    expect((await signIn('bob@example.com', 'bob-pass-1')).res.status).toBe(401);
    expect((await signIn('bob@example.com', 'bob-new-pass')).res.status).toBe(200);
    // A used code doesn't work twice.
    expect((await request(app).post('/api/auth/forgot-password/reset').send({ email: 'bob@example.com', code, password: 'bob-other-pass' })).status).toBe(400);
    // Asking again and again (a minute apart) can't flood the inbox: at most 5 codes an hour.
    app.set('trust proxy', true); // each request below comes from a different visitor
    const sentBefore = mailbox.filter((m) => m.to === 'bob@example.com').length;
    for (let i = 0; i < 8; i++) {
      vi.setSystemTime(Date.now() + 61_000);
      await request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', `10.0.0.${i}`).send({ email: 'bob@example.com' });
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(mailbox.filter((m) => m.to === 'bob@example.com').length - sentBefore).toBe(4);
    app.set('trust proxy', false);
    config.email.brevoApiKey = '';
  });

  it('signs an account out everywhere else, keeping this browser signed in', async () => {
    const laptop = await signIn('alice@example.com');
    const phone = await signIn('alice@example.com');
    vi.setSystemTime(Date.now() + 1000);
    expect((await laptop.agent.post('/api/account/sign-out-everywhere')).status).toBe(200);
    expect((await laptop.agent.get('/api/events')).status).toBe(200);
    expect((await phone.agent.get('/api/events')).status).toBe(401);
    expect((await phone.agent.get('/api/auth/status')).body.authenticated).toBe(false);
    // Signing in again afterwards works as usual.
    expect((await (await signIn('alice@example.com')).agent.get('/api/events')).status).toBe(200);
  });

  it('finds the visitor behind Render’s three proxies, ignoring a made-up address', async () => {
    const admin = await signIn('alice@example.com');
    app.set('trust proxy', 3);
    // The chain the live site showed: visitor, Cloudflare, Render's router (then a local proxy).
    const chain = '122.162.99.238, 162.158.44.250, 10.25.19.29';
    const seen = await admin.agent.get('/api/admin/ip-check').set('X-Forwarded-For', chain);
    expect(seen.body.ip).toBe('122.162.99.238');
    const spoofed = await admin.agent.get('/api/admin/ip-check').set('X-Forwarded-For', `6.6.6.6, ${chain}`);
    expect(spoofed.body.ip).toBe('122.162.99.238');
    app.set('trust proxy', false);
  });

  it('answers the daily keep-alive without signing in, touching the database and Supabase', async () => {
    const res = await request(app).get('/api/keep-alive');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, database: true, supabase: true });
  });

  it('keeps the sign-in only for this browser session', async () => {
    const { res } = await signIn('bob@example.com');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/ec_session=/);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
  });
});
