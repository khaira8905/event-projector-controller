import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma';
import { stopAll } from '../src/services/timerService';
import { decryptSecret, encryptSecret } from '../src/services/authService';

/**
 * Google Drive + Google sign-in against a fake Google (token, userinfo, Drive and revoke
 * endpoints), so the whole OAuth round trip and the import run without real credentials.
 */

const app = createApp();
const api = request.agent(app);
let fake: http.Server;
let fakeUrl = '';
let PDF: Buffer;
const calls: string[] = [];
let tokenMode: 'ok' | 'invalid_grant' = 'ok';
let profileEmail = 'operator@example.edu';

beforeAll(async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([640, 360]);
  PDF = Buffer.from(await doc.save());

  fake = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fake');
    calls.push(`${req.method} ${url.pathname}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === '/token') {
      const form = new URLSearchParams(body);
      if (tokenMode === 'invalid_grant') return json(400, { error: 'invalid_grant' });
      if (form.get('grant_type') === 'authorization_code' && form.get('code') !== 'good-code') return json(400, { error: 'invalid_grant' });
      return json(200, {
        access_token: 'access-1',
        expires_in: 3600,
        refresh_token: form.get('grant_type') === 'authorization_code' ? 'refresh-1' : undefined,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
      });
    }
    if (url.pathname === '/revoke') return json(200, {});
    if (req.headers.authorization !== 'Bearer access-1') return json(401, { error: 'unauthorized' });
    if (url.pathname === '/oauth2/v3/userinfo') return json(200, { email: profileEmail, email_verified: true, name: 'Arshdeep K.', picture: null });
    if (url.pathname === '/drive/v3/files') {
      return json(200, {
        files: [
          { id: 'folder-000001', name: 'Talks', mimeType: 'application/vnd.google-apps.folder' },
          { id: 'pdf-00000001', name: 'Keynote.pdf', mimeType: 'application/pdf', size: String(PDF.length), modifiedTime: '2026-09-20T10:00:00Z' },
        ],
      });
    }
    if (url.pathname === '/drive/v3/files/pdf-00000001') {
      if (url.searchParams.get('alt') === 'media') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        return res.end(PDF);
      }
      return json(200, { id: 'pdf-00000001', name: 'Keynote', mimeType: 'application/pdf', size: String(PDF.length) });
    }
    json(404, { error: 'not found' });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  await api.post('/api/auth/setup').send({ password: 'stage-door-42' }).expect(201);
});

afterAll(async () => {
  stopAll();
  await new Promise((resolve) => fake.close(resolve));
  await prisma.$disconnect();
});

function configureGoogle() {
  Object.assign(config.google, {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://localhost:5173/api/auth/google/callback',
    authUrl: `${fakeUrl}/auth`,
    tokenUrl: `${fakeUrl}/token`,
    revokeUrl: `${fakeUrl}/revoke`,
    apiUrl: fakeUrl,
    allowedEmails: ['operator@example.edu'],
  });
}

/** Starts an OAuth round trip and returns what the browser would carry back: state + nonce cookie. */
async function begin(path: string, agent = api) {
  const res = await agent.get(path);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.location);
  const cookie = String(res.headers['set-cookie']).split(';')[0];
  return { location, state: location.searchParams.get('state')!, cookie };
}

describe('Google integration', () => {
  it('explains what to do when Google is not set up', async () => {
    const status = await api.get('/api/integrations/google');
    expect(status.body).toMatchObject({ configured: false, connected: false });
    const res = await api.get('/api/integrations/google/connect');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/GOOGLE_CLIENT_ID/);
  });

  it('requires an operator session to start connecting', async () => {
    configureGoogle();
    expect((await request(app).get('/api/integrations/google/connect')).status).toBe(401);
  });

  it('connects an account with the authorization-code flow', async () => {
    const { location, state, cookie } = await begin('/api/integrations/google/connect?returnTo=/events/abc?view=settings');
    expect(location.origin + location.pathname).toBe(`${fakeUrl}/auth`);
    // Only files the person picks (non-sensitive scope: no unverified-app warning).
    expect(location.searchParams.get('scope')).toContain('drive.file');
    expect(location.searchParams.get('scope')).not.toContain('drive.readonly');
    expect(location.searchParams.get('access_type')).toBe('offline');
    expect(location.searchParams.get('client_secret')).toBeNull();

    // A callback without the nonce cookie (another browser, forged link) is refused.
    const forged = await request(app).get(`/api/auth/google/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(forged.headers.location).toMatch(/google=error/);

    const cb = await request(app).get(`/api/auth/google/callback?code=good-code&state=${encodeURIComponent(state)}`).set('Cookie', cookie);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/events/abc?view=settings&google=connected');

    const status = await api.get('/api/integrations/google');
    expect(status.body).toMatchObject({ configured: true, connected: true, drive: true, account: { email: 'operator@example.edu' } });
    // Tokens never leave the server, and are stored encrypted.
    expect(JSON.stringify(status.body)).not.toContain('refresh-1');
    // Stored per account (the signed-in operator), encrypted.
    const stored = await prisma.setting.findFirst({ where: { key: { startsWith: 'integration.google' } } });
    expect(stored?.value).not.toContain('refresh-1');
  });

  it('never redirects outside the app', async () => {
    const { state, cookie } = await begin('/api/integrations/google/connect?returnTo=//evil.example/steal');
    const cb = await request(app).get(`/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`).set('Cookie', cookie);
    expect(cb.headers.location).toBe('/?google=cancelled&message=Google+access+was+not+granted.');
  });

  it('opens Google’s picker with a short-lived token, then imports the picked file', async () => {
    const picker = await api.get('/api/integrations/google/picker');
    expect(picker.status).toBe(200);
    // The project number comes from the client ID; nothing secret goes to the browser.
    expect(picker.body).toMatchObject({ accessToken: 'access-1', appId: 'client', apiKey: null });
    expect(picker.body.expiresAt).toBeGreaterThan(Date.now());
    expect(JSON.stringify(picker.body)).not.toMatch(/refresh-1|client-secret/);

    const event = (await api.post('/api/events').send({ name: 'Drive Event', date: '2026-10-01' })).body;
    const imported = await api.post(`/api/events/${event.id}/media/drive`).send({ fileIds: ['pdf-00000001'] });
    expect(imported.status).toBe(201);
    expect(imported.body.uploaded[0]).toMatchObject({ name: 'Keynote.pdf', kind: 'pdf', source: 'drive', pageCount: 3 });

    // Same file again: recognised as a duplicate, not copied twice.
    const again = await api.post(`/api/events/${event.id}/media/drive`).send({ fileIds: ['pdf-00000001'] });
    expect(again.body.uploaded).toHaveLength(0);
    expect(again.body.duplicates).toHaveLength(1);
  });

  it('asks to reconnect when Google no longer accepts the connection', async () => {
    // Force a refresh by expiring the stored access token.
    const row = await prisma.setting.findFirstOrThrow({ where: { key: { startsWith: 'integration.google' } } });
    const account = JSON.parse((await decryptSecret(row.value))!);
    await prisma.setting.update({ where: { key: row.key }, data: { value: await encryptSecret(JSON.stringify({ ...account, expiresAt: 0 })) } });

    tokenMode = 'invalid_grant';
    const res = await api.get('/api/integrations/google/picker');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GOOGLE_RECONNECT');
    expect((await api.get('/api/integrations/google')).body.connected).toBe(false);
    tokenMode = 'ok';
  });

  it('disconnects and revokes access', async () => {
    const { state, cookie } = await begin('/api/integrations/google/connect');
    await request(app).get(`/api/auth/google/callback?code=good-code&state=${encodeURIComponent(state)}`).set('Cookie', cookie);
    calls.length = 0;
    const res = await api.post('/api/integrations/google/disconnect');
    expect(res.body.connected).toBe(false);
    expect(calls).toContain('POST /revoke');
  });

  it('signs in allowed Google accounts only', async () => {
    const browser = request.agent(app);
    expect((await browser.get('/api/auth/status')).body).toMatchObject({ authenticated: false, google: true });

    const ok = await begin('/api/auth/google/start', browser);
    const cb = await browser.get(`/api/auth/google/callback?code=good-code&state=${encodeURIComponent(ok.state)}`).set('Cookie', ok.cookie);
    expect(cb.headers.location).toBe('/?google=signed-in');
    const session = String(cb.headers['set-cookie']).match(/ec_session=[^;]+/)?.[0];
    expect(session).toBeTruthy();
    expect((await request(app).get('/api/auth/status').set('Cookie', session!)).body.authenticated).toBe(true);

    profileEmail = 'stranger@example.com';
    const other = request.agent(app);
    const no = await begin('/api/auth/google/start', other);
    const denied = await other.get(`/api/auth/google/callback?code=good-code&state=${encodeURIComponent(no.state)}`).set('Cookie', no.cookie);
    expect(denied.headers.location).toMatch(/google=denied/);
    expect(String(denied.headers['set-cookie'] ?? '')).not.toMatch(/ec_session=[^;]/);
    profileEmail = 'operator@example.edu';
  });
});

describe('event preferences', () => {
  it('stores Quick Selection and defaults, merging partial updates', async () => {
    const event = (await api.post('/api/events').send({ name: 'Prefs', date: '2026-10-02' })).body;
    expect(event.preferences.quickSelection.map((q: any) => q.kind)).toEqual(['screen', 'screen', 'screen', 'logo']);
    expect(event.preferences.confirmBlack).toBe(true);

    const quick = [{ id: 'a', kind: 'black', label: 'Kill screen' }, { id: 'b', kind: 'screen', screenKey: 'thanks', tone: 'blue' }];
    const updated = await api.put(`/api/events/${event.id}`).send({ preferences: { quickSelection: quick } });
    expect(updated.status).toBe(200);
    expect(updated.body.preferences.quickSelection).toEqual(quick);

    const again = await api.put(`/api/events/${event.id}`).send({ preferences: { confirmBlack: false, defaultStartPage: 3 } });
    expect(again.body.preferences).toMatchObject({ quickSelection: quick, confirmBlack: false, defaultStartPage: 3 });

    const bad = await api.put(`/api/events/${event.id}`).send({ preferences: { quickSelection: [{ id: 'x', kind: 'format-disk' }] } });
    expect(bad.status).toBe(400);
  });
});
