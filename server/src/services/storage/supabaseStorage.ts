import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { CloudStorage } from './types';

/**
 * Headers for Supabase's server-side APIs. Legacy service_role keys are JWTs and go in both
 * headers. The newer "secret" keys (sb_secret_…) are not JWTs: they go only in `apikey`, and
 * Supabase's gateway turns them into a short-lived token itself.
 */
export function serviceHeaders(serviceKey: string, extra: Record<string, string> = {}): Record<string, string> {
  if (serviceKey.startsWith('sb_')) return { apikey: serviceKey, ...extra };
  return { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, ...extra };
}

/** Supabase Storage via its REST API (no SDK needed). Uses the service-role key: server-side only. */
export class SupabaseStorage implements CloudStorage {
  readonly name = 'supabase';

  constructor(
    private url: string,
    private serviceKey: string,
    private bucket: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return serviceHeaders(this.serviceKey, extra);
  }

  private objectUrl(key: string) {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${this.url}/storage/v1/object/${encodeURIComponent(this.bucket)}/${encoded}`;
  }

  private async fail(res: Response, action: string): Promise<never> {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${action} failed (${res.status}): ${body.slice(0, 200)}`);
  }

  async upload(key: string, absPath: string, contentType: string) {
    const { size } = await fsp.stat(absPath);
    const res = await fetch(this.objectUrl(key), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': contentType, 'Content-Length': String(size), 'x-upsert': 'true', 'cache-control': '3600' }),
      body: Readable.toWeb(fs.createReadStream(absPath)) as any,
      // Required by Node's fetch for streamed request bodies.
      duplex: 'half',
    } as RequestInit);
    if (!res.ok) await this.fail(res, 'upload');
  }

  async download(key: string, destAbsPath: string) {
    const res = await fetch(this.objectUrl(key), { headers: this.headers() });
    if (!res.ok || !res.body) await this.fail(res, 'download');
    await fsp.mkdir(path.dirname(destAbsPath), { recursive: true });
    const tmp = `${destAbsPath}.part`;
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
    await fsp.rename(tmp, destAbsPath);
  }

  async remove(keys: string[]) {
    if (keys.length === 0) return;
    const res = await fetch(`${this.url}/storage/v1/object/${encodeURIComponent(this.bucket)}`, {
      method: 'DELETE',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: keys }),
    });
    if (!res.ok) await this.fail(res, 'delete');
  }

  async health() {
    try {
      const res = await fetch(`${this.url}/storage/v1/bucket/${encodeURIComponent(this.bucket)}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return { ok: true, message: `Connected to bucket "${this.bucket}"` };
      if (res.status === 404 || res.status === 400) return { ok: false, message: `Bucket "${this.bucket}" not found. Create it in Supabase → Storage.` };
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Supabase rejected the service key.' };
      return { ok: false, message: `Supabase responded with ${res.status}.` };
    } catch {
      return { ok: false, message: 'Cannot reach Supabase (offline?). Files are served from the local copy.' };
    }
  }
}
