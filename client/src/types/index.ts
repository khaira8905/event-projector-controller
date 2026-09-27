export type MediaKind = 'image' | 'video' | 'pdf' | 'presentation';
export type DisplayMode = 'media' | 'screen' | 'black' | 'logo';
export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
export type ScreenStyle = 'please-wait' | 'technical' | 'break' | 'starting' | 'coming-up' | 'thanks' | 'custom';
export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface EventSummary {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  venue: string;
  waitingMessage: string;
  logoMediaId: string | null;
  overlay: { mediaId: string | null; position: OverlayPosition; size: number; opacity: number; visible: boolean };
  preferences: EventPreferences;
  createdAt: string;
  updatedAt: string;
  counts?: { media: number; queueItems: number; scheduleItems: number };
}

export type QuickKind = 'screen' | 'media' | 'black' | 'logo' | 'current';
export type QuickTone = 'amber' | 'red' | 'blue' | 'neutral';

/** One button in Quick Selection. */
export interface QuickItem {
  id: string;
  kind: QuickKind;
  screenId?: string;
  screenKey?: string;
  mediaId?: string;
  page?: number;
  label?: string;
  tone?: QuickTone;
}

/** Operator preferences stored with the event (shared by every console). */
export interface EventPreferences {
  quickSelection: QuickItem[];
  defaultMediaId: string | null;
  defaultStartPage: number | null;
  confirmBlack: boolean;
  blackScreen: BlackScreenPrefs;
  presentation: { startAt: 'first' | 'last'; confirmSwitch: boolean };
}

/** How the projector draws Black Screen and how the show returns from it (saved with the event). */
export interface BlackScreenPrefs {
  enabled: boolean;
  showLogo: boolean;
  logoSize: 'small' | 'medium' | 'large';
  logoPosition: 'center' | 'lower' | 'corner';
  animateLogo: boolean;
  fade: boolean;
  statusText: string;
  resume: 'same' | 'advance';
}

/** A partial settings update; the nested groups can be changed one field at a time. */
export type PreferencesPatch = Partial<Omit<EventPreferences, 'blackScreen' | 'presentation'>> & {
  blackScreen?: Partial<BlackScreenPrefs>;
  presentation?: Partial<EventPreferences['presentation']>;
};

export const DEFAULT_BLACK_SCREEN: BlackScreenPrefs = {
  enabled: true,
  showLogo: false,
  logoSize: 'medium',
  logoPosition: 'center',
  animateLogo: true,
  fade: true,
  statusText: '',
  resume: 'same',
};

export interface EventInput {
  name: string;
  date: string;
  description?: string;
  venue?: string;
  waitingMessage?: string;
  logoMediaId?: string | null;
}

export type ConversionStatus = 'none' | 'pending' | 'ready' | 'failed' | 'unavailable';
export type CloudStatus = 'local' | 'pending' | 'synced' | 'error';

export interface Media {
  id: string;
  eventId: string;
  name: string;
  originalName: string;
  kind: MediaKind;
  mimeType: string;
  size: number;
  folder: string;
  pageCount: number | null;
  conversionStatus: ConversionStatus;
  conversionError: string | null;
  cloudStatus: CloudStatus;
  cloudError: string | null;
  /** Where the file came from. */
  source?: 'upload' | 'drive';
  createdAt: string;
  url: string;
  /** Browser-renderable PDF (PDFs, and PPT/PPTX once converted). */
  pdfUrl: string | null;
  missing: boolean;
}

export type PublicMedia = Pick<Media, 'id' | 'name' | 'kind' | 'mimeType' | 'url' | 'pdfUrl' | 'pageCount' | 'missing'>;

export interface Screen {
  id: string;
  eventId: string;
  key: string | null;
  title: string;
  subtitle: string;
  style: ScreenStyle;
  showTimer: boolean;
  backgroundMediaId: string | null;
  background: PublicMedia | null;
  builtin: boolean;
}

/** A Show Flow item: a presentation/media (optionally a slide range) or a special screen. */
export interface QueueItem {
  id: string;
  eventId: string;
  kind: 'media' | 'screen';
  mediaId: string | null;
  screenId: string | null;
  position: number;
  title: string | null;
  startPage: number | null;
  endPage: number | null;
  durationSeconds: number | null;
  notes: string;
  /** Longer presenter script shown in the script layout (operator-only). */
  script: string;
  media: Media | null;
  screen: Screen | null;
}

export interface ScheduleItem {
  id: string;
  eventId: string;
  time: string;
  title: string;
  description: string;
  durationMinutes: number | null;
}

export interface DisplaySnapshot {
  eventId: string;
  eventName: string;
  eventDate: string;
  mode: DisplayMode;
  queueItemId: string | null;
  adHocMediaId: string | null;
  screenId: string | null;
  page: number;
  title: string | null;
  media: PublicMedia | null;
  range: { start: number; end: number } | null;
  screen: Screen | null;
  logo: PublicMedia | null;
  overlay: { media: PublicMedia | null; position: OverlayPosition; size: number; opacity: number; visible: boolean };
  /** Missing when talking to an older server. */
  blackScreen?: BlackScreenPrefs;
  version: number;
  serverNow: number;
}

export interface TimerSnapshot {
  eventId: string;
  durationMs: number;
  warningMs: number;
  status: TimerStatus;
  remainingMs: number;
  startedAt: number | null;
  /** When the countdown reached zero (server epoch ms), for the operator's overtime count. */
  finishedAt?: number | null;
  showOnDisplay: boolean;
  serverNow: number;
}

export interface Presence {
  eventId: string;
  displays: number;
  operators: number;
}

export interface UploadResult {
  uploaded: Media[];
  duplicates: Media[];
  rejected: { name: string; error: string }[];
  error?: string;
}

export type ControlCommand =
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'show-item'; queueItemId: string; page?: number }
  | { type: 'show-media'; mediaId: string; page?: number }
  | { type: 'show-current' }
  | { type: 'show-screen'; screenId?: string; key?: string; timerMs?: number }
  | { type: 'overlay'; visible?: boolean; mediaId?: string | null; position?: OverlayPosition; size?: number; opacity?: number }
  | { type: 'black' }
  | { type: 'waiting' }
  | { type: 'logo' }
  | { type: 'page'; page?: number; delta?: number }
  | { type: 'video'; action: 'play' | 'pause' | 'restart' }
  | { type: 'fullscreen' }
  | { type: 'timer-start' }
  | { type: 'timer-pause' }
  | { type: 'timer-toggle' }
  | { type: 'timer-reset' }
  | { type: 'timer-adjust'; deltaMs: number }
  | { type: 'timer-configure'; durationMs?: number; warningMs?: number; showOnDisplay?: boolean };

export interface AuthStatus {
  provider: 'local' | 'supabase' | 'none';
  enabled: boolean;
  configured: boolean;
  authenticated: boolean;
  user: string | null;
  /** "Continue with Google" is available on the sign-in page. */
  google?: boolean;
  /** The signed-in account (accounts mode). demoEndsAt: a "Try the demo" guest, deleted then. */
  account?: { email: string; name: string; plan: string; demoEndsAt?: number; admin?: boolean; pendingRequests?: number } | null;
  /** "Try the demo" is offered on the sign-in page (and at /demo), lasting demoMinutes. */
  demo?: boolean;
  demoMinutes?: number;
  /** "Request access" on the sign-in page; verify: a code is emailed to confirm the address. */
  access?: { verify: boolean } | null;
}

/** Someone with an account, or asking for one (administrator's People list). */
export interface Person {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'pending';
  emailVerified: boolean;
  /** Asked for access but hasn't entered the emailed code yet. */
  awaitingCode: boolean;
  requestedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  events: number;
}

export interface Account {
  id: string;
  email: string;
  name: string;
  plan: string;
  createdAt: string;
  preferences: Record<string, unknown>;
}

export interface GoogleAccount {
  email: string;
  name: string;
  picture: string | null;
  scopes: string[];
  connectedAt: number;
}

export interface GoogleStatus {
  /** The server has a Google OAuth client configured. */
  configured: boolean;
  connected: boolean;
  account: GoogleAccount | null;
  /** The connection includes read access to Drive. */
  drive: boolean;
  signInEnabled: boolean;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  kind: 'folder' | 'presentation' | 'slides' | 'pdf';
  size: number | null;
  modifiedTime: string | null;
  thumbnailLink: string | null;
  iconLink: string | null;
}

export interface SystemStatus {
  server: { ok: boolean; time: number };
  storage: { provider: string; ok: boolean; message: string; pending: number; errors: number };
  conversion: { available: boolean; queued: number };
  auth: { provider: string };
  /** "Open in PowerPoint" is possible (this browser runs on the server machine). */
  openExternally?: boolean;
  /** Free/total bytes on the drive holding the uploads (null if unknown). */
  disk?: { free: number; total: number } | null;
}
