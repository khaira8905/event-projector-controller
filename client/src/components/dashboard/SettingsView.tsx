import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../AuthGate';
import { useToast } from '../ui/Toast';
import { PeopleModal } from '../PeopleModal';

/** Signed in with an account: "this computer" settings are saved to the account instead. */
const SyncedCtx = createContext(false);
import {
  Check,
  ExternalLink,
  FolderOpen,
  HardDriveUpload,
  ImagePlus,
  Keyboard,
  Link2,
  Loader2,
  LogOut,
  Maximize,
  MonitorPlay,
  Paintbrush,
  Pencil,
  Presentation,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { Segmented } from '../ui/Segmented';
import { ThemePicker } from '../ThemeSwitcher';
import { DriveIcon } from '../DriveIcon';
import { BlackScene } from '../display/BlackScene';
import { ShortcutEditor } from './ShortcutEditor';
import { resolveQuickItems } from './QuickSelection';
import { ACCEPTED_FILE_TYPES, api } from '../../services/api';
import { useShortcutBindings, useUiPrefs } from '../../lib/uiPrefs';
import { cn } from '../../lib/cn';
import { DEFAULT_BLACK_SCREEN, type BlackScreenPrefs, type EventPreferences, type EventSummary, type GoogleStatus, type Media, type PreferencesPatch, type Screen } from '../../types';

export type SettingsSection = 'presentation' | 'display' | 'controls' | 'files' | 'appearance' | 'event';

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon; blurb: string; parts: string[] }[] = [
  { id: 'presentation', label: 'Presentation', icon: Presentation, blurb: 'How decks open, how the Flow behaves and your Quick Selection.', parts: ['Behaviour', 'Flow', 'Quick Selection'] },
  { id: 'display', label: 'Display', icon: MonitorPlay, blurb: 'What the audience sees: your logo, Black Screen and the projector window.', parts: ['Logo', 'Black Screen', 'Preview', 'Projector'] },
  { id: 'controls', label: 'Controls', icon: Keyboard, blurb: 'Keyboard shortcuts, mouse control and hints on this computer.', parts: ['Keyboard', 'Mouse & hints'] },
  { id: 'files', label: 'Files & integrations', icon: FolderOpen, blurb: 'Where presentations come from, and connected accounts.', parts: ['This computer', 'Google Drive', 'Accounts'] },
  { id: 'appearance', label: 'Appearance', icon: Paintbrush, blurb: 'Theme, animation and presenter mode on this computer.', parts: ['Interface', 'Animations'] },
  { id: 'event', label: 'Account & sharing', icon: Users, blurb: 'Your account, this event’s details and who can open it.', parts: ['Account', 'Details', 'Sharing'] },
];

export const isSettingsSection = (v: string | null): v is SettingsSection => SECTIONS.some((s) => s.id === v);

interface SettingsViewProps {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  event: EventSummary | null;
  media: Media[];
  screens: Screen[];
  google: GoogleStatus | null;
  /** No password: anyone with the link can open the console. */
  openAccess: boolean;
  /** The signed-in account (accounts mode). */
  account: { email: string; name: string; plan: string; admin?: boolean; pendingRequests?: number; awaitingCode?: number; showcaseEventId?: string | null } | null;
  signedIn: boolean;
  displayUrl: string;
  consoleUrl: string;
  uploadProgress: number | null;
  onPreferences: (patch: PreferencesPatch) => Promise<void>;
  onCustomizeQuick: () => void;
  onUpload: (files: File[]) => void;
  onUploadLogo: (file: File) => Promise<void>;
  onSetLogo: (mediaId: string | null) => Promise<void>;
  onManageFiles: () => void;
  onOverlay: () => void;
  onBrowseDrive: () => void;
  onDisconnectGoogle: () => Promise<void>;
  onEditEvent: () => void;
  onOpenDisplay: () => void;
  onFullscreen: () => void;
  onSignOut: () => void;
  onCopied: (what: string) => void;
}

/**
 * Settings, grouped the way an operator thinks: the presentation, what the audience sees,
 * how the console is controlled, where files come from, and how the console looks.
 * Everything saves as it changes. Event settings travel with the event; the rest stays
 * on this computer (and says so).
 */
export function SettingsView(props: SettingsViewProps) {
  const { section, onSection } = props;
  const current = SECTIONS.find((s) => s.id === section)!;
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const savedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  // Event settings change optimistically: the switch moves at once, the server follows.
  const [draft, setDraft] = useState<EventPreferences | null>(props.event?.preferences ?? null);
  useEffect(() => setDraft(props.event?.preferences ?? null), [props.event?.preferences]);
  const savePrefs = (patch: PreferencesPatch) => {
    setDraft((d) => (d ? { ...d, ...patch, blackScreen: { ...d.blackScreen, ...patch.blackScreen }, presentation: { ...d.presentation, ...patch.presentation } } : d));
    setSaved('saving');
    window.clearTimeout(savedTimer.current);
    props.onPreferences(patch).then(
      () => {
        setSaved('saved');
        savedTimer.current = window.setTimeout(() => setSaved('idle'), 1600);
      },
      () => {
        setSaved('idle');
        setDraft(props.event?.preferences ?? null);
      },
    );
  };

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Settings" className="lg:sticky lg:top-0 lg:self-start">
        <ul className="ec-settings-nav scroll-thin flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <li key={s.id} className="shrink-0">
                <button onClick={() => onSection(s.id)} aria-current={active ? 'page' : undefined} className="ec-settings-nav-item group flex w-full items-center gap-2.5 rounded-[5px] px-3 py-2 text-left text-sm">
                  <s.icon size={16} className="shrink-0 transition-transform duration-200 group-hover:translate-x-px" />
                  <span className="whitespace-nowrap">{s.label}</span>
                </button>
                {active && (
                  <ul className="ec-settings-parts max-lg:hidden">
                    {partsFor(s.id, s.parts, props).map((p) => (
                      <li key={p}>
                        <a href={`#set-${slug(p)}`} className="block py-1 pl-9 text-[13px] text-slate-400 transition-colors hover:text-white">
                          {p}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <SyncedCtx.Provider value={!!props.account}>
      <div key={section} className="ec-section-in min-w-0">
        <header className="mb-6 flex items-start gap-4 border-b ec-line pb-5">
          <div className="min-w-0 flex-1">
            <h2 className="t-page">{current.label}</h2>
            <p className="mt-1 text-sm text-slate-500">{current.blurb}</p>
          </div>
          <SaveState state={saved} />
        </header>

        {section === 'presentation' && <PresentationSection {...props} prefs={draft} save={savePrefs} />}
        {section === 'display' && <DisplaySection {...props} prefs={draft} save={savePrefs} />}
        {section === 'controls' && <ControlsSection />}
        {section === 'files' && <FilesSection {...props} />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'event' && <EventSection {...props} />}
      </div>
      </SyncedCtx.Provider>
    </div>
  );
}

type SectionProps = SettingsViewProps & { prefs: EventPreferences | null; save: (patch: PreferencesPatch) => void };

// ── Presentation ───────────────────────────────────────────────────────────────

function PresentationSection({ prefs, save, media, screens, onCustomizeQuick }: SectionProps) {
  const { prefs: ui, set: setUi } = useUiPrefs();
  const decks = media.filter((m) => (m.kind === 'presentation' || m.kind === 'pdf') && !m.missing);
  const defaultDeck = decks.find((m) => m.id === prefs?.defaultMediaId) ?? null;
  const quick = prefs ? resolveQuickItems(prefs.quickSelection, screens, media, null) : [];

  return (
    <>
      <Block id="behaviour" title="Behaviour" scope="event">
        <Row label="Start with" hint="What Start (S) shows when nothing from the Flow is on screen yet.">
          <select value={prefs?.defaultMediaId ?? ''} onChange={(e) => save({ defaultMediaId: e.target.value || null })} className="ec-input h-9 w-full max-w-sm px-2.5">
            <option value="">The first item in the Flow</option>
            {decks.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
        <Collapse open={!!defaultDeck}>
          <Row label="…at slide" hint={defaultDeck?.pageCount ? `1 to ${defaultDeck.pageCount}` : undefined}>
            <input
              type="number"
              min={1}
              max={defaultDeck?.pageCount ?? 9999}
              value={prefs?.defaultStartPage ?? ''}
              placeholder="1"
              onChange={(e) => save({ defaultStartPage: e.target.value === '' ? null : Math.max(1, Math.min(defaultDeck?.pageCount ?? 9999, Math.round(Number(e.target.value)) || 1)) })}
              className="ec-input h-9 w-24 px-2.5 tabular-nums"
            />
          </Row>
        </Collapse>
        <Row label="Reopening a presentation" hint="When you go back to a deck you already showed.">
          <Choice
            value={prefs?.presentation.startAt ?? 'first'}
            onChange={(v) => save({ presentation: { startAt: v } })}
            options={[
              { value: 'first', label: 'Start at the first slide' },
              { value: 'last', label: 'Continue where it was left' },
            ]}
          />
        </Row>
        <Row label="Show items as soon as they are clicked" hint="Off: a click selects, a double-click or Enter shows it. Safer on a touchpad." local>
          <Toggle label="Show items as soon as they are clicked" checked={ui.flowActivation === 'click'} onChange={(v) => setUi({ flowActivation: v ? 'click' : 'double' })} />
        </Row>
        <Row label="Ask before switching presentations" hint="Only when the current deck is part-way through.">
          <Toggle label="Ask before switching presentations" checked={prefs?.presentation.confirmSwitch ?? false} onChange={(v) => save({ presentation: { confirmSwitch: v } })} />
        </Row>
      </Block>

      <Block id="flow" title="Flow" scope="local">
        <Row label="Control view" hint="Script layout puts a large script of the item on screen on the left, with Quick Selection under it, and moves the Flow to the right.">
          <Choice
            value={ui.controlLayout}
            onChange={(v) => setUi({ controlLayout: v })}
            options={[
              { value: 'flow', label: 'Flow first' },
              { value: 'script', label: 'Script first' },
            ]}
          />
        </Row>
        <Row label="Layout">
          <Choice
            value={ui.flowLayout}
            onChange={(v) => setUi({ flowLayout: v })}
            options={[
              { value: 'detailed', label: 'Detailed' },
              { value: 'compact', label: 'Compact list' },
            ]}
          />
        </Row>
        <Row label="Follow the item on screen" hint="The Flow scrolls so the current item stays in view.">
          <Toggle label="Follow the item on screen" checked={ui.followLive} onChange={(v) => setUi({ followLive: v })} />
        </Row>
        <Row label="Slides under the item on screen" hint="Click a slide to jump to it.">
          <Toggle label="Slides under the item on screen" checked={ui.showSlides} onChange={(v) => setUi({ showSlides: v })} />
        </Row>
        <Collapse open={ui.showSlides}>
          <Row label="Slide size">
            <Choice
              value={ui.thumbSize}
              onChange={(v) => setUi({ thumbSize: v })}
              options={[
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
              ]}
            />
          </Row>
        </Collapse>
      </Block>

      <Block id="quick-selection" title="Quick Selection" scope="event" note="The buttons under the picture. Keys 1–8 press them in order.">
        <div className="flex flex-wrap items-center gap-2 py-3">
          {quick.map((q, i) => (
            <span key={q.item.id} className="ec-chip inline-flex items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-sm text-slate-200">
              <span className="font-mono text-[11px] text-slate-500">{i + 1}</span>
              <span className="text-slate-400">{q.icon}</span>
              {q.label}
            </span>
          ))}
          {quick.length === 0 && <span className="text-sm text-slate-500">No buttons yet.</span>}
          <Button size="sm" icon={<Pencil size={13} />} onClick={onCustomizeQuick} className="ml-auto">
            Customize…
          </Button>
        </div>
      </Block>
    </>
  );
}

// ── Display ────────────────────────────────────────────────────────────────────

function DisplaySection({ prefs, save, event, media, displayUrl, onUploadLogo, onSetLogo, onOverlay, onOpenDisplay, onFullscreen, onCopied }: SectionProps) {
  const { prefs: ui, set: setUi } = useUiPrefs();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const black = prefs?.blackScreen ?? DEFAULT_BLACK_SCREEN;
  const setBlack = (patch: Partial<BlackScreenPrefs>) => save({ blackScreen: patch });
  const images = media.filter((m) => m.kind === 'image' && !m.missing);
  const logo = images.find((m) => m.id === event?.logoMediaId) ?? null;
  const [status, setStatus] = useState(black.statusText);
  useEffect(() => setStatus(black.statusText), [black.statusText]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await onUploadLogo(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Block id="logo" title="Logo" scope="event" note="Used on Black Screen (if you turn it on), the logo screen and the special screens.">
        <div className="flex flex-wrap items-center gap-5 py-4">
          <div className="ec-logo-well flex h-[108px] w-[192px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] p-3">
            {busy ? (
              <Loader2 size={20} className="animate-spin text-[#fff]/50" />
            ) : logo ? (
              <img key={logo.id} src={logo.url} alt="" className="ec-fade-in max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-center text-[12px] text-[#fff]/40">No logo yet</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-200">{logo ? logo.name : 'Upload your logo'}</p>
            <p className="mt-0.5 text-[13px] text-slate-500">PNG with a transparent background looks best. It is never stretched.</p>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void pick(file);
              }}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant={logo ? 'secondary' : 'primary'} icon={<ImagePlus size={14} />} onClick={() => input.current?.click()} disabled={busy}>
                {logo ? 'Replace…' : 'Upload logo…'}
              </Button>
              {images.length > (logo ? 1 : 0) && (
                <select value="" onChange={(e) => e.target.value && void onSetLogo(e.target.value)} className="ec-input h-8 w-full max-w-[13rem] min-w-0 px-2 text-[13px] max-sm:max-w-full" aria-label="Use an image from Files">
                  <option value="">Use an image from Files…</option>
                  {images
                    .filter((m) => m.id !== logo?.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              )}
              {logo && (
                <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => void onSetLogo(null)} className="hover:!text-red-400">
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
        <Row label="Logo overlay on slides" hint="A small logo in a corner, on top of the slides.">
          <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={onOverlay}>
            Open Branding
          </Button>
        </Row>
      </Block>

      <Block id="black-screen" title="Black Screen" scope="event" note="Set it up once; during the show it is one button (or B).">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <Row label="Offer Black Screen" hint="Off hides the button and ignores the shortcut.">
              <Toggle label="Offer Black Screen" checked={black.enabled} onChange={(v) => setBlack({ enabled: v })} />
            </Row>
            <Collapse open={black.enabled}>
              <Row label="Two clicks to go black" hint="Prevents going black by accident. The shortcut always acts at once.">
                <Toggle label="Two clicks to go black" checked={prefs?.confirmBlack ?? true} onChange={(v) => save({ confirmBlack: v })} />
              </Row>
              <Row label="Show the logo" hint={logo ? 'Instead of pure black.' : 'Upload a logo above first.'}>
                <Toggle label="Show the logo" checked={black.showLogo} onChange={(v) => setBlack({ showLogo: v })} disabled={!logo && !black.showLogo} />
              </Row>
              <Collapse open={black.showLogo}>
                <Row label="Logo size">
                  <Choice
                    value={black.logoSize}
                    onChange={(v) => setBlack({ logoSize: v })}
                    options={[
                      { value: 'small', label: 'Small' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'large', label: 'Large' },
                    ]}
                  />
                </Row>
                <Row label="Position">
                  <Choice
                    value={black.logoPosition}
                    onChange={(v) => setBlack({ logoPosition: v })}
                    options={[
                      { value: 'center', label: 'Centre' },
                      { value: 'lower', label: 'Lower third' },
                      { value: 'corner', label: 'Corner' },
                    ]}
                  />
                </Row>
                <Row label="Gentle entrance" hint="The logo fades in once, then stays still.">
                  <Toggle label="Gentle entrance" checked={black.animateLogo} onChange={(v) => setBlack({ animateLogo: v })} />
                </Row>
              </Collapse>
              <Row label="Status text" hint="Optional and small, e.g. “We’ll be right back”.">
                <input
                  value={status}
                  maxLength={80}
                  placeholder="None"
                  onChange={(e) => setStatus(e.target.value)}
                  onBlur={() => status !== black.statusText && setBlack({ statusText: status })}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="ec-input h-9 w-full max-w-xs px-2.5"
                  aria-label="Status text"
                />
              </Row>
              <Row label="Transition">
                <Choice
                  value={black.fade ? 'fade' : 'cut'}
                  onChange={(v) => setBlack({ fade: v === 'fade' })}
                  options={[
                    { value: 'fade', label: 'Fade' },
                    { value: 'cut', label: 'Instant cut' },
                  ]}
                />
              </Row>
              <Row label="Next while black" hint="What Next and Previous do while the screen is black.">
                <Choice
                  value={black.resume}
                  onChange={(v) => setBlack({ resume: v })}
                  options={[
                    { value: 'same', label: 'Bring back the same slide' },
                    { value: 'advance', label: 'Move on' },
                  ]}
                />
              </Row>
            </Collapse>
          </div>
          <figure className="pt-3 xl:sticky xl:top-2 xl:self-start">
            <div className="ec-monitor relative aspect-video w-full">
              <div className="absolute inset-0 overflow-hidden rounded-[6px] bg-black" style={{ containerType: 'size' }}>
                <BlackScene
                  // Remount on change so the entrance plays again as a preview.
                  key={`${black.showLogo}-${black.logoSize}-${black.logoPosition}-${black.animateLogo}-${status}`}
                  settings={{ ...black, statusText: status }}
                  logo={logo ? { id: logo.id, name: logo.name, kind: logo.kind, mimeType: logo.mimeType, url: logo.url, pdfUrl: null, pageCount: null, missing: false } : null}
                />
              </div>
            </div>
            <figcaption className="mt-2 text-[12px] text-slate-500">{black.enabled ? 'Preview: the projector on Black Screen.' : 'Black Screen is off for this event.'}</figcaption>
          </figure>
        </div>
      </Block>

      <Block id="preview" title="Preview" scope="local">
        <Row label="Projector picture" hint="The live picture of what the audience sees, in the Control view.">
          <Toggle label="Projector picture" checked={ui.showPreview} onChange={(v) => setUi({ showPreview: v })} />
        </Row>
      </Block>

      <Block id="projector" title="Projector" note="Open the display on the computer connected to the projector, then press F in it for fullscreen.">
        <div className="py-3">
          <CopyField value={displayUrl} label="Display link" onCopied={() => onCopied('Display link copied.')} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" icon={<MonitorPlay size={16} />} onClick={onOpenDisplay}>
              Open display window
            </Button>
            <Button icon={<Maximize size={15} />} onClick={onFullscreen}>
              Make it fullscreen
            </Button>
          </div>
        </div>
      </Block>
    </>
  );
}

// ── Controls ───────────────────────────────────────────────────────────────────

function ControlsSection() {
  const { prefs: ui, set: setUi } = useUiPrefs();
  const bindings = useShortcutBindings();
  return (
    <>
      <Block id="keyboard" title="Keyboard" scope="local">
        <Row label="Keyboard shortcuts" hint="Press ? in the console for the overview.">
          <Toggle label="Keyboard shortcuts" checked={ui.keyboard} onChange={(v) => setUi({ keyboard: v })} />
        </Row>
        <Collapse open={ui.keyboard}>
          <div className="pt-3 pb-4">
            <ShortcutEditor bindings={bindings} overrides={ui.shortcuts} onChange={(shortcuts) => setUi({ shortcuts })} />
          </div>
        </Collapse>
      </Block>

      <Block id="mouse-hints" title="Mouse & hints" scope="local">
        <Row label="Mouse on the picture" hint="Scroll over the projector picture to move through slides; click it for the next one.">
          <Toggle label="Mouse on the picture" checked={ui.mouseControls} onChange={(v) => setUi({ mouseControls: v })} />
        </Row>
        <Row label="Key hints on buttons" hint="The small B, Esc and 1–8 labels.">
          <Toggle label="Key hints on buttons" checked={ui.hints} onChange={(v) => setUi({ hints: v })} />
        </Row>
        <Row label="Compact controls" hint="Tighter rows and buttons; fits more on a small laptop.">
          <Toggle label="Compact controls" checked={ui.density === 'compact'} onChange={(v) => setUi({ density: v ? 'compact' : 'comfortable' })} />
        </Row>
      </Block>
    </>
  );
}

// ── Files & integrations ───────────────────────────────────────────────────────

function FilesSection({ media, google, account, openAccess, uploadProgress, onUpload, onManageFiles, onBrowseDrive, onDisconnectGoogle }: SettingsViewProps) {
  const input = useRef<HTMLInputElement>(null);
  const returnHere = `${window.location.pathname}?view=settings&section=files`;
  const state: 'checking' | 'unconfigured' | 'connected' | 'disconnected' = !google ? 'checking' : !google.configured ? 'unconfigured' : google.connected && google.drive ? 'connected' : 'disconnected';

  return (
    <>
      <Block id="this-computer" title="This computer" note="PowerPoint, PDF, images and video. Files are copied into the event, so the show runs without internet.">
        <div className="flex flex-wrap items-center gap-4 py-3">
          <span className="ec-source-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px]">
            <HardDriveUpload size={19} className="text-slate-300" />
          </span>
          <p className="min-w-0 flex-1 text-sm text-slate-300">
            {media.length} {media.length === 1 ? 'file' : 'files'} in this event
          </p>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPTED_FILE_TYPES}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) onUpload(files);
            }}
          />
          <Button size="sm" variant="ghost" onClick={onManageFiles}>
            Rename & organise
          </Button>
          <Button size="sm" onClick={() => input.current?.click()} disabled={uploadProgress !== null}>
            {uploadProgress !== null ? `Uploading ${Math.round(uploadProgress * 100)}%` : 'Upload files…'}
          </Button>
        </div>
      </Block>

      {account?.plan !== 'demo' && (
        <Block id="google-drive" title="Google Drive" note="Import PowerPoint, Google Slides and PDF files. You pick them in Google’s own window: EventControl only opens those files, never the rest of your Drive, and never changes anything.">
          <div className="flex flex-wrap items-center gap-4 py-3">
            <span className="ec-source-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px]">
              <DriveIcon size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <span className="ec-status-dot h-2 w-2 shrink-0 rounded-full" data-state={state} aria-hidden />
                {state === 'checking' ? 'Checking…' : state === 'unconfigured' ? 'Not set up on this server' : state === 'connected' ? `Connected as ${google!.account?.email}` : 'Not connected'}
              </p>
              <p className="mt-0.5 text-[13px] text-slate-500">
                {state === 'unconfigured'
                  ? 'The server owner adds a Google OAuth client once (README → Google Drive).'
                  : state === 'connected'
                    ? 'Browse your Drive from Files, or from Add in the Flow.'
                    : 'You’ll choose a Google account on Google’s page, then come straight back here.'}
              </p>
            </div>
            {state === 'checking' ? (
              <Loader2 size={16} className="animate-spin text-slate-500" />
            ) : state === 'unconfigured' ? (
              <a href="https://github.com/khaira8905/event-projector-controller#google-drive" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-300 hover:underline">
                How to set up <ExternalLink size={13} />
              </a>
            ) : state === 'connected' ? (
              <Button size="sm" variant="primary" onClick={onBrowseDrive}>
                Browse Drive
              </Button>
            ) : (
              <a href={api.googleConnectUrl(returnHere)} className="ec-btn ec-btn-primary inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[13px] font-semibold">
                <Link2 size={14} /> Connect Google Drive
              </a>
            )}
          </div>
        </Block>
      )}

      <Block id="accounts" title="Accounts" note={openAccess ? 'Connections belong to this browser. Other people who open the shared link don’t see your Drive.' : 'Connections are shared by everyone signed in to this EventControl.'}>
        {google?.connected && google.account ? (
          <div className="flex flex-wrap items-center gap-3 py-3">
            {google.account.picture ? (
              <img src={google.account.picture} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-console-600 text-sm font-semibold text-white">{google.account.name.slice(0, 1)}</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-200">{google.account.name}</p>
              <p className="truncate text-[13px] text-slate-500">Google · {google.account.email}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void onDisconnectGoogle()} className="hover:!text-red-400">
              Disconnect
            </Button>
          </div>
        ) : (
          <p className="py-3 text-sm text-slate-500">No accounts connected. You don’t need one to use EventControl.</p>
        )}
      </Block>
    </>
  );
}

// ── Appearance ─────────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { prefs: ui, set: setUi } = useUiPrefs();
  const systemReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <>
      <Block id="interface" title="Interface" scope="local">
        <Row label="Theme">
          <ThemePicker />
        </Row>
        <Row label="Presenter mode" hint="Only the Flow, the picture and the buttons (H toggles it).">
          <Toggle label="Presenter mode" checked={ui.presenterMode} onChange={(v) => setUi({ presenterMode: v })} />
        </Row>
      </Block>
      <Block id="animations" title="Animations" scope="local">
        <Row label="Console animations" hint={systemReduced ? 'Your system asks for reduced motion, so the console keeps movement minimal either way.' : 'The projector keeps its own transitions.'}>
          <Choice
            value={ui.motion}
            onChange={(v) => setUi({ motion: v })}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Row>
      </Block>
    </>
  );
}

// ── Event & sharing ────────────────────────────────────────────────────────────

function EventSection({ event, openAccess, account, signedIn, consoleUrl, displayUrl, onEditEvent, onSignOut, onCopied }: SettingsViewProps) {
  return (
    <>
      {account && (
        <Block id="account" title="Account" note="Your events, files and these settings belong to your account and follow you to any computer.">
          <div className="flex flex-wrap items-center gap-4 py-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[15px] font-semibold text-[#fff]">
              {(account.name || account.email).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-white">{account.name || account.email}</p>
              <p className="t-support truncate">{account.email}</p>
            </div>
            <span className="rounded-[3px] border border-[var(--line-strong)] px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase">{account.plan} plan</span>
            <Button size="sm" icon={<LogOut size={13} />} onClick={onSignOut}>
              Sign out
            </Button>
          </div>
          {account.plan !== 'demo' && <SignOutEverywhereRow />}
          {account.admin && <PeopleRow waiting={account.pendingRequests ?? 0} awaitingCode={account.awaitingCode ?? 0} />}
        </Block>
      )}
      {account?.admin && event && <ShowcaseBlock eventId={event.id} eventName={event.name} active={account.showcaseEventId === event.id} />}
      <Block id="details" title="Details" scope="event">
        <Row label={event?.name ?? 'Event'} hint={[event?.venue, event?.date].filter(Boolean).join(' · ') || 'No date or venue yet.'}>
          <Button size="sm" icon={<Pencil size={13} />} onClick={onEditEvent}>
            Edit details
          </Button>
        </Row>
      </Block>
      <Block
        id="sharing"
        title="Sharing"
        note={
          openAccess
            ? 'Anyone with the console link can open and run this event — no password or account needed. Share it with your crew only.'
            : account
              ? 'Only you can open and run this event. The projector link shows just the audience picture, so it’s safe to open on the venue computer.'
              : 'People need to sign in before they can run this event.'
        }
      >
        <div className="grid gap-4 py-3">
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-200">Console link</p>
            <CopyField value={consoleUrl} label="Console link" onCopied={() => onCopied('Console link copied.')} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-200">Projector link</p>
            <CopyField value={displayUrl} label="Projector link" onCopied={() => onCopied('Projector link copied.')} />
            <p className="mt-1.5 text-[12px] text-slate-500">Shows only the audience picture, so it’s safe to open on any screen.</p>
          </div>
        </div>
        {signedIn && !account && (
          <Row label="Operator session">
            <Button size="sm" icon={<LogOut size={13} />} onClick={onSignOut}>
              Sign out
            </Button>
          </Row>
        )}
      </Block>
    </>
  );
}

/** Ends this account's sign-ins on every other computer and phone; this one stays signed in. */
function SignOutEverywhereRow() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Row label="Other devices" hint="Signed in somewhere you shouldn’t be, like a venue computer? This signs out everywhere except here.">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.signOutEverywhere();
            toast.success('Signed out on every other device.');
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Couldn’t sign out the other devices.');
          } finally {
            setBusy(false);
          }
        }}
      >
        Sign out everywhere else
      </Button>
    </Row>
  );
}

/**
 * Administrator only: use this event for the public demo. Every visitor of /demo then gets
 * their own copy of it (files, Flow, scripts, screens, branding) instead of the sample.
 */
function ShowcaseBlock({ eventId, eventName, active }: { eventId: string; eventName: string; active: boolean }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const [on, setOn] = useState(active);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(active), [active]);
  return (
    <Block
      id="public-demo"
      title="Public demo"
      note="Visitors of the demo link each get a private copy of the showcase event. They can change their copy, never yours, and it’s deleted after the demo ends."
    >
      <Row label="Use this event as the demo" hint={on ? `Demo visitors get a copy of “${eventName}”.` : 'Off: visitors get the built-in sample event.'}>
        <Toggle
          label="Use this event as the demo"
          checked={on}
          disabled={busy}
          onChange={async (v) => {
            setOn(v);
            setBusy(true);
            try {
              await api.setShowcase(v ? eventId : null);
              await refresh();
              toast.success(v ? `The demo now shows “${eventName}”.` : 'The demo shows the sample event again.');
            } catch (err) {
              setOn(!v);
              toast.error(err instanceof Error ? err.message : 'Couldn’t change the demo event.');
            } finally {
              setBusy(false);
            }
          }}
        />
      </Row>
    </Block>
  );
}

/** Administrator only: requests to approve, and everyone with an account. */
function PeopleRow({ waiting, awaitingCode }: { waiting: number; awaitingCode: number }) {
  const [open, setOpen] = useState(false);
  const summary = [waiting ? `${waiting} to approve` : '', awaitingCode ? `${awaitingCode} waiting for their email code` : ''].filter(Boolean).join(' · ');
  return (
    <Row label="People" hint={summary ? `${summary}.` : 'Approve requests for access, and remove people.'}>
      <Button size="sm" variant={waiting ? 'primary' : 'secondary'} icon={<Users size={13} />} onClick={() => setOpen(true)}>
        {waiting ? `Review ${waiting}` : 'Manage'}
      </Button>
      <PeopleModal open={open} onClose={() => setOpen(false)} />
    </Row>
  );
}

/** The sub-links of a section: only the parts that are on the page for this person. */
function partsFor(section: SettingsSection, parts: string[], { account, event }: SettingsViewProps): string[] {
  if (section === 'event') {
    return [...(account ? ['Account'] : []), ...(account?.admin && event ? ['Public demo'] : []), 'Details', 'Sharing'];
  }
  if (section === 'files' && account?.plan === 'demo') return parts.filter((p) => p !== 'Google Drive');
  return parts;
}

// ── Building blocks ────────────────────────────────────────────────────────────

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A titled group of settings. `scope` says, once, where its settings are saved. */
function Block({ id, title, note, scope, children }: { id: string; title: string; note?: string; scope?: 'event' | 'local'; children: ReactNode }) {
  const synced = useContext(SyncedCtx);
  return (
    <section id={`set-${id}`} className="ec-settings-block mb-9 scroll-mt-4">
      <div className="flex items-baseline gap-3">
        <h3 className="t-section text-[16px]">{title}</h3>
        {scope && <span className="text-[11px] font-medium text-slate-500">{scope === 'event' ? 'Saved with this event' : synced ? 'Saved to your account' : 'This computer only'}</span>}
      </div>
      {note && <p className="mt-0.5 max-w-2xl text-[13px] text-slate-500">{note}</p>}
      <div className="ec-settings-list mt-2">{children}</div>
    </section>
  );
}

function Row({ label, hint, local, children }: { label: string; hint?: string; local?: boolean; children: ReactNode }) {
  const synced = useContext(SyncedCtx);
  return (
    <div className="ec-settings-row grid gap-2 py-3 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] sm:items-center sm:gap-8">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">
          {label}
          {local && !synced && <span className="ml-2 text-[11px] font-normal whitespace-nowrap text-slate-500">· this computer</span>}
        </p>
        {hint && <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{hint}</p>}
      </div>
      <div className="flex min-w-0 sm:justify-end">{children}</div>
    </div>
  );
}

/** Height-animated reveal for options that only matter when another option is on. */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="ec-collapse" data-open={open} aria-hidden={!open} inert={!open}>
      <div className="ec-collapse-inner">{children}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <span className={cn(disabled && 'pointer-events-none opacity-45')}>
      <Switch compact hideLabel label={label} checked={checked} onChange={onChange} />
    </span>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return <Segmented value={value} onChange={onChange} options={options} className="ec-choice w-fit max-w-full" />;
}

function CopyField({ value, label, onCopied }: { value: string; label: string; onCopied: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-xl overflow-hidden rounded-[5px] border border-[var(--line-strong)]">
      <input readOnly value={value} className="min-w-0 flex-1 bg-console-850 px-3 py-2 font-mono text-[13px] text-slate-300 focus:outline-none" onFocus={(e) => e.target.select()} aria-label={label} />
      <button
        className="flex items-center gap-1.5 border-l border-[var(--line-strong)] px-3 text-[13px] font-medium text-slate-200 transition-colors hover:bg-console-700"
        onClick={() =>
          void navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              onCopied();
              window.setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
          )
        }
      >
        {copied && <Check size={14} className="ec-pop text-emerald-400" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  return (
    <span className={cn('flex h-6 items-center gap-1.5 text-[12px] font-medium text-slate-500 transition-opacity duration-300', state === 'idle' && 'opacity-0')} role="status" aria-live="polite">
      {state === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} className="text-emerald-400" />}
      {state === 'saving' ? 'Saving' : 'Saved'}
    </span>
  );
}
