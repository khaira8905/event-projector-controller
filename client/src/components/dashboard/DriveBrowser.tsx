import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Pending } from '../ui/Pending';
import { DriveIcon } from '../DriveIcon';
import { ApiError, api } from '../../services/api';
import { loadPicker, pickDriveFiles } from '../../lib/googlePicker';
import type { GoogleStatus } from '../../types';

/**
 * Import from Google Drive. Once Drive is connected, Google's own file picker opens and the
 * person chooses the presentations; EventControl only gets access to those files. Imported
 * files are copied onto the server, so they convert to slides and keep working if the venue
 * Wi-Fi drops. Before that, this explains what's needed (set up / connect).
 */
export function DriveBrowser({
  open,
  status,
  onClose,
  onImport,
  onStatusChange,
}: {
  open: boolean;
  status: GoogleStatus | null;
  onClose: () => void;
  onImport: (fileIds: string[]) => Promise<void>;
  onStatusChange: () => void;
}) {
  const ready = !!status?.configured && !!status.connected && status.drive;
  const [phase, setPhase] = useState<'idle' | 'opening' | 'importing'>('idle');
  const [error, setError] = useState<string | null>(null);
  // One picker per opening, even if React runs the effect twice.
  const started = useRef(false);

  const run = async () => {
    setError(null);
    setPhase('opening');
    try {
      const [session] = await Promise.all([api.googlePicker(), loadPicker()]);
      setPhase('idle');
      const ids = await pickDriveFiles(session);
      if (!ids?.length) return onClose();
      setPhase('importing');
      await onImport(ids);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'GOOGLE_RECONNECT') onStatusChange();
      setError(err instanceof Error ? err.message : 'Couldn’t open Google Drive. Please try again.');
    } finally {
      setPhase('idle');
    }
  };

  useEffect(() => {
    if (!open) {
      started.current = false;
      setError(null);
      return;
    }
    if (ready && !started.current) {
      started.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready]);

  const connectUrl = api.googleConnectUrl(`${window.location.pathname}${window.location.search}${window.location.search ? '&' : '?'}drive=open`);
  // While Google's picker is on screen, stay out of its way.
  const showModal = open && (!ready || phase !== 'idle' || !!error);

  return (
    <Modal
      open={showModal}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <DriveIcon size={20} /> Google Drive
          {status?.account && <span className="text-sm font-normal text-slate-500">· {status.account.email}</span>}
        </span>
      }
    >
      {!status ? (
        <div className="flex h-40 items-center justify-center">
          <Pending label="Checking your Google connection…" />
        </div>
      ) : !status.configured ? (
        <Notice title="Google isn’t set up on this server yet">
          The person who runs this EventControl server needs to add a Google OAuth client (<code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>). The README section
          “Google Drive” walks through it.
        </Notice>
      ) : !ready ? (
        <Notice
          title={status.connected ? 'Connect Google Drive again' : 'Connect Google Drive'}
          action={
            <a href={connectUrl} className="ec-btn ec-btn-primary inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold">
              Connect Google Drive
            </a>
          }
        >
          {status.connected
            ? 'Your Google account is connected, but Drive access wasn’t allowed. Connect again, and on Google’s page tick the box for Google Drive files (“…only the specific Google Drive files you use with this app”).'
            : 'You’ll choose a Google account and allow EventControl to open the files you pick. It never sees the rest of your Drive. You come straight back here afterwards.'}
        </Notice>
      ) : error ? (
        <Notice
          title="Google Drive didn’t open"
          action={
            <Button variant="primary" onClick={() => void run()}>
              Try again
            </Button>
          }
        >
          {error}
        </Notice>
      ) : (
        <div className="flex h-40 items-center justify-center">
          <Pending label={phase === 'importing' ? 'Importing your files…' : 'Opening Google Drive…'} />
        </div>
      )}
    </Modal>
  );
}

function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <DriveIcon size={36} />
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-slate-400 [&_code]:rounded [&_code]:bg-console-700 [&_code]:px-1 [&_code]:text-[12px]">{children}</p>
      {action}
    </div>
  );
}
