import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma';
import { stopAll } from '../src/services/timerService';

/**
 * Open access (the default): anyone with the link uses the app without a password, while
 * personal connections (Google Drive) stay with the browser that made them.
 */

const app = createApp();
let fake: http.Server;
let fakeUrl = '';

beforeAll(async () => {
  config.auth.provider = 'none';
  fake = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://fake');
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === '/token') return json(200, { access_token: 'access-A', expires_in: 3600, refresh_token: 'refresh-A', scope: 'openid email https://www.googleapis.com/auth/drive.readonly' });
    if (url.pathname === '/revoke') return json(200, {});
    if (req.headers.authorization !== 'Bearer access-A') return json(401, {});
    if (url.pathname === '/oauth2/v3/userinfo') return json(200, { email: 'alice@example.com', email_verified: true, name: 'Alice' });
    if (url.pathname === '/drive/v3/files') return json(200, { files: [] });
    json(404, {});
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  Object.assign(config.google, {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://show.example.com/api/auth/google/callback',
    authUrl: `${fakeUrl}/auth`,
    tokenUrl: `${fakeUrl}/token`,
    revokeUrl: `${fakeUrl}/revoke`,
    apiUrl: fakeUrl,
    allowedEmails: ['alice@example.com'],
  });
});

afterAll(async () => {
  stopAll();
  await new Promise((resolve) => fake.close(resolve));
  await prisma.$disconnect();
});

describe('open access', () => {
  it('needs no password or account', async () => {
    const status = (await request(app).get('/api/auth/status')).body;
    expect(status).toMatchObject({ enabled: false, authenticated: true, google: false });
    const created = await request(app).post('/api/events').send({ name: 'Public Event', date: '2026-10-05' });
    expect(created.status).toBe(201);
    expect((await request(app).get(`/api/events/${created.body.id}`)).status).toBe(200);
    // "Sign in with Google" is a private-mode feature.
    expect((await request(app).get('/api/auth/google/start')).status).toBe(404);
  });

  it('keeps a connected Google Drive with the browser that connected it', async () => {
    const alice = request.agent(app);
    const bob = request.agent(app);

    const start = await alice.get('/api/integrations/google/connect?returnTo=/events/x');
    const state = new URL(start.headers.location).searchParams.get('state')!;
    await alice.get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(state)}`).expect(302);

    expect((await alice.get('/api/integrations/google')).body).toMatchObject({ connected: true, account: { email: 'alice@example.com' } });
    // A connection made with the older whole-Drive access still opens the picker.
    expect((await alice.get('/api/integrations/google/picker')).body).toMatchObject({ accessToken: 'access-A' });

    // Connected services: Google listed with what it unlocks, connected for Alice only.
    const aliceServices = (await alice.get('/api/integrations')).body;
    expect(aliceServices[0]).toMatchObject({ id: 'google', configured: true, connected: true, features: [{ id: 'drive', available: true }] });
    expect(JSON.stringify(aliceServices)).not.toMatch(/access-A|refresh-A/);
    expect((await bob.get('/api/integrations')).body[0]).toMatchObject({ connected: false, account: null });

    // Someone else with the same link sees their own (empty) connection, not Alice's Drive.
    expect((await bob.get('/api/integrations/google')).body).toMatchObject({ connected: false, account: null });
    const denied = await bob.get('/api/integrations/google/picker');
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe('GOOGLE_RECONNECT');

    // The browser id cookie is HttpOnly, so page scripts can't read or copy it.
    const cookie = String((await request(app).get('/api/integrations/google')).headers['set-cookie']);
    expect(cookie).toMatch(/ec_device=[\w-]+/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('never launches apps on the server for visitors from elsewhere', async () => {
    config.allowExternalOpen = true;
    const status = await request(app).get('/api/status').set('X-Forwarded-For', '203.0.113.9');
    expect(status.body.openExternally).toBe(false);
    const res = await request(app).post('/api/media/anything/open').set('CF-Connecting-IP', '203.0.113.9');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OPEN_REMOTE');
    config.allowExternalOpen = false;
  });

  it('allows a separately hosted UI only when it is listed', async () => {
    const preflight = (origin: string) => request(app).options('/api/events').set('Origin', origin).set('Access-Control-Request-Method', 'POST');
    expect((await preflight('https://ui.example.com')).headers['access-control-allow-origin']).toBeUndefined();
    config.corsOrigins.push('https://ui.example.com');
    const ok = await preflight('https://ui.example.com');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://ui.example.com');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    config.corsOrigins.pop();
  });
});

describe('black screen and presentation behaviour', () => {
  let eventId = '';
  let itemA = '';
  let itemB = '';
  const control = (command: object) => request(app).post(`/api/events/${eventId}/control`).send(command);
  const page = async () => (await request(app).get(`/api/events/${eventId}/state`)).body;

  beforeAll(async () => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) doc.addPage([640, 360]);
    const pdf = Buffer.from(await doc.save());
    eventId = (await request(app).post('/api/events').send({ name: 'Black Event', date: '2026-10-06' })).body.id;
    const up = await request(app).post(`/api/events/${eventId}/media`).attach('files', pdf, 'Deck.pdf');
    const doc2 = await PDFDocument.create();
    for (let i = 0; i < 2; i++) doc2.addPage([640, 360]);
    const up2 = await request(app).post(`/api/events/${eventId}/media`).attach('files', Buffer.from(await doc2.save()), 'Other.pdf');
    itemA = (await request(app).post(`/api/events/${eventId}/queue`).send({ mediaId: up.body.uploaded[0].id })).body.id;
    itemB = (await request(app).post(`/api/events/${eventId}/queue`).send({ mediaId: up2.body.uploaded[0].id })).body.id;
  });

  it('merges nested settings and sends the black-screen look to the projector', async () => {
    const res = await request(app).put(`/api/events/${eventId}`).send({ preferences: { blackScreen: { showLogo: true, statusText: 'Back shortly' } } });
    expect(res.body.preferences.blackScreen).toMatchObject({ enabled: true, showLogo: true, statusText: 'Back shortly', resume: 'same', fade: true });
    expect((await page()).display.blackScreen).toMatchObject({ showLogo: true, statusText: 'Back shortly' });
    expect((await request(app).put(`/api/events/${eventId}`).send({ preferences: { blackScreen: { logoSize: 'huge' } } })).status).toBe(400);
  });

  it('brings back the same slide after black, or moves on when set to', async () => {
    await control({ type: 'show-item', queueItemId: itemA, page: 3 }).expect(200);
    await control({ type: 'black' }).expect(200);
    await control({ type: 'next' }).expect(200);
    expect(await page()).toMatchObject({ display: { mode: 'media', page: 3 } });

    await request(app).put(`/api/events/${eventId}`).send({ preferences: { blackScreen: { resume: 'advance' } } });
    await control({ type: 'black' }).expect(200);
    await control({ type: 'next' }).expect(200);
    expect(await page()).toMatchObject({ display: { mode: 'media', page: 4 } });
  });

  it('reopens a deck where it was left when “remember last slide” is on', async () => {
    await control({ type: 'show-item', queueItemId: itemA, page: 4 });
    await control({ type: 'show-item', queueItemId: itemB });
    await control({ type: 'show-item', queueItemId: itemA });
    expect((await page()).display.page).toBe(1);

    await request(app).put(`/api/events/${eventId}`).send({ preferences: { presentation: { startAt: 'last' } } });
    await control({ type: 'show-item', queueItemId: itemA, page: 4 });
    await control({ type: 'show-item', queueItemId: itemB });
    await control({ type: 'show-item', queueItemId: itemA });
    expect((await page()).display.page).toBe(4);
  });
});
