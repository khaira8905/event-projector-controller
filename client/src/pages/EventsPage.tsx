import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Film, ListVideo, MapPin, MonitorPlay, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useAuth } from '../components/AuthGate';
import { PeopleModal } from '../components/PeopleModal';
import { BrandMark } from '../components/BrandMark';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { EventFormModal } from '../components/EventFormModal';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toast';
import { api } from '../services/api';
import { todayIso } from '../lib/format';
import type { EventInput, EventSummary } from '../types';

export default function EventsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EventSummary | null>(null);
  const [deleting, setDeleting] = useState<EventSummary | null>(null);
  const account = useAuth().status?.account;
  const [peopleOpen, setPeopleOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvents(await api.listEvents());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load events.');
    }
  }, []);

  useEffect(() => {
    document.title = 'Events · EventControl';
    void load();
  }, [load]);

  const save = async (input: EventInput) => {
    if (editing) {
      await api.updateEvent(editing.id, input);
      toast.success('Event updated.');
      await load();
    } else {
      const created = await api.createEvent(input);
      toast.success('Event created.');
      navigate(`/events/${created.id}`);
    }
  };

  const today = todayIso();
  const upcoming = events?.filter((e) => e.date >= today) ?? [];
  const past = events?.filter((e) => e.date < today) ?? [];

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-console-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <BrandMark />
          <div className="flex items-center gap-1.5">
          <ThemeSwitcher />
          {account?.admin && (
            <Button
              variant="ghost"
              icon={<Users size={16} />}
              onClick={() => setPeopleOpen(true)}
              title={peopleSummary(account.pendingRequests ?? 0, account.awaitingCode ?? 0) || 'People'}
              aria-label={`People${peopleSummary(account.pendingRequests ?? 0, account.awaitingCode ?? 0) ? `: ${peopleSummary(account.pendingRequests ?? 0, account.awaitingCode ?? 0)}` : ''}`}
            >
              People
              {/* Filled: ready to approve. Outlined: still waiting for their email code. */}
              {!!account.pendingRequests && (
                <span className="ml-1 rounded-full bg-[var(--accent-500)] px-1.5 text-[11px] leading-[18px] font-semibold text-[var(--on-accent)]">{account.pendingRequests}</span>
              )}
              {!!account.awaitingCode && (
                <span className="ml-1 rounded-full border border-[var(--line-strong)] px-1.5 text-[11px] leading-[16px] font-semibold text-slate-400">{account.awaitingCode}</span>
              )}
            </Button>
          )}
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Create Event
          </Button>
          </div>
        </div>
      </header>

      <PeopleModal open={peopleOpen} onClose={() => setPeopleOpen(false)} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="ec-panel-in mb-10">
          <h1 className="text-[32px] leading-tight font-bold tracking-[-0.02em] text-white">Events</h1>
          <p className="mt-1.5 max-w-xl text-[15px] text-slate-400">Open an event to run its presentations, projector display and timer.</p>
          {events && events.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              <Stat value={upcoming.length} label="upcoming" />
              <Stat value={past.length} label="past" />
              <Stat value={events.reduce((n, e) => n + (e.counts?.media ?? 0), 0)} label="files" />
            </div>
          )}
        </div>

        {loadError && (
          <div className="mb-6 flex items-center justify-between rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {loadError}
            <Button size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {events === null && !loadError && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="ec-card ec-skeleton h-52 rounded-md" />
            ))}
          </div>
        )}

        {events && events.length === 0 && (
          <div className="ec-card ec-panel-in flex flex-col items-center rounded-lg px-6 py-20 text-center">
            <span className="relative flex h-20 w-20 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-400/25 ring-inset">
              <span className="absolute inset-0 rounded-lg bg-sky-500/20 blur-2xl" />
              <MonitorPlay size={36} className="relative" />
            </span>
            <h2 className="mt-6 font-display text-2xl font-semibold text-white">No events yet</h2>
            <p className="mt-1 max-w-sm text-sm text-slate-400">Create your first event, upload slides and videos, and control the projector from one place.</p>
            <Button variant="primary" className="mt-6" icon={<Plus size={16} />} onClick={() => setFormOpen(true)}>
              Create Event
            </Button>
          </div>
        )}

        {upcoming.length > 0 && <EventGrid title="Upcoming" events={upcoming} onEdit={(e) => (setEditing(e), setFormOpen(true))} onDelete={setDeleting} />}
        {past.length > 0 && <EventGrid title="Past" events={past} onEdit={(e) => (setEditing(e), setFormOpen(true))} onDelete={setDeleting} />}
      </main>

      <EventFormModal open={formOpen} event={editing} onClose={() => setFormOpen(false)} onSubmit={save} />
      <ConfirmDialog
        open={!!deleting}
        title="Delete event?"
        message={
          <>
            <b className="text-white">{deleting?.name}</b> and all of its media, queue and schedule will be permanently deleted.
          </>
        }
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api.deleteEvent(deleting.id);
            toast.success('Event deleted.');
            await load();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Unable to delete event.');
          }
        }}
      />
    </div>
  );
}

function EventGrid({
  title,
  events,
  onEdit,
  onDelete,
}: {
  title: string;
  events: EventSummary[];
  onEdit: (e: EventSummary) => void;
  onDelete: (e: EventSummary) => void;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 flex items-center gap-3 font-mono text-[11px] font-medium tracking-[0.22em] text-slate-500 uppercase">
        {title}
        <span className="text-slate-600">{String(events.length).padStart(2, '0')}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
      </h2>
      <div className="ec-stagger grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {events.map((event) => (
          <EventCard key={event.id} event={event} onEdit={() => onEdit(event)} onDelete={() => onDelete(event)} />
        ))}
      </div>
    </section>
  );
}

function EventCard({ event, onEdit, onDelete }: { event: EventSummary; onEdit: () => void; onDelete: () => void }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const isToday = event.date === todayIso();

  const date = new Date(`${event.date}T00:00:00`);
  const month = date.toLocaleDateString(undefined, { month: 'short' });
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const open = () => navigate(`/events/${event.id}`);

  return (
    <article
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, a')) open();
      }}
      className="ec-card ec-spot group flex cursor-pointer flex-col rounded-lg p-5 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1.5"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-md bg-white/[0.04] ring-1 ring-white/[0.08] ring-inset transition-colors duration-300 group-hover:bg-sky-500/15 group-hover:ring-sky-400/30">
          <span className="font-mono text-[10px] font-semibold tracking-[0.18em] text-sky-300 uppercase">{month}</span>
          <span className="font-display text-2xl leading-none font-bold text-white">{date.getDate()}</span>
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {weekday}
            {isToday && (
              <Badge tone="live" dot>
                Today
              </Badge>
            )}
          </div>
          <h3 className="mt-1 font-display text-xl leading-snug font-semibold tracking-[-0.01em] text-white">{event.name}</h3>
          {event.venue && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
              <MapPin size={13} className="shrink-0" /> <span className="truncate">{event.venue}</span>
            </p>
          )}
        </div>
        <div className="relative -mt-1 -mr-1">
          <Button variant="ghost" size="icon-sm" aria-label="Event actions" onClick={() => setMenuOpen((o) => !o)}>
            <MoreHorizontal size={16} />
          </Button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="ec-card ec-card-raised ec-pop-in absolute right-0 z-20 mt-1 w-36 origin-top-right overflow-hidden rounded-md py-1">
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5" onClick={() => (setMenuOpen(false), onEdit())}>
                  <Pencil size={14} /> Edit
                </button>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-300 hover:bg-red-500/10" onClick={() => (setMenuOpen(false), onDelete())}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-relaxed text-slate-400">{event.description || 'No description.'}</p>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
        <div className="flex gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Film size={13} /> {event.counts?.media ?? 0} files
          </span>
          <span className="flex items-center gap-1">
            <ListVideo size={13} /> {event.counts?.queueItems ?? 0} in flow
          </span>
        </div>
        <Button variant="primary" size="sm" onClick={open} className="pr-2.5">
          Open
          <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover/btn:translate-x-1" />
        </Button>
      </div>
    </article>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg bg-white/[0.03] px-3 py-1.5 ring-1 ring-white/[0.06] ring-inset">
      <span className="font-display text-lg font-semibold text-white tabular-nums">{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </span>
  );
}

/** "2 to approve · 1 waiting for their email code" — empty when nobody is waiting. */
export function peopleSummary(ready: number, awaitingCode: number) {
  return [ready ? `${ready} to approve` : '', awaitingCode ? `${awaitingCode} waiting for their email code` : ''].filter(Boolean).join(' · ');
}
