import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Coffee, ArrowDown, ArrowUp, FileText, Hourglass, Image as ImageIcon, ImagePlus, MonitorOff, Pencil, Plus, RotateCcw, Star, Trash2, Undo2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { KeyHint } from './ControlDeck';
import { prettyCombo } from '../../lib/shortcuts';
import { cn } from '../../lib/cn';
import type { DisplaySnapshot, EventPreferences, Media, QuickItem, QuickTone, Screen } from '../../types';

export const DEFAULT_QUICK: QuickItem[] = [
  { id: 'qs-wait', kind: 'screen', screenKey: 'please-wait', tone: 'amber' },
  { id: 'qs-tech', kind: 'screen', screenKey: 'technical', tone: 'red' },
  { id: 'qs-break', kind: 'screen', screenKey: 'break', tone: 'blue' },
  { id: 'qs-logo', kind: 'logo' },
];

interface Resolved {
  item: QuickItem;
  label: string;
  icon: React.ReactNode;
  tone: QuickTone;
  active: boolean;
  /** Missing target (deleted file or screen): shown disabled with the reason. */
  missing?: string;
}

/** Turns stored items into buttons, looking up the screens and files they point at. */
export function resolveQuickItems(items: QuickItem[], screens: Screen[], media: Media[], display: DisplaySnapshot | null, logo?: Media | null): Resolved[] {
  return items.map((item) => {
    switch (item.kind) {
      case 'screen': {
        const screen = item.screenId ? screens.find((s) => s.id === item.screenId) : screens.find((s) => s.key === item.screenKey);
        const key = screen?.key ?? item.screenKey;
        const active = display?.mode === 'screen' && !!screen && display.screen?.id === screen.id;
        return {
          item,
          tone: item.tone ?? (key === 'technical' ? 'red' : key === 'please-wait' ? 'amber' : 'blue'),
          label: item.label || screen?.title || 'Screen',
          icon: key === 'technical' ? <AlertTriangle size={18} /> : key === 'please-wait' ? <Hourglass size={18} /> : key === 'break' ? <Coffee size={18} /> : <Star size={18} />,
          active,
          missing: screen ? undefined : 'This screen was deleted.',
        };
      }
      case 'media': {
        const m = media.find((x) => x.id === item.mediaId);
        const active = display?.mode === 'media' && display.media?.id === item.mediaId && !!display.adHocMediaId;
        return {
          item,
          tone: item.tone ?? 'blue',
          label: item.label || m?.name.replace(/\.[^.]+$/, '') || 'File',
          icon: m?.kind === 'image' ? <ImageIcon size={18} /> : <FileText size={18} />,
          active,
          missing: m && !m.missing ? undefined : 'This file is no longer in the library.',
        };
      }
      case 'black':
        return { item, tone: 'neutral', label: item.label || 'Black Screen', icon: <MonitorOff size={18} />, active: display?.mode === 'black' };
      case 'logo':
        return {
          item,
          tone: item.tone ?? 'neutral',
          label: item.label || 'Show Logo',
          // The logo itself, so it's clear what will go up; without one, the button offers to add it.
          icon: logo ? <img src={logo.url} alt="" className="h-[18px] w-[18px] rounded-[3px] object-contain" /> : <ImageIcon size={18} />,
          active: display?.mode === 'logo',
        };
      case 'current':
        return { item, tone: item.tone ?? 'blue', label: item.label || 'Back to Flow', icon: <Undo2 size={18} />, active: false };
    }
  });
}

interface QuickSelectionProps {
  preferences: EventPreferences | null;
  screens: Screen[];
  media: Media[];
  display: DisplaySnapshot | null;
  disabled?: boolean;
  /** Keyboard shortcut per button position (Settings → Controls), for the hints. */
  keys?: (string | undefined)[];
  /** The event logo, shown on the Show Logo button. */
  logo?: Media | null;
  onTrigger: (item: QuickItem) => void;
  onEdit: () => void;
  /** Upload or change the logo (the small key on Show Logo). */
  onEditLogo?: () => void;
}

/** The presenter's own shortcuts: one click puts a screen, file or state on the projector. */
export function QuickSelection({ preferences, screens, media, display, disabled, keys, logo, onTrigger, onEdit, onEditLogo }: QuickSelectionProps) {
  const blackOff = preferences?.blackScreen?.enabled === false;
  const items = (preferences?.quickSelection ?? DEFAULT_QUICK).filter((q) => !(blackOff && q.kind === 'black'));
  const resolved = useMemo(() => resolveQuickItems(items, screens, media, display, logo), [items, screens, media, display, logo]);
  const confirmBlack = preferences?.confirmBlack ?? true;
  const [armed, setArmed] = useState<string | null>(null);
  const disarm = useRef(0);
  useEffect(() => () => window.clearTimeout(disarm.current), []);

  const press = (r: Resolved) => {
    if (r.item.kind === 'black' && confirmBlack && !r.active) {
      if (armed !== r.item.id) {
        setArmed(r.item.id);
        window.clearTimeout(disarm.current);
        disarm.current = window.setTimeout(() => setArmed(null), 3000);
        return;
      }
      setArmed(null);
    }
    onTrigger(r.item);
  };

  return (
    <section aria-label="Quick selection">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="ec-label">Quick selection</h3>
        <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={onEdit} className="-mr-2 text-[12px]">
          Customize
        </Button>
      </div>
      {resolved.length === 0 ? (
        <button onClick={onEdit} className="w-full rounded-md border border-dashed border-[var(--line-strong)] py-4 text-sm text-slate-500 hover:text-slate-300">
          Add your own shortcuts
        </button>
      ) : (
        <div className="ec-quickpad grid grid-cols-2" data-count={resolved.length}>
          {resolved.map((r, index) => {
            const isArmed = armed === r.item.id;
            const key = keys?.[index];
            const editLogo = r.item.kind === 'logo' && !!onEditLogo;
            return (
              <div key={r.item.id} className="ec-quick-cell relative flex min-w-0">
                <button
                  onClick={() => press(r)}
                  disabled={disabled || !!r.missing}
                  title={r.missing ?? (key ? `${r.label} (${prettyCombo(key)})` : r.label)}
                  aria-pressed={r.active}
                  data-tone={isArmed ? 'red' : r.tone}
                  className={cn(
                    'ec-quick-btn group relative flex h-12 w-full min-w-0 items-center gap-2.5 px-3.5 text-left text-[14px] font-medium text-slate-200',
                    isArmed && 'ec-armed',
                    editLogo && 'pr-11',
                  )}
                >
                  <span key={r.active ? 'on' : 'off'} className={cn('shrink-0', r.active && 'ec-pop')}>
                    {r.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{isArmed ? 'Click again for black' : r.label}</span>
                  {r.active ? (
                    <span className="ec-fade-in shrink-0 text-[10px] font-semibold tracking-[0.08em] uppercase opacity-85">On screen</span>
                  ) : key ? (
                    <span className="opacity-60 transition-opacity group-hover:opacity-100">
                      <KeyHint combo={key} />
                    </span>
                  ) : null}
                </button>
                {editLogo && (
                  <button
                    type="button"
                    onClick={onEditLogo}
                    disabled={disabled}
                    title={logo ? 'Change the logo' : 'Upload a logo'}
                    aria-label={logo ? 'Change the logo' : 'Upload a logo'}
                    className={cn('ec-quick-edit absolute top-1/2 right-1.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md', r.active ? 'text-white' : 'text-slate-300')}
                  >
                    {logo ? <Pencil size={14} /> : <ImagePlus size={15} />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const TONES: { value: QuickTone; label: string; swatch: string }[] = [
  { value: 'amber', label: 'Amber', swatch: '#f59e0b' },
  { value: 'red', label: 'Red', swatch: '#e5484d' },
  { value: 'blue', label: 'Blue', swatch: '#2563eb' },
  { value: 'neutral', label: 'Grey', swatch: '#6b7280' },
];

/** Add, remove, reorder and rename the Quick Selection buttons. */
export function QuickSelectionEditor({
  open,
  preferences,
  screens,
  media,
  onClose,
  onSave,
}: {
  open: boolean;
  preferences: EventPreferences | null;
  screens: Screen[];
  media: Media[];
  onClose: () => void;
  onSave: (items: QuickItem[]) => Promise<void>;
}) {
  const [items, setItems] = useState<QuickItem[]>([]);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setItems(preferences?.quickSelection ?? DEFAULT_QUICK);
  }, [open, preferences]);

  const resolved = resolveQuickItems(items, screens, media, null);
  const move = (i: number, d: number) =>
    setItems((list) => {
      const next = [...list];
      const [x] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x);
      return next;
    });
  const patch = (i: number, p: Partial<QuickItem>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...p } : it)));

  const add = (value: string) => {
    if (!value) return;
    const [kind, ref] = value.split(':');
    const id = `qs-${Date.now().toString(36)}`;
    const item: QuickItem =
      kind === 'screen' ? { id, kind: 'screen', screenId: ref } : kind === 'media' ? { id, kind: 'media', mediaId: ref } : { id, kind: kind as QuickItem['kind'] };
    setItems((list) => [...list, item].slice(0, 16));
    setAdding('');
  };

  const files = media.filter((m) => !m.missing);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize Quick Selection"
      footer={
        <>
          <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setItems(DEFAULT_QUICK)} className="mr-auto">
            Reset to default
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(items);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-500">These buttons sit under the picture in the Control view. Put the screens and files you reach for most first. Saved with the event, so every console sees the same set.</p>
      <ol className="divide-y divide-[var(--line)] rounded-md border border-[var(--line)]">
        {resolved.map((r, i) => (
          <li key={r.item.id} className="ec-rise-in flex items-center gap-2 px-2.5 py-2">
            <span className="flex flex-col">
              <button className="rounded p-0.5 text-slate-500 hover:text-white disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.label} up`}>
                <ArrowUp size={14} />
              </button>
              <button className="rounded p-0.5 text-slate-500 hover:text-white disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === resolved.length - 1} aria-label={`Move ${r.label} down`}>
                <ArrowDown size={14} />
              </button>
            </span>
            <span className="shrink-0 text-slate-400">{r.icon}</span>
            <input
              value={r.item.label ?? ''}
              placeholder={r.label}
              onChange={(e) => patch(i, { label: e.target.value.slice(0, 40) })}
              aria-label="Button label"
              className="h-9 min-w-0 flex-1 rounded-[5px] border border-transparent bg-transparent px-2 text-sm text-white placeholder:text-slate-300 hover:border-[var(--line-strong)] focus:border-sky-400 focus:bg-console-900 focus:outline-none"
            />
            {r.missing && <span className="shrink-0 text-xs text-red-400">{r.missing}</span>}
            {r.item.kind !== 'black' && (
              <span className="flex shrink-0 gap-1" role="radiogroup" aria-label="Colour">
                {TONES.map((t) => (
                  <button
                    key={t.value}
                    role="radio"
                    aria-checked={r.tone === t.value}
                    aria-label={t.label}
                    title={t.label}
                    onClick={() => patch(i, { tone: t.value })}
                    className={cn('h-5 w-5 rounded-full border-2 transition-transform hover:scale-110', r.tone === t.value ? 'border-white shadow-[0_0_0_1px_var(--ink-400)]' : 'border-transparent')}
                    style={{ background: t.swatch }}
                  />
                ))}
              </span>
            )}
            <Button size="icon-sm" variant="ghost" onClick={() => setItems((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${r.label}`} className="hover:!text-red-400">
              <Trash2 size={15} />
            </Button>
          </li>
        ))}
        {resolved.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No buttons yet. Add one below.</li>}
      </ol>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <Plus size={16} className="text-slate-500" />
        <span className="shrink-0 font-medium text-slate-300">Add</span>
        <select
          value={adding}
          onChange={(e) => add(e.target.value)}
          disabled={items.length >= 16}
          className="h-10 min-w-0 flex-1 rounded-md border border-[var(--line-strong)] bg-console-900 px-3 text-sm text-white focus:border-sky-400 focus:outline-none"
        >
          <option value="">{items.length >= 16 ? 'Up to 16 buttons' : 'Choose a screen, file or action…'}</option>
          <optgroup label="Actions">
            <option value="black">Black screen</option>
            <option value="logo">Show logo</option>
            <option value="current">Back to Flow (resume)</option>
          </optgroup>
          <optgroup label="Screens">
            {screens.map((s) => (
              <option key={s.id} value={`screen:${s.id}`}>
                {s.title}
              </option>
            ))}
          </optgroup>
          {files.length > 0 && (
            <optgroup label="Files">
              {files.map((m) => (
                <option key={m.id} value={`media:${m.id}`}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
    </Modal>
  );
}
