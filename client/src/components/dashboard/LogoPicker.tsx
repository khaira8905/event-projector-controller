import { useRef, useState } from 'react';
import { ImagePlus, Loader2, MonitorPlay, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import type { Media } from '../../types';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

/**
 * The event logo: a preview, Upload / Replace, "Use an image from Files" and Remove. Used in
 * Settings → Display and in the window the Show Logo button opens.
 */
export function LogoEditor({
  logo,
  images,
  onUpload,
  onSetLogo,
}: {
  logo: Media | null;
  /** Images in the event's Files, to pick one as the logo. */
  images: Media[];
  onUpload: (file: File) => Promise<void>;
  onSetLogo: (mediaId: string | null) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await onUpload(file);
    } finally {
      setBusy(false);
    }
  };
  const others = images.filter((m) => m.id !== logo?.id);

  return (
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
          accept={ACCEPT}
          className="hidden"
          aria-label="Logo image"
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
          {others.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && void onSetLogo(e.target.value)}
              className="ec-input h-8 w-full max-w-[13rem] min-w-0 px-2 text-[13px] max-sm:max-w-full"
              aria-label="Use an image from Files"
            >
              <option value="">Use an image from Files…</option>
              {others.map((m) => (
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
  );
}

/**
 * Opened from the Show Logo button: set or change the logo without leaving the console.
 * When it opened because there was no logo yet, "Show on screen" puts it up once it's set.
 */
export function LogoPicker({
  open,
  logo,
  images,
  showAfter,
  onUpload,
  onSetLogo,
  onShow,
  onClose,
}: {
  open: boolean;
  logo: Media | null;
  images: Media[];
  /** Opened by pressing Show Logo without a logo: offer to show it straight away. */
  showAfter: boolean;
  onUpload: (file: File) => Promise<void>;
  onSetLogo: (mediaId: string | null) => Promise<void>;
  onShow: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={logo ? 'Event logo' : 'Add your logo'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {showAfter && !logo ? 'Cancel' : 'Done'}
          </Button>
          {showAfter && (
            <Button
              variant="primary"
              icon={<MonitorPlay size={15} />}
              disabled={!logo}
              onClick={() => {
                onShow();
                onClose();
              }}
            >
              Show on screen
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-slate-400">
        {showAfter && !logo
          ? 'Show Logo puts your logo full-screen on the projector. Upload it once; it’s saved with this event and also used on Black Screen and the special screens.'
          : 'Shown full-screen by Show Logo, and on Black Screen and the special screens.'}
      </p>
      <LogoEditor logo={logo} images={images} onUpload={onUpload} onSetLogo={onSetLogo} />
    </Modal>
  );
}
