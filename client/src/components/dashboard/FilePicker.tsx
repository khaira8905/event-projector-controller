import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, HardDriveUpload, Search } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { MediaIcon, mediaKindLabel } from '../MediaIcon';
import { DriveIcon } from '../DriveIcon';
import { ACCEPTED_FILE_TYPES } from '../../services/api';
import { cn } from '../../lib/cn';
import type { Media } from '../../types';

/**
 * "Add → Presentations & files": tick one or more files to append to the Flow, upload new
 * ones from this computer, or bring them in from Google Drive — without leaving the Flow.
 */
export function FilePicker({
  open,
  media,
  flowMediaIds,
  uploadProgress,
  driveAvailable,
  onClose,
  onAdd,
  onUpload,
  onDrive,
}: {
  open: boolean;
  media: Media[];
  flowMediaIds: Set<string>;
  uploadProgress: number | null;
  driveAvailable: boolean;
  onClose: () => void;
  onAdd: (files: Media[]) => Promise<void>;
  onUpload: (files: File[]) => void;
  /** Missing: Google Drive isn't offered (the demo). */
  onDrive?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setPicked([]);
      setQuery('');
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      media
        .filter((m) => !q || m.name.toLowerCase().includes(q))
        // Presentations first, newest first within each kind.
        .sort((a, b) => rank(a) - rank(b) || +new Date(b.createdAt) - +new Date(a.createdAt)),
    [media, q],
  );
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Add to the Flow"
      footer={
        <>
          <span className="mr-auto text-sm text-slate-500">{picked.length ? `${picked.length} selected — added in the order you picked them` : 'Pick one or more files'}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!picked.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onAdd(picked.map((id) => media.find((m) => m.id === id)!).filter(Boolean));
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Adding…' : picked.length > 1 ? `Add ${picked.length} to Flow` : 'Add to Flow'}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">Search files</span>
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search presentations and files…"
            className="h-10 w-full rounded-md border border-[var(--line-strong)] bg-console-900 pr-3 pl-9 text-sm text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          />
        </label>
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
        <Button icon={<HardDriveUpload size={16} />} onClick={() => input.current?.click()} disabled={uploadProgress !== null}>
          {uploadProgress !== null ? `Uploading ${Math.round(uploadProgress * 100)}%` : 'From this computer'}
        </Button>
        {onDrive && (
          <Button icon={<DriveIcon size={16} />} onClick={onDrive} title={driveAvailable ? 'Import from Google Drive' : 'Connect Google Drive in Settings → File sources'}>
            Google Drive
          </Button>
        )}
      </div>

      <ul className="mt-3 max-h-[52vh] divide-y divide-[var(--line)] overflow-y-auto rounded-md border border-[var(--line)]" role="listbox" aria-multiselectable>
        {rows.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-slate-500">{q ? `Nothing matches “${query}”.` : 'No files yet. Upload a PowerPoint, PDF, image or video to get started.'}</li>
        )}
        {rows.map((m) => {
          const order = picked.indexOf(m.id);
          const selected = order >= 0;
          return (
            <li key={m.id}>
              <button
                role="option"
                aria-selected={selected}
                onClick={() => toggle(m.id)}
                onDoubleClick={async () => {
                  await onAdd([m]);
                  onClose();
                }}
                className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors', selected ? 'ec-selected bg-[var(--row-active)]' : 'hover:bg-[var(--row-hover)]')}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border text-[11px] font-bold',
                    selected ? 'ec-pop border-sky-500 bg-sky-500 text-[#fff]' : 'border-[var(--line-strong)] bg-console-900',
                  )}
                >
                  {selected ? (picked.length > 1 ? order + 1 : <Check size={13} strokeWidth={3} />) : null}
                </span>
                <MediaIcon kind={m.kind} size={12} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{m.name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {mediaKindLabel(m.kind)}
                    {m.pageCount ? ` · ${m.pageCount} ${m.kind === 'presentation' ? 'slides' : 'pages'}` : ''}
                    {m.kind === 'presentation' && m.conversionStatus === 'pending' ? ' · converting…' : ''}
                    {m.kind === 'presentation' && (m.conversionStatus === 'unavailable' || m.conversionStatus === 'failed') ? ' · slides not available yet' : ''}
                    {m.missing ? ' · file missing' : ''}
                  </span>
                </span>
                {flowMediaIds.has(m.id) && <span className="shrink-0 text-xs text-slate-500">Already in Flow</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

const rank = (m: Media) => (m.kind === 'presentation' ? 0 : m.kind === 'pdf' ? 1 : m.kind === 'video' ? 2 : 3);
