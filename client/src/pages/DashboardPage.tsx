import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, ListVideo, ScrollText, Cloud, CloudOff, LayoutGrid, Loader2, Maximize2, Minimize2, MonitorPlay, Palette, RefreshCw, WifiOff } from 'lucide-react';
import { EventFormModal } from '../components/EventFormModal';
import { useAuth } from '../components/AuthGate';
import { Sidebar, NAV, type DashboardView } from '../components/Sidebar';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { DriveIcon } from '../components/DriveIcon';
import { Button } from '../components/ui/Button';
import { Panel } from '../components/ui/Panel';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
import { FlowPane } from '../components/dashboard/FlowPane';
import { StagePane } from '../components/dashboard/StagePane';
import { ControlDeck } from '../components/dashboard/ControlDeck';
import { ScriptPane } from '../components/dashboard/ScriptPane';
import { DEFAULT_QUICK, QuickSelection, QuickSelectionEditor } from '../components/dashboard/QuickSelection';
import { TimerStrip } from '../components/dashboard/TimerStrip';
import { FilePicker } from '../components/dashboard/FilePicker';
import { DriveBrowser } from '../components/dashboard/DriveBrowser';
import { SettingsView, isSettingsSection } from '../components/dashboard/SettingsView';
import { FlowItemModal } from '../components/dashboard/FlowItemModal';
import { PresentationLibrary } from '../components/dashboard/PresentationLibrary';
import { PreviewModal } from '../components/dashboard/PreviewModal';
import { TimerPanel } from '../components/dashboard/TimerPanel';
import { ScreensPanel } from '../components/dashboard/ScreensPanel';
import { BrandingPanel } from '../components/dashboard/BrandingPanel';
import { SchedulePanel } from '../components/dashboard/SchedulePanel';
import { ShortcutsHelp } from '../components/dashboard/ShortcutsHelp';
import type { VideoCommand } from '../components/display/DisplayStage';
import { useEventData } from '../hooks/useEventData';
import { useEventSocket } from '../hooks/useEventSocket';
import { ClockOffsetContext } from '../hooks/useLiveRemaining';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { useShortcutBindings, useUiPrefs } from '../lib/uiPrefs';
import type { ShortcutAction } from '../lib/shortcuts';
import { ApiError, api } from '../services/api';
import { cn } from '../lib/cn';
import { itemLabel } from '../lib/flow';
import { DEFAULT_BLACK_SCREEN, type ControlCommand, type PreferencesPatch, type GoogleStatus, type Media, type QueueItem, type QuickItem, type UploadResult } from '../types';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** The open section lives in the URL (?view=…), so a refresh keeps you where you were. */
function useDashboardView(): [DashboardView, (v: DashboardView) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  // Older links: the separate Presentations / Media / Show Flow pages are now Files and Control.
  const legacy: Record<string, DashboardView> = { presentations: 'files', media: 'files', flow: 'control' };
  const view = NAV.some((n) => n.id === raw) ? (raw as DashboardView) : (legacy[raw ?? ''] ?? 'control');
  const set = useCallback(
    (v: DashboardView) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (v === 'control') next.delete('view');
          else next.set('view', v);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [view, set];
}

export default function DashboardPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { status: auth, signOut } = useAuth();
  const data = useEventData(eventId);
  const { event, media, queue: flow, schedule, screens, setQueue } = data;
  const { status: system, reachable } = useSystemStatus();
  const { prefs: ui, set: setUi } = useUiPrefs();

  const [videoCommand, setVideoCommand] = useState<VideoCommand | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<QueueItem | null>(null);
  const [previewing, setPreviewing] = useState<Media | null>(null);
  const [deletingMedia, setDeletingMedia] = useState<Media | null>(null);
  const [editEventOpen, setEditEventOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quickEditorOpen, setQuickEditorOpen] = useState(false);
  /** Where Drive imports go: straight into the Flow (from "Add"), or just into the library. */
  const [driveTarget, setDriveTarget] = useState<'flow' | 'library' | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  /** Asked before leaving a deck mid-way (Settings → Presentation behaviour). */
  const [switchTo, setSwitchTo] = useState<QueueItem | null>(null);
  const [flowFocus, setFlowFocus] = useState(0);
  const bindings = useShortcutBindings();
  const [view, setView] = useDashboardView();
  const [params, setParams] = useSearchParams();
  const sectionParam = params.get('section');
  const settingsSection = isSettingsSection(sectionParam) ? sectionParam : 'presentation';
  const videoNonce = useRef(0);
  const jumpRef = useRef<HTMLInputElement>(null);

  const quiet = useCallback(<T,>(p: Promise<T>) => p.catch(() => undefined), []);

  const { connected, joined, joinError, display, timer, presence, clockOffset, send } = useEventSocket(eventId, 'operator', {
    onQueueChanged: () => void quiet(data.reloadQueue()),
    onMediaChanged: () => void quiet(Promise.all([data.reloadMedia(), data.reloadQueue()])),
    onScheduleChanged: () => void quiet(data.reloadSchedule()),
    onScreensChanged: () => void quiet(Promise.all([data.reloadScreens(), data.reloadQueue()])),
    onEventChanged: () => void quiet(data.reloadEvent()),
    // Back after a disconnect or a sleeping tab: whatever changed meanwhile was missed.
    onResync: () => void quiet(data.reloadAll()),
    onEventDeleted: () => {
      toast.warning('This event was deleted in another window.');
      navigate('/');
    },
    onFullscreenResult: (ok) =>
      ok ? toast.success('The projector is now fullscreen.') : toast.warning('The projector window blocked fullscreen. Click once inside it, or press F there.'),
  });

  /** Sends a control command and surfaces any error as a toast. */
  const run = useCallback(
    async (command: ControlCommand) => {
      const res = await send(command);
      if (!res.ok) toast.error(res.error);
      return res.ok;
    },
    [send, toast],
  );

  useEffect(() => {
    if (event) document.title = `${event.name} · EventControl`;
  }, [event]);

  // Warn the operator when the projector drops off.
  const previousDisplays = useRef<number | null>(null);
  useEffect(() => {
    if (!presence) return;
    const prev = previousDisplays.current;
    if (prev !== null && prev > 0 && presence.displays === 0) toast.error('The projector window disconnected. Check its Wi-Fi, or open the display window again.');
    if (prev === 0 && presence.displays > 0) toast.success('Projector connected.');
    previousDisplays.current = presence.displays;
  }, [presence, toast]);

  // ---- Google account ----------------------------------------------------------------
  const refreshGoogle = useCallback(() => void api.googleStatus().then(setGoogle, () => undefined), []);
  useEffect(refreshGoogle, [refreshGoogle]);
  // Back from Google's consent screen: say what happened, then tidy the address bar.
  useEffect(() => {
    const result = params.get('google');
    if (!result) return;
    if (result === 'connected') toast.success('Google Drive connected. You can now import presentations from it.');
    else if (result === 'cancelled') toast.info('Google Drive wasn’t connected: access was not granted.');
    else toast.error(params.get('message') ?? 'Connecting Google didn’t work. Please try again.');
    if (result === 'connected' && params.get('drive') === 'open') setDriveTarget('library');
    refreshGoogle();
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        ['google', 'message', 'drive'].forEach((k) => next.delete(k));
        return next;
      },
      { replace: true },
    );
  }, [params, setParams, toast, refreshGoogle]);

  // ---- What is on screen ---------------------------------------------------------------
  const currentIndex = display?.queueItemId ? flow.findIndex((q) => q.id === display.queueItemId) : -1;
  const currentItem = currentIndex >= 0 ? flow[currentIndex] : null;
  const nextItem = currentIndex === -1 ? (flow[0] ?? null) : (flow[currentIndex + 1] ?? null);
  // The Flow item itself is on screen (not black, a quick screen or a file from the library).
  const showingFlowItem =
    !!currentItem &&
    !!display &&
    ((display.mode === 'media' && !display.adHocMediaId && currentItem.kind === 'media') ||
      (display.mode === 'screen' && currentItem.kind === 'screen' && display.screenId === currentItem.screenId));
  const offFlow = !!currentItem && !!display && !showingFlowItem;
  const isLive = (presence?.displays ?? 0) > 0;
  const flowMediaIds = useMemo(() => new Set(flow.map((q) => q.mediaId).filter((id): id is string => !!id)), [flow]);
  const images = useMemo(() => media.filter((m) => m.kind === 'image'), [media]);
  const cloudEnabled = !!system && system.storage.provider !== 'local';
  const atEnd = !!currentItem && currentIndex === flow.length - 1 && (!display?.range || display.page >= display.range.end) && !display?.adHocMediaId;
  const prefs = event?.preferences ?? null;
  const blackPrefs = prefs?.blackScreen ?? DEFAULT_BLACK_SCREEN;
  const blackOn = display?.mode === 'black';
  // What the Quick Selection buttons (and their 1–8 keys) point at, in order.
  const quickItems = useMemo(
    () => (prefs?.quickSelection ?? DEFAULT_QUICK).filter((q) => !(blackPrefs.enabled === false && q.kind === 'black')),
    [prefs?.quickSelection, blackPrefs.enabled],
  );

  // "Start": nothing from the Flow has been on screen yet.
  const defaultDeck = prefs?.defaultMediaId ? media.find((m) => m.id === prefs.defaultMediaId && !m.missing) : undefined;
  const startLabel = !currentItem && (defaultDeck || flow.length) ? `Start: ${defaultDeck ? defaultDeck.name : itemLabel(flow[0])}` : null;
  const start = () => {
    if (defaultDeck) {
      const inFlow = flow.find((q) => q.mediaId === defaultDeck.id);
      const page = prefs?.defaultStartPage ?? undefined;
      void run(inFlow ? { type: 'show-item', queueItemId: inFlow.id, page } : { type: 'show-media', mediaId: defaultDeck.id, page });
    } else if (flow[0]) void run({ type: 'show-item', queueItemId: flow[0].id });
  };

  const videoAction = (action: VideoCommand['action']) => {
    setVideoCommand({ action, nonce: ++videoNonce.current });
    void run({ type: 'video', action });
  };

  const openDisplayWindow = () => {
    if (!eventId) return;
    const win = window.open(`/display/${eventId}`, `eventcontrol-display-${eventId}`, 'popup,width=1280,height=720');
    if (!win) toast.warning('The browser blocked the pop-up. Allow pop-ups for this site, or copy the display link from Settings → Projector.');
  };

  /** Black Screen is a toggle: pressing it again brings the picture back. */
  const toggleBlack = () => {
    if (!blackPrefs.enabled) return toast.info('Black Screen is turned off for this event (Settings → Display).');
    void run(blackOn ? { type: 'show-current' } : { type: 'black' });
  };

  /** Shows a Flow item, asking first when that would leave a presentation half-way. */
  const showItem = (item: QueueItem) => {
    const media = display?.mode === 'media' ? display.media : null;
    const midDeck = showingFlowItem && item.id !== currentItem?.id && !!media?.pageCount && !!display?.range && display.page > display.range.start && display.page < display.range.end;
    if (prefs?.presentation?.confirmSwitch && midDeck) return setSwitchTo(item);
    void run({ type: 'show-item', queueItemId: item.id });
  };

  const toggleOverlay = () => {
    if (!event?.overlay.mediaId) return toast.info('Choose an overlay logo in Branding first.');
    void run({ type: 'overlay', visible: !event.overlay.visible });
  };

  const triggerQuick = (item: QuickItem) => {
    switch (item.kind) {
      case 'screen':
        return void run(item.screenId ? { type: 'show-screen', screenId: item.screenId } : { type: 'show-screen', key: item.screenKey as 'please-wait' });
      case 'media':
        return item.mediaId && void run({ type: 'show-media', mediaId: item.mediaId, page: item.page });
      case 'black':
        return toggleBlack();
      case 'logo':
        return void run({ type: 'logo' });
      case 'current':
        return void run({ type: 'show-current' });
    }
  };

  const savePreferences = async (patch: PreferencesPatch) => {
    if (!eventId) return;
    try {
      await api.updatePreferences(eventId, patch);
      await data.reloadEvent();
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t save the setting. Check the connection and try again.'));
      throw err;
    }
  };

  const quickHandlers = Object.fromEntries(
    quickItems.slice(0, 8).map((q, i) => [`quick${i + 1}` as ShortcutAction, () => triggerQuick(q)]),
  );
  useKeyboardShortcuts(
    bindings,
    {
      next: () => void run({ type: 'next' }),
      previous: () => void run({ type: 'previous' }),
      start: () => (startLabel ? start() : void run({ type: 'show-current' })),
      resume: () => void run({ type: 'show-current' }),
      exit: () => void run({ type: 'logo' }),
      black: toggleBlack,
      goToSlide: () => jumpRef.current?.focus(),
      openFlow: () => setView('control'),
      selectPresentation: () => {
        setView('control');
        setFlowFocus((n) => n + 1);
      },
      toggleControls: () => setUi({ presenterMode: !ui.presenterMode }),
      fullscreen: () => void run({ type: 'fullscreen' }),
      pleaseWait: () => void run({ type: 'show-screen', key: 'please-wait' }),
      technical: () => void run({ type: 'show-screen', key: 'technical' }),
      overlay: toggleOverlay,
      timerToggle: () => void run({ type: 'timer-toggle' }),
      timerReset: () => void run({ type: 'timer-reset' }),
      help: () => setHelpOpen(true),
      ...quickHandlers,
    },
    !!eventId && ui.keyboard,
  );

  // ---- Files & Flow ------------------------------------------------------------------

  /** One place that turns an upload/import result into clear messages. */
  const reportFiles = (result: UploadResult, verb: 'Uploaded' | 'Imported') => {
    const n = result.uploaded.length;
    if (n) toast.success(n === 1 ? `${verb} “${result.uploaded[0].name}”.` : `${verb} ${n} files.`);
    if (result.uploaded.some((m) => m.kind === 'presentation')) toast.info('Turning the PowerPoint into slides in the background — usually under a minute.');
    if (result.duplicates.length) toast.info(`${result.duplicates.map((d) => `“${d.name}”`).join(', ')} ${result.duplicates.length === 1 ? 'is' : 'are'} already in this event — kept the existing copy.`);
    result.rejected.forEach((r) => toast.error(`${r.name}: ${r.error}`));
  };

  const upload = async (files: File[], folder = ''): Promise<UploadResult | null> => {
    if (!eventId) return null;
    setUploadProgress(0);
    try {
      const result = await api.uploadMedia(eventId, files, setUploadProgress, folder);
      reportFiles(result, 'Uploaded');
      await data.reloadMedia();
      return result;
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 0 ? 'The upload couldn’t reach the EventControl server. Check the connection and try again.' : errorMessage(err, 'The upload failed. Please try again.'));
      return null;
    } finally {
      setUploadProgress(null);
    }
  };

  const addToFlow = async (items: Media[], startPage: number | null = null, endPage: number | null = null) => {
    if (!eventId || !items.length) return;
    try {
      for (const m of items) await api.addToQueue(eventId, m.id, { startPage, endPage });
      await data.reloadQueue();
      toast.success(items.length === 1 ? `Added “${items[0].name}” to the Flow.` : `Added ${items.length} files to the Flow.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t add to the Flow. Please try again.'));
    }
  };

  const importFromDrive = async (fileIds: string[]) => {
    if (!eventId) return;
    try {
      const result = await api.importFromDrive(eventId, fileIds);
      reportFiles(result, 'Imported');
      await data.reloadMedia();
      if (driveTarget === 'flow') await addToFlow([...result.uploaded, ...result.duplicates]);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'GOOGLE_RECONNECT') refreshGoogle();
      toast.error(errorMessage(err, 'The import from Google Drive failed. Please try again.'));
      throw err;
    }
  };

  const reorder = async (next: QueueItem[]) => {
    if (!eventId) return;
    setQueue(next); // optimistic
    try {
      setQueue(await api.reorderQueue(eventId, next.map((q) => q.id)));
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t save the new order. It has been put back.'));
      await quiet(data.reloadQueue());
    }
  };

  const removeFromFlow = async (item: QueueItem) => {
    try {
      await api.deleteQueueItem(item.id);
      // Drop it locally at once (the row has already folded away), then confirm with the server.
      setQueue(flow.filter((q) => q.id !== item.id));
      void quiet(data.reloadQueue());
      toast.info(`Removed “${itemLabel(item)}” from the Flow. The file is still in Files.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t remove the item. Please try again.'));
    }
  };

  const openMedia = async (m: Media) => {
    if (m.kind !== 'presentation') {
      window.open(m.url, '_blank', 'noopener');
      return;
    }
    // PowerPoint can only open on the computer running EventControl; elsewhere, download it.
    if (!system?.openExternally) {
      window.open(`${m.url}?download=1`, '_blank', 'noopener');
      return;
    }
    try {
      await api.openMediaExternally(m.id);
      toast.success(`Opening “${m.name}” in PowerPoint on the EventControl computer…`);
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t open PowerPoint here, so the file is downloading instead.'));
      window.open(`${m.url}?download=1`, '_blank', 'noopener');
    }
  };

  const setEventField = async (patch: Parameters<typeof api.updateEvent>[1], message: string) => {
    if (!eventId) return;
    try {
      await api.updateEvent(eventId, patch);
      await data.reloadEvent();
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err, 'Couldn’t update the event.'));
    }
  };

  // ---- Fatal states ------------------------------------------------------------------

  if (joinError || (data.error && !event)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold text-white">{joinError ? 'This event no longer exists' : 'The event couldn’t be loaded'}</h1>
        <p className="max-w-md text-slate-400">{joinError ? 'It may have been deleted in another window.' : data.error}</p>
        <div className="mt-2 flex gap-2">
          {!joinError && (
            <Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => void data.reloadAll()}>
              Try again
            </Button>
          )}
          <Link to="/" className="ec-btn ec-btn-secondary inline-flex h-10 items-center rounded-md px-4 text-sm font-medium">
            All events
          </Link>
        </div>
      </div>
    );
  }

  const logo = event?.logoMediaId ? media.find((m) => m.id === event.logoMediaId && !m.missing) : undefined;
  const presenter = ui.presenterMode;
  const script = ui.controlLayout === 'script';
  const pageCount = display?.mode === 'media' && display.media?.pdfUrl ? (display.media.pageCount ?? null) : null;
  // The rail shows who is signed in: the account, with the Google picture when connected.
  const signedInOperator = auth?.account
    ? { name: auth.account.name || auth.account.email, picture: google?.account?.picture ?? null }
    : google?.account
      ? { name: google.account.name, picture: google.account.picture }
      : null;

  // Demo guests can't connect outside accounts, so Google Drive isn't offered to them at all.
  const isDemo = auth?.account?.plan === 'demo';
  const driveButton = isDemo ? null : (
    <Button size="sm" variant="secondary" icon={<DriveIcon size={15} />} onClick={() => setDriveTarget('library')}>
      Google Drive
    </Button>
  );

  // The Control view's parts, placed by the layout below.
  const deckEl = (
    <ControlDeck
      display={display}
      live={isLive}
      currentItem={currentItem}
      nextItem={nextItem}
      offFlow={offFlow}
      canNext={flow.length > 0 && joined && !atEnd}
      canPrevious={flow.length > 0 && joined}
      startLabel={startLabel}
      onStart={start}
      onNext={() => void run({ type: 'next' })}
      onPrevious={() => void run({ type: 'previous' })}
      onResume={() => void run({ type: 'show-current' })}
      onGoToPage={(page) => void run({ type: 'page', page })}
      onEditNotes={setEditingItem}
      keys={{ next: bindings.next[0], previous: bindings.previous[0], resume: bindings.resume[0], black: bindings.black[0] }}
      position={currentIndex >= 0 ? { index: currentIndex, total: flow.length } : null}
    />
  );
  const flowEl = (
    <FlowPane
      className={script ? 'ec-flow-docked mt-5 min-h-[13rem] flex-1' : 'min-h-[14rem] flex-1 max-lg:max-h-[70vh]'}
      flow={flow}
      screens={screens}
      display={display}
      currentId={display?.queueItemId ?? null}
      nextId={nextItem?.id ?? null}
      onAir={showingFlowItem && isLive}
      // Docked on the right in the script layout: a compact list (slides via the counter).
      showSlides={script ? false : ui.showSlides}
      layout={script ? 'compact' : ui.flowLayout}
      activation={ui.flowActivation}
      followLive={ui.followLive}
      thumbSize={ui.thumbSize}
      focusSignal={flowFocus}
      loading={data.loading}
      onShow={showItem}
      onGoToPage={(page) => void run(showingFlowItem ? { type: 'page', page } : { type: 'show-item', queueItemId: currentItem!.id, page })}
      onReorder={reorder}
      onEdit={setEditingItem}
      onRemove={removeFromFlow}
      onAddFiles={() => setPickerOpen(true)}
      onAddScreen={async (s) => {
        if (!eventId) return;
        try {
          await api.addScreenToFlow(eventId, s.id);
          await data.reloadQueue();
          toast.success(`Added “${s.title}” to the Flow.`);
        } catch (err) {
          toast.error(errorMessage(err, 'Couldn’t add the screen.'));
        }
      }}
    />
  );
  const quickEl = (
    <QuickSelection
      preferences={prefs}
      screens={screens}
      media={media}
      display={display}
      disabled={!joined}
      keys={quickItems.map((_, i) => (i < 8 ? bindings[`quick${i + 1}` as ShortcutAction][0] : undefined))}
      onTrigger={triggerQuick}
      onEdit={() => setQuickEditorOpen(true)}
    />
  );
  const timerEl = <TimerStrip timer={timer} send={(cmd) => void run(cmd)} onMore={() => setView('timers')} />;

  return (
    <ClockOffsetContext.Provider value={clockOffset}>
      <div className="flex min-h-dvh lg:h-dvh">
        {!presenter && (
          <Sidebar
            view={view}
            onView={setView}
            logoUrl={logo?.url ?? null}
            eventName={event?.name ?? 'EventControl'}
            disk={system?.disk}
            signedIn={!!auth?.enabled}
            operator={signedInOperator}
            onSignOut={signOut}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
          {/* ── Top bar ─────────────────────────────────────────────────────────── */}
          <header className="ec-topbar z-30 border-b ec-line bg-console-900 max-lg:sticky max-lg:top-0">
            <div className="flex min-h-[60px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:px-5">
              <Link to="/" className="rounded-md p-1 text-slate-400 hover:text-white lg:hidden" aria-label="All events">
                <ArrowLeft size={20} />
              </Link>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[18px] leading-tight font-semibold tracking-[-0.015em] text-white">{event?.name ?? 'Opening event…'}</h1>
                <p className="truncate text-[13px] text-slate-500">{presenter ? 'Presenter mode' : view === 'control' ? 'Control' : NAV.find((n) => n.id === view)?.label}</p>
              </div>
              {/* On phones the status goes on its own row, so the event name keeps the full width. */}
              <div className="flex flex-wrap items-center max-sm:order-last max-sm:w-full">
                <TopStatus
                  tone={!joined || isLive ? 'ok' : 'bad'}
                  icon={<span className="ec-status-dot h-2.5 w-2.5 rounded-full" data-state={!joined ? 'connecting' : isLive ? 'ok' : 'bad'} />}
                  title={!joined ? 'Connecting…' : isLive ? 'Projector connected' : 'Projector offline'}
                  detail={!joined ? 'Reaching the EventControl server' : isLive ? (presence!.displays > 1 ? `${presence!.displays} display windows` : 'Display window open') : 'Open the display window'}
                  onClick={isLive || !joined ? undefined : openDisplayWindow}
                />
                {system && !presenter && (
                  <TopStatus
                    tone={!cloudEnabled ? 'neutral' : system.storage.ok ? 'ok' : 'bad'}
                    icon={uploadProgress !== null ? <Loader2 size={18} className="animate-spin" /> : system.storage.ok ? <Cloud size={18} /> : <CloudOff size={18} />}
                    title={uploadProgress !== null ? `Uploading ${Math.round(uploadProgress * 100)}%` : cloudEnabled ? (system.storage.ok ? 'Cloud backup on' : 'Cloud offline') : 'Files on this computer'}
                    detail={
                      !cloudEnabled
                        ? 'Works without internet'
                        : system.storage.pending
                          ? `${system.storage.pending} still uploading`
                          : system.storage.errors
                            ? `${system.storage.errors} not backed up yet`
                            : system.storage.ok
                              ? 'All files backed up'
                              : 'Files are safe here; backup resumes by itself'
                    }
                    hint={system.storage.message}
                  />
                )}
              </div>
              <div className="flex items-center gap-1 border-l ec-line pl-3 max-sm:border-l-0 max-sm:pl-0">
                {(view === 'control' || presenter) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setUi({ controlLayout: script ? 'flow' : 'script' })}
                    aria-pressed={script}
                    aria-label={script ? 'Switch to the Flow layout' : 'Switch to the script layout: script on the left, Flow on the right'}
                    title={script ? 'Flow layout' : 'Script layout: script on the left, Flow on the right'}
                  >
                    {script ? <ListVideo size={18} /> : <ScrollText size={18} />}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setUi({ presenterMode: !presenter })}
                  aria-pressed={presenter}
                  aria-label={presenter ? 'Leave presenter mode' : 'Presenter mode: only the Flow and the controls'}
                  title={presenter ? 'Leave presenter mode' : 'Presenter mode: only the Flow and the controls'}
                >
                  {presenter ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </Button>
                <ThemeSwitcher />
                <Button variant="primary" icon={<MonitorPlay size={16} />} onClick={openDisplayWindow} className="ml-1">
                  <span className="max-sm:hidden">Open display</span>
                </Button>
              </div>
            </div>
            {(!connected || (connected && !joined)) && !data.loading && (
              <div className="flex items-center justify-center gap-2 border-t border-amber-500/30 bg-amber-400/15 px-4 py-1.5 text-[13px] text-amber-200" role="status">
                <WifiOff size={14} />
                {!reachable || !connected
                  ? 'Reconnecting to the EventControl server… The projector keeps showing the last picture. Buttons work again as soon as this bar disappears.'
                  : 'Reconnecting to the event…'}
              </div>
            )}
            {!presenter && (
              <nav className="scroll-thin flex gap-1 overflow-x-auto border-t ec-line px-3 py-1.5 lg:hidden" aria-label="Console sections">
                {NAV.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setView(id)}
                    aria-current={view === id ? 'page' : undefined}
                    className={cn('flex shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 py-1.5 text-sm', view === id ? 'bg-sky-500/12 font-semibold text-sky-300' : 'text-slate-400')}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </nav>
            )}
          </header>

          {view === 'control' || presenter ? (
            <main
              className="ec-view-in ec-control grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.22fr)_minmax(400px,1fr)] lg:overflow-hidden"
              style={{ '--preview-h': 'clamp(150px, 30vh, 480px)' } as CSSProperties}
            >
              {/*
                Two arrangements of the same parts (Settings → Presentation → Layout):
                Flow layout   — left: controls, Flow, timer · right: picture, Up next, Quick Selection.
                Script layout — left: controls, script, Quick Selection, timer · right: picture, Up next, Flow.
              */}
              <div className="ec-primary flex min-h-0 min-w-0 flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-[var(--line)]">
                {deckEl}
                {script ? (
                  <>
                    <ScriptPane
                      className="min-h-[12rem] flex-1 max-lg:max-h-[60vh]"
                      item={currentItem}
                      next={nextItem}
                      size={ui.scriptSize}
                      onSize={(scriptSize) => setUi({ scriptSize })}
                      onEdit={setEditingItem}
                    />
                    <div className="ec-quick-docked shrink-0 border-t ec-line px-[var(--gutter)] py-4">{quickEl}</div>
                  </>
                ) : (
                  flowEl
                )}
                {timerEl}
              </div>

              <div className="ec-pane-alt ec-secondary scroll-thin min-h-0 min-w-0 lg:overflow-y-auto lg:overflow-x-hidden">
                <StagePane
                  layout={ui.controlLayout}
                  display={display}
                  timer={timer}
                  videoCommand={videoCommand}
                  displays={presence?.displays ?? 0}
                  showPreview={ui.showPreview}
                  nextItem={nextItem}
                  canNext={flow.length > 0 && joined && !atEnd}
                  canPrevious={flow.length > 0 && joined}
                  onNext={() => void run({ type: 'next' })}
                  onPrevious={() => void run({ type: 'previous' })}
                  onVideo={videoAction}
                  onFullscreen={() => void run({ type: 'fullscreen' })}
                  onOpenExternally={(id) => {
                    const m = media.find((x) => x.id === id);
                    if (m) void openMedia(m);
                  }}
                  canOpenExternally={!!system?.openExternally}
                  mouseControls={ui.mouseControls}
                  onOpenDisplay={openDisplayWindow}
                  black={{ enabled: blackPrefs.enabled, confirm: prefs?.confirmBlack ?? true, active: blackOn, hint: bindings.black[0] }}
                  onBlack={toggleBlack}
                  onLogo={() => void run(display?.mode === 'logo' ? { type: 'show-current' } : { type: 'logo' })}
                  overlay={{ available: !!event?.overlay.mediaId, visible: !!event?.overlay.visible, hint: bindings.overlay[0] }}
                  onOverlay={toggleOverlay}
                >
                  {script ? flowEl : quickEl}
                </StagePane>
              </div>
              {/* Hidden "go to slide" target for the G shortcut. */}
              {pageCount && (
                <input
                  ref={jumpRef}
                  className="sr-only"
                  aria-label="Go to slide number"
                  inputMode="numeric"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const n = Number(e.currentTarget.value);
                    if (Number.isInteger(n) && n >= 1 && n <= pageCount) void run({ type: 'page', page: n });
                    e.currentTarget.value = '';
                    e.currentTarget.blur();
                  }}
                />
              )}
            </main>
          ) : (
            <main key={view} className="ec-section-in scroll-thin min-w-0 flex-1 p-4 sm:p-6 lg:overflow-y-auto">
              {view === 'files' && (
                <PresentationLibrary
                  className="mx-auto min-h-[70dvh] max-w-7xl"
                  title="Files"
                  extraActions={driveButton}
                  media={media}
                  logoMediaId={event?.logoMediaId ?? null}
                  overlayMediaId={event?.overlay.mediaId ?? null}
                  flowMediaIds={flowMediaIds}
                  cloudEnabled={cloudEnabled}
                  uploadProgress={uploadProgress}
                  onUpload={(files, folder) => void upload(files, folder)}
                  onPreview={setPreviewing}
                  onAddToFlow={(m) => void addToFlow([m])}
                  onShowNow={(m) => void run({ type: 'show-media', mediaId: m.id })}
                  onOpen={openMedia}
                  onRename={async (m, name) => {
                    try {
                      await api.renameMedia(m.id, name);
                      await Promise.all([data.reloadMedia(), data.reloadQueue()]);
                    } catch (err) {
                      toast.error(errorMessage(err, 'Couldn’t rename the file.'));
                    }
                  }}
                  onMove={async (m, folder) => {
                    try {
                      await api.moveMedia(m.id, folder);
                      await data.reloadMedia();
                      toast.success(folder ? `Moved “${m.name}” to ${folder}.` : `“${m.name}” is now unfiled.`);
                    } catch (err) {
                      toast.error(errorMessage(err, 'Couldn’t move the file.'));
                    }
                  }}
                  onSetLogo={(m) => void setEventField({ logoMediaId: m?.id ?? null }, m ? `“${m.name}” is now the full-screen logo.` : 'Full-screen logo removed.')}
                  onSetOverlay={(m) => {
                    void run({ type: 'overlay', mediaId: m.id });
                    toast.success(`“${m.name}” is the overlay logo. Show it from Branding (or press O).`);
                  }}
                  onReconvert={async (m) => {
                    try {
                      await api.reconvertMedia(m.id);
                      toast.info(`Converting “${m.name}”…`);
                    } catch (err) {
                      toast.error(errorMessage(err, 'Couldn’t start the conversion.'));
                    }
                  }}
                  onDelete={setDeletingMedia}
                />
              )}

              {view === 'screens' && (
                <Panel title="Screens" icon={<LayoutGrid size={19} />} className="mx-auto max-w-3xl">
                  <ScreensPanel
                    screens={screens}
                    display={display}
                    media={media}
                    onShow={(s, timerMs) => void run({ type: 'show-screen', screenId: s.id, timerMs })}
                    onAddToFlow={async (s) => {
                      if (!eventId) return;
                      await quiet(api.addScreenToFlow(eventId, s.id));
                      await data.reloadQueue();
                      toast.success(`Added “${s.title}” to the Flow.`);
                    }}
                    onSave={async (s, input) => {
                      if (!eventId) return;
                      if (s) await api.updateScreen(s.id, input);
                      else await api.createScreen(eventId, input);
                      await data.reloadScreens();
                      toast.success('Screen saved.');
                    }}
                    onDelete={async (s) => {
                      try {
                        await api.deleteScreen(s.id);
                        await Promise.all([data.reloadScreens(), data.reloadQueue()]);
                      } catch (err) {
                        toast.error(errorMessage(err, 'Couldn’t delete the screen.'));
                      }
                    }}
                  />
                </Panel>
              )}

              {view === 'branding' && (
                <Panel title="Branding" icon={<Palette size={19} />} className="mx-auto max-w-2xl">
                  <BrandingPanel event={event} images={images} onChange={(patch) => void run({ type: 'overlay', ...patch })} />
                </Panel>
              )}

              {view === 'timers' && (
                <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
                  <TimerPanel timer={timer} send={(cmd) => void run(cmd)} />
                  <Panel title="Schedule" icon={<CalendarClock size={19} />}>
                    <SchedulePanel
                      embedded
                      schedule={schedule}
                      onAdd={async (item) => {
                        if (!eventId) return;
                        await api.addScheduleItem(eventId, { ...item, description: '', durationMinutes: null });
                        await data.reloadSchedule();
                      }}
                      onDelete={async (item) => {
                        try {
                          await api.deleteScheduleItem(item.id);
                          await data.reloadSchedule();
                        } catch (err) {
                          toast.error(errorMessage(err, 'Couldn’t delete the schedule item.'));
                        }
                      }}
                    />
                  </Panel>
                </div>
              )}

              {view === 'settings' && (
                <SettingsView
                  section={settingsSection}
                  onSection={(section) =>
                    setParams(
                      (p) => {
                        const next = new URLSearchParams(p);
                        next.set('section', section);
                        return next;
                      },
                      { replace: true },
                    )
                  }
                  event={event}
                  media={media}
                  screens={screens}
                  google={google}
                  openAccess={!auth?.enabled}
                  account={auth?.account ?? null}
                  signedIn={!!auth?.enabled}
                  displayUrl={eventId ? `${window.location.origin}/display/${eventId}` : ''}
                  consoleUrl={eventId ? `${window.location.origin}/events/${eventId}` : ''}
                  uploadProgress={uploadProgress}
                  onPreferences={savePreferences}
                  onCustomizeQuick={() => setQuickEditorOpen(true)}
                  onUpload={(files) => void upload(files)}
                  onUploadLogo={async (file) => {
                    const result = await upload([file], 'Branding');
                    const logoFile = result?.uploaded[0] ?? result?.duplicates[0];
                    if (logoFile) await setEventField({ logoMediaId: logoFile.id }, 'Logo updated.');
                  }}
                  onSetLogo={(id) => setEventField({ logoMediaId: id }, id ? 'Logo updated.' : 'Logo removed. The image is still in Files.')}
                  onManageFiles={() => setView('files')}
                  onOverlay={() => setView('branding')}
                  onBrowseDrive={() => setDriveTarget('library')}
                  onDisconnectGoogle={async () => {
                    try {
                      setGoogle(await api.googleDisconnect());
                      toast.info('Google disconnected. Files you already imported stay in your events.');
                    } catch (err) {
                      toast.error(errorMessage(err, 'Couldn’t disconnect Google.'));
                    }
                  }}
                  onEditEvent={() => setEditEventOpen(true)}
                  onOpenDisplay={openDisplayWindow}
                  onFullscreen={() => void run({ type: 'fullscreen' })}
                  onSignOut={signOut}
                  onCopied={(what) => toast.success(what)}
                />
              )}
            </main>
          )}
        </div>

        <FilePicker
          open={pickerOpen}
          media={media}
          flowMediaIds={flowMediaIds}
          uploadProgress={uploadProgress}
          driveAvailable={!!google?.connected}
          onClose={() => setPickerOpen(false)}
          onAdd={(files) => addToFlow(files)}
          onUpload={(files) => void upload(files)}
          onDrive={
            isDemo
              ? undefined
              : () => {
                  setPickerOpen(false);
                  setDriveTarget('flow');
                }
          }
        />
        <DriveBrowser open={driveTarget !== null} status={google} onClose={() => setDriveTarget(null)} onImport={importFromDrive} onStatusChange={refreshGoogle} />
        <QuickSelectionEditor
          open={quickEditorOpen}
          preferences={prefs}
          screens={screens}
          media={media}
          onClose={() => setQuickEditorOpen(false)}
          onSave={async (items) => {
            await savePreferences({ quickSelection: items });
            toast.success('Quick Selection saved.');
          }}
        />
        <FlowItemModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={async (id, patch) => {
            await api.updateQueueItem(id, patch);
            await data.reloadQueue();
            toast.success('Flow item updated.');
          }}
        />
        <PreviewModal
          media={previewing}
          onClose={() => setPreviewing(null)}
          onShowPage={(m, page) => void run({ type: 'show-media', mediaId: m.id, page: m.pdfUrl ? page : undefined })}
          onAddToFlow={(m, start, end) => void addToFlow([m], start, end)}
        />
        <EventFormModal
          open={editEventOpen}
          event={event}
          logoOptions={images}
          onClose={() => setEditEventOpen(false)}
          onSubmit={async (input) => {
            if (!eventId) return;
            await api.updateEvent(eventId, input);
            await data.reloadEvent();
            toast.success('Event updated.');
          }}
        />
        <ConfirmDialog
          open={!!deletingMedia}
          title="Delete file?"
          message={
            <>
              <b className="text-white">{deletingMedia?.name}</b> will be deleted{cloudEnabled ? ' from this computer and the cloud' : ''}
              {deletingMedia && flowMediaIds.has(deletingMedia.id) ? ' and removed from the Flow' : ''}. This can’t be undone.
            </>
          }
          onClose={() => setDeletingMedia(null)}
          onConfirm={async () => {
            if (!deletingMedia) return;
            try {
              await api.deleteMedia(deletingMedia.id);
              await Promise.all([data.reloadMedia(), data.reloadQueue(), data.reloadEvent()]);
              toast.success('File deleted.');
            } catch (err) {
              toast.error(errorMessage(err, 'Couldn’t delete the file.'));
            }
          }}
        />
        <ShortcutsHelp
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          onCustomize={() => {
            setHelpOpen(false);
            setParams((p) => {
              const next = new URLSearchParams(p);
              next.set('view', 'settings');
              next.set('section', 'controls');
              return next;
            });
          }}
        />
        <ConfirmDialog
          open={!!switchTo}
          title="Switch presentation?"
          confirmLabel="Switch"
          message={
            <>
              <b className="text-white">{currentItem ? itemLabel(currentItem) : ''}</b> is at slide {display?.page} of {display?.range?.end}. Show{' '}
              <b className="text-white">{switchTo ? itemLabel(switchTo) : ''}</b> instead?
            </>
          }
          onClose={() => setSwitchTo(null)}
          onConfirm={() => {
            if (switchTo) void run({ type: 'show-item', queueItemId: switchTo.id });
          }}
        />
      </div>
    </ClockOffsetContext.Provider>
  );
}

/** One status in the top bar: a coloured signal, a title and a quieter detail line. */
function TopStatus({ tone, icon, title, detail, hint, onClick }: { tone: 'ok' | 'bad' | 'neutral'; icon: ReactNode; title: string; detail: string; hint?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cn('flex items-center gap-2.5 border-l ec-line px-4 text-left first:border-l-0', onClick && 'rounded-sm hover:bg-console-700')} title={hint}>
      <span className={cn('flex shrink-0 items-center', tone === 'bad' ? 'text-red-400' : 'text-slate-400')}>{icon}</span>
      <span className="leading-tight">
        <span className={cn('block text-[13px] font-semibold', tone === 'bad' ? 'text-red-400' : 'text-white')}>{title}</span>
        <span className={cn('block text-xs max-md:hidden', onClick ? 'text-sky-300' : 'text-slate-500')}>{detail}</span>
      </span>
    </Tag>
  );
}
