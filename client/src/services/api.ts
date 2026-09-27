import type { Account, AuthStatus, DriveFile, EventInput, GoogleStatus, PreferencesPatch, EventSummary, Media, QueueItem, ScheduleItem, Screen, ScreenStyle, SystemStatus, UploadResult } from '../types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Where the API lives. Empty (the default) = the same site that serves this page, which is
 * how EventControl is normally hosted. Set VITE_API_URL at build time only when the UI is
 * hosted separately, e.g. VITE_API_URL=https://api.example.com.
 */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');
const apiUrl = (path: string) => `${API_BASE}${path}`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      credentials: API_BASE ? 'include' : 'same-origin',
      headers: init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiError('Can’t reach the EventControl server. Check the internet connection; it retries on its own.', 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.status === 401 && data?.code === 'UNAUTHENTICATED') {
    // Session expired: the auth gate listens for this and shows the sign-in page.
    window.dispatchEvent(new Event('eventcontrol:unauthenticated'));
  }
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status}).`, res.status, data?.code);
  }
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  setupPassword: (password: string) => request<{ ok: true }>('/api/auth/setup', { method: 'POST', body: json({ password }) }),
  login: (password: string, email?: string) => request<{ ok: true }>('/api/auth/login', { method: 'POST', body: json({ password, email }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  startDemo: () => request<{ ok: true; eventId: string }>('/api/auth/demo', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/change-password', { method: 'POST', body: json({ currentPassword, newPassword }) }),
  status: () => request<SystemStatus>('/api/status'),
  account: () => request<Account>('/api/account'),
  saveAccountPreferences: (preferences: Record<string, unknown>) =>
    request<{ ok: true }>('/api/account/preferences', { method: 'PUT', body: json({ preferences }) }),

  listEvents: () => request<EventSummary[]>('/api/events'),
  getEvent: (id: string) => request<EventSummary>(`/api/events/${id}`),
  createEvent: (input: EventInput) => request<EventSummary>('/api/events', { method: 'POST', body: json(input) }),
  updateEvent: (id: string, input: Partial<EventInput>) =>
    request<EventSummary>(`/api/events/${id}`, { method: 'PUT', body: json(input) }),
  updatePreferences: (id: string, preferences: PreferencesPatch) =>
    request<EventSummary>(`/api/events/${id}`, { method: 'PUT', body: json({ preferences }) }),
  deleteEvent: (id: string) => request<void>(`/api/events/${id}`, { method: 'DELETE' }),

  listMedia: (eventId: string) => request<Media[]>(`/api/events/${eventId}/media`),
  renameMedia: (id: string, name: string) => request<Media>(`/api/media/${id}`, { method: 'PATCH', body: json({ name }) }),
  moveMedia: (id: string, folder: string) => request<Media>(`/api/media/${id}`, { method: 'PATCH', body: json({ folder }) }),
  reconvertMedia: (id: string) => request<{ ok: true }>(`/api/media/${id}/convert`, { method: 'POST' }),
  deleteMedia: (id: string) => request<void>(`/api/media/${id}`, { method: 'DELETE' }),
  openMediaExternally: (id: string) => request<{ ok: true }>(`/api/media/${id}/open`, { method: 'POST' }),

  /** Upload with progress reporting (fetch has no upload progress, so use XHR). */
  googleStatus: () => request<GoogleStatus>('/api/integrations/google'),
  googleDisconnect: () => request<GoogleStatus>('/api/integrations/google/disconnect', { method: 'POST' }),
  /** Full-page navigation: Google's consent screen, then back to `returnTo`. */
  googleConnectUrl: (returnTo: string) => apiUrl(`/api/integrations/google/connect?returnTo=${encodeURIComponent(returnTo)}`),
  googleSignInUrl: () => apiUrl('/api/auth/google/start'),
  driveList: (opts: { q?: string; folderId?: string; pageToken?: string }) => {
    const params = new URLSearchParams(Object.entries(opts).filter(([, v]) => !!v) as [string, string][]);
    return request<{ files: DriveFile[]; nextPageToken: string | null }>(`/api/integrations/google/drive?${params}`);
  },
  importFromDrive: (eventId: string, fileIds: string[], folder = '') =>
    request<UploadResult>(`/api/events/${eventId}/media/drive`, { method: 'POST', body: json({ fileIds, folder }) }),
  uploadMedia: (eventId: string, files: File[], onProgress?: (fraction: number) => void, folder = '') =>
    new Promise<UploadResult>((resolve, reject) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f, f.name));
      const xhr = new XMLHttpRequest();
      xhr.withCredentials = !!API_BASE;
      xhr.open('POST', apiUrl(`/api/events/${eventId}/media${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onerror = () => reject(new ApiError('Unable to upload file. Check the server connection.', 0));
      xhr.onload = () => {
        let data: any = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON error */
        }
        if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data as UploadResult);
        else if (xhr.status === 400 && data?.rejected) resolve(data as UploadResult);
        else reject(new ApiError(data?.error ?? 'Unable to upload file.', xhr.status));
      };
      xhr.send(form);
    }),

  getQueue: (eventId: string) => request<QueueItem[]>(`/api/events/${eventId}/queue`),
  addToQueue: (eventId: string, mediaId: string, extra: { title?: string; notes?: string; startPage?: number | null; endPage?: number | null } = {}) =>
    request<QueueItem>(`/api/events/${eventId}/queue`, { method: 'POST', body: json({ mediaId, ...extra }) }),
  addScreenToFlow: (eventId: string, screenId: string, durationSeconds?: number | null) =>
    request<QueueItem>(`/api/events/${eventId}/queue`, { method: 'POST', body: json({ kind: 'screen', screenId, durationSeconds: durationSeconds ?? null }) }),
  reorderQueue: (eventId: string, order: string[]) =>
    request<QueueItem[]>(`/api/events/${eventId}/queue`, { method: 'PUT', body: json({ order }) }),
  updateQueueItem: (
    id: string,
    patch: { title?: string | null; notes?: string; script?: string; durationSeconds?: number | null; startPage?: number | null; endPage?: number | null },
  ) =>
    request<QueueItem>(`/api/queue/${id}`, { method: 'PATCH', body: json(patch) }),
  deleteQueueItem: (id: string) => request<void>(`/api/queue/${id}`, { method: 'DELETE' }),

  listScreens: (eventId: string) => request<Screen[]>(`/api/events/${eventId}/screens`),
  createScreen: (eventId: string, input: ScreenInput) => request<Screen>(`/api/events/${eventId}/screens`, { method: 'POST', body: json(input) }),
  updateScreen: (id: string, input: Partial<ScreenInput>) => request<Screen>(`/api/screens/${id}`, { method: 'PATCH', body: json(input) }),
  deleteScreen: (id: string) => request<void>(`/api/screens/${id}`, { method: 'DELETE' }),

  getSchedule: (eventId: string) => request<ScheduleItem[]>(`/api/events/${eventId}/schedule`),
  addScheduleItem: (eventId: string, item: Omit<ScheduleItem, 'id' | 'eventId'>) =>
    request<ScheduleItem>(`/api/events/${eventId}/schedule`, { method: 'POST', body: json(item) }),
  updateScheduleItem: (id: string, patch: Partial<Omit<ScheduleItem, 'id' | 'eventId'>>) =>
    request<ScheduleItem>(`/api/schedule/${id}`, { method: 'PATCH', body: json(patch) }),
  deleteScheduleItem: (id: string) => request<void>(`/api/schedule/${id}`, { method: 'DELETE' }),
};

export const ACCEPTED_FILE_TYPES = '.ppt,.pptx,.pdf,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov';

export interface ScreenInput {
  title: string;
  subtitle: string;
  style: ScreenStyle;
  showTimer: boolean;
  backgroundMediaId: string | null;
}
