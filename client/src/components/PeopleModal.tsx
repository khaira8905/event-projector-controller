import { useCallback, useEffect, useState } from 'react';
import { Check, MailCheck, MailQuestion, Trash2, X } from 'lucide-react';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Modal } from './ui/Modal';
import { Pending } from './ui/Pending';
import { useToast } from './ui/Toast';
import { useAuth } from './AuthGate';
import { api } from '../services/api';
import type { Person } from '../types';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');

/**
 * The administrator's People list: requests to approve or decline, and everyone with an
 * account, who can be removed at any time (their login, events and files are deleted).
 */
export function PeopleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { status, refresh } = useAuth();
  const me = status?.account?.email;
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Person | null>(null);

  const load = useCallback(async () => {
    try {
      setPeople(await api.listPeople());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t load people.');
    }
  }, []);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const approve = async (p: Person) => {
    setBusy(p.id);
    try {
      await api.approvePerson(p.id);
      toast.success(`${p.name || p.email} can now sign in.`);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t approve.');
    } finally {
      setBusy(null);
    }
  };
  const remove = async (p: Person) => {
    await api.removePerson(p.id);
    toast.success(p.status === 'pending' ? `Declined ${p.name || p.email}.` : `Removed ${p.name || p.email}.`);
    await Promise.all([load(), refresh()]);
  };

  const requests = people?.filter((p) => p.status === 'pending') ?? [];
  const members = people?.filter((p) => p.status === 'active') ?? [];

  return (
    <>
      <Modal open={open} onClose={onClose} title="People" size="lg">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!people && !error && <Pending label="Loading…" />}
        {people && (
          <div className="grid gap-6">
            <section>
              <h3 className="ec-label mb-2">Asking for access · {requests.length}</h3>
              {requests.length === 0 ? (
                <p className="t-support">No requests right now. People ask from the sign-in page (Request access).</p>
              ) : (
                <ul className="divide-y divide-[var(--line)] border-y ec-line">
                  {requests.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-white">{p.name || p.email}</p>
                        <p className="t-support flex flex-wrap items-center gap-x-2 truncate">
                          <span className="truncate">{p.email}</span>
                          {p.awaitingCode ? (
                            <span className="inline-flex items-center gap-1 text-amber-400">
                              <MailQuestion size={13} /> hasn’t entered the email code yet
                            </span>
                          ) : p.emailVerified ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400">
                              <MailCheck size={13} /> email confirmed
                            </span>
                          ) : (
                            <span className="text-slate-500">email not checked</span>
                          )}
                          <span className="text-slate-500">· asked {when(p.requestedAt)}</span>
                        </p>
                      </div>
                      <Button size="sm" variant="primary" icon={<Check size={14} />} disabled={busy === p.id || p.awaitingCode} onClick={() => approve(p)}>
                        Approve
                      </Button>
                      <Button size="sm" icon={<X size={14} />} disabled={busy === p.id} onClick={() => setRemoving(p)}>
                        Decline
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="ec-label mb-2">With an account · {members.length}</h3>
              <ul className="divide-y divide-[var(--line)] border-y ec-line">
                {members.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-white">
                        {p.name || p.email}
                        {p.email === me && <span className="ml-2 text-[12px] font-normal text-slate-500">(you)</span>}
                      </p>
                      <p className="t-support truncate">
                        {p.email} · {p.events} event{p.events === 1 ? '' : 's'} · last sign-in {when(p.lastLoginAt)}
                      </p>
                    </div>
                    {p.email !== me && (
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setRemoving(p)}>
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!removing}
        title={removing?.status === 'pending' ? 'Decline this request?' : 'Remove this person?'}
        message={
          removing?.status === 'pending'
            ? `${removing?.email} won’t be able to sign in. They can ask again later.`
            : `${removing?.email} is signed out within a couple of minutes and can’t sign in again. Their ${removing?.events ?? 0} event(s) and files are deleted.`
        }
        confirmLabel={removing?.status === 'pending' ? 'Decline' : 'Remove'}
        onConfirm={() => remove(removing!)}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}
