import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, Play, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { Button } from './ui/Button';
import { Pending } from './ui/Pending';
import { Field, TextInput } from './ui/Field';
import { api } from '../services/api';
import { AccountSync } from '../lib/accountSync';
import { announceSignOut, clearTabSignedIn, markTabSignedIn, onSignOutElsewhere, tabIsSignedIn } from '../lib/tabSession';
import type { AuthStatus } from '../types';

interface AuthContextValue {
  status: AuthStatus | null;
  signOut: () => Promise<void>;
  /** Re-reads the sign-in status (e.g. after approving someone: the waiting count). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({ status: null, signOut: async () => {}, refresh: async () => {} });
export const useAuth = () => useContext(AuthContext);

/**
 * Wraps the operator UI. First run: choose a password. Afterwards: sign in.
 * The projector display is deliberately outside this gate.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstLoad = useRef(true);
  const [demoEnded, setDemoEnded] = useState(false);
  const statusRef = useRef<AuthStatus | null>(null);
  const load = useCallback(async () => {
    try {
      // Back from "Continue with Google": this tab has just signed in.
      if (firstLoad.current && new URLSearchParams(window.location.search).get('google') === 'signed-in') markTabSignedIn();
      firstLoad.current = false;
      let next = await api.authStatus();
      // A sign-in left over from a tab that was closed doesn't count: sign in again.
      if (next.enabled && next.authenticated && !(await tabIsSignedIn())) {
        await api.logout().catch(() => {});
        next = await api.authStatus();
      }
      if (next.enabled && !next.authenticated) clearTabSignedIn();
      // A demo that just ran out: the sign-in page says so and offers Request access.
      if (next.authenticated) setDemoEnded(false);
      else if (statusRef.current?.account?.demoEndsAt) setDemoEnded(true);
      statusRef.current = next;
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot reach the server.');
    }
  }, []);

  useEffect(() => {
    void load();
    const onExpired = () => void load();
    window.addEventListener('eventcontrol:unauthenticated', onExpired);
    const stopListening = onSignOutElsewhere(() => {
      clearTabSignedIn();
      void load();
    });
    return () => {
      window.removeEventListener('eventcontrol:unauthenticated', onExpired);
      stopListening();
    };
  }, [load]);

  // An open console notices within a few minutes when its sign-in ends (expired, or the account
  // was removed), even without clicking anything.
  const signedIn = !!status?.enabled && status.authenticated;
  useEffect(() => {
    if (!signedIn) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .authStatus()
        .then((s) => !s.authenticated && void load())
        .catch(() => {});
    };
    const timer = window.setInterval(check, 2 * 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [signedIn, load]);

  // A demo ends on the minute: show the sign-in page (with Request access) right then.
  const demoEndsAt = status?.account?.demoEndsAt;
  useEffect(() => {
    if (!demoEndsAt) return;
    const t = window.setTimeout(() => void load(), Math.max(0, demoEndsAt - Date.now()) + 1500);
    return () => window.clearTimeout(t);
  }, [demoEndsAt, load]);

  const signOut = useCallback(async () => {
    clearTabSignedIn();
    announceSignOut();
    await api.logout().catch(() => {});
    await load();
  }, [load]);

  // "Try the demo": a private guest account with its own copy of the sample show, opened
  // straight on its console. /demo starts one by itself — the link to share on a profile.
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [demoStarting, setDemoStarting] = useState(false);
  const startDemo = useCallback(async () => {
    setDemoStarting(true);
    try {
      const { eventId } = await api.startDemo();
      markTabSignedIn();
      navigate(`/events/${eventId}`, { replace: true });
      await load();
    } finally {
      setDemoStarting(false);
    }
  }, [load, navigate]);
  const [demoError, setDemoError] = useState<string | null>(null);
  const autoDemo = useRef(false);
  useEffect(() => {
    if (!status || pathname !== '/demo') return;
    if (status.authenticated || !status.demo) {
      navigate('/', { replace: true });
      return;
    }
    if (autoDemo.current) return;
    autoDemo.current = true;
    startDemo().catch((err) => {
      setDemoError(err instanceof Error ? err.message : 'Couldn’t start the demo.');
      navigate('/', { replace: true });
    });
  }, [status, pathname, navigate, startDemo]);

  if (error)
    return (
      <Centered>
        <p className="text-slate-300">{error}</p>
        <Button className="mt-4" onClick={load}>
          Retry
        </Button>
      </Centered>
    );
  if (!status || demoStarting || (pathname === '/demo' && !status.authenticated && status.demo && !demoError))
    return (
      <Centered>
        <Pending label={demoStarting || pathname === '/demo' ? 'Setting up your demo…' : 'Opening EventControl…'} />
      </Centered>
    );
  if (!status.authenticated) return <SignIn status={status} onDone={load} onDemo={startDemo} initialError={demoError} demoEnded={demoEnded} />;
  return (
    <AuthContext.Provider value={{ status, signOut, refresh: load }}>
      {status.account && <AccountSync key={status.account.email} />}
      {children}
      {status.account?.demoEndsAt && <DemoBanner endsAt={status.account.demoEndsAt} onEnd={signOut} />}
    </AuthContext.Provider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>;
}

function SignIn({
  status,
  onDone,
  onDemo,
  initialError,
  demoEnded,
}: {
  status: AuthStatus;
  onDone: () => Promise<void>;
  onDemo: () => Promise<void>;
  initialError: string | null;
  demoEnded: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (asking && status.access) return <RequestAccess verify={status.access.verify} onBack={() => setAsking(false)} />;
  return <SignInForm status={status} onDone={onDone} onDemo={onDemo} initialError={initialError} demoEnded={demoEnded} onAsk={status.access ? () => setAsking(true) : undefined} />;
}

function SignInForm({
  status,
  onDone,
  onDemo,
  initialError,
  demoEnded,
  onAsk,
}: {
  status: AuthStatus;
  onDone: () => Promise<void>;
  onDemo: () => Promise<void>;
  initialError: string | null;
  demoEnded: boolean;
  onAsk?: () => void;
}) {
  const setup = status.provider === 'local' && !status.configured;
  const supabase = status.provider === 'supabase';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Coming back from "Continue with Google" with a refusal: show why.
  const [error, setError] = useState<string | null>(() => {
    if (initialError) return initialError;
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google');
    return result && result !== 'signed-in' && result !== 'connected' ? (params.get('message') ?? 'Google sign-in didn’t complete. Please try again.') : null;
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = setup ? 'Set up · EventControl' : 'Sign in · EventControl';
  }, [setup]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup) {
      if (password.length < 6) return setError('Use at least 6 characters.');
      if (password !== confirm) return setError('The passwords do not match.');
    }
    setBusy(true);
    try {
      if (setup) await api.setupPassword(password);
      else await api.login(password, supabase ? email : undefined);
      markTabSignedIn();
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <form onSubmit={submit} className="ec-card ec-modal-in w-full max-w-sm rounded-lg p-6 text-left">
        <div className="mb-5 flex items-center justify-between">
          <BrandMark />
          <KeyRound size={18} className="text-slate-500" />
        </div>
        {demoEnded && (
          <div className="mb-5 rounded-md border border-[var(--line-strong)] bg-[var(--surface-2,transparent)] px-3.5 py-3 text-[13px] text-slate-300">
            <p className="font-semibold text-white">Your demo has ended.</p>
            <p className="mt-0.5">{onAsk ? 'Liked it? Request access to get your own account, or start another demo.' : 'Start another demo any time.'}</p>
          </div>
        )}
        <h1 className="t-page">{setup ? 'Create the operator password' : 'Sign in'}</h1>
        <p className="t-support mt-1.5 mb-5">
          {setup
            ? 'This stops other people on the same Wi-Fi from controlling your projector. You will use it every time you open the dashboard.'
            : supabase
              ? 'Sign in with your email and password. Your events and settings are private to your account.'
              : 'Sign in to control the display.'}
        </p>
        <div className="grid gap-3">
          {supabase && (
            <Field label="Email">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
            </Field>
          )}
          <Field label={setup ? 'New password' : 'Password'}>
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? 'new-password' : 'current-password'} autoFocus={!supabase} required />
          </Field>
          {setup && (
            <Field label="Repeat password">
              <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </Field>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="mt-1 h-11" disabled={busy}>
            {busy ? 'Please wait…' : setup ? 'Save password & continue' : 'Sign in'}
          </Button>
          {!setup && status.google && (
            <>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="h-px flex-1 bg-[var(--line)]" /> or <span className="h-px flex-1 bg-[var(--line)]" />
              </div>
              <a href={api.googleSignInUrl()} className="ec-btn ec-btn-secondary flex h-11 items-center justify-center gap-2.5 rounded-md text-sm font-semibold">
                <GoogleG /> Continue with Google
              </a>
            </>
          )}
          {supabase &&
            (onAsk ? (
              <p className="t-support">
                No account yet?{' '}
                <button type="button" onClick={onAsk} className="font-semibold text-[var(--accent-500)] hover:underline">
                  Request access
                </button>
                . Forgot your password? Ask your EventControl administrator.
              </p>
            ) : (
              <p className="t-support">No account yet, or forgot your password? Ask your EventControl administrator.</p>
            ))}
          {!setup && status.demo && (
            <div className="mt-2 border-t ec-line pt-4">
              <Button
                type="button"
                size="lg"
                className="h-11 w-full"
                icon={<Play size={15} />}
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  setBusy(true);
                  try {
                    await onDemo();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Couldn’t start the demo.');
                    setBusy(false);
                  }
                }}
              >
                Try the demo
              </Button>
              <p className="t-support mt-2 text-center">
                No account needed: your own private copy of a sample event for {status.demoMinutes ?? 10} minutes.
              </p>
            </div>
          )}
          {!setup && status.provider === 'local' && (
            <p className="text-xs text-slate-500">
              Forgot it? Stop the app and run <code className="text-slate-300">npm run reset-password</code>.
            </p>
          )}
        </div>
      </form>
    </Centered>
  );
}

/**
 * "Request access": name, email and a password of their choice → (when email is set up) a
 * 6-digit code sent to that email → waiting for the administrator's approval.
 */
function RequestAccess({ verify, onBack }: { verify: boolean; onBack: () => void }) {
  const [step, setStep] = useState<'form' | 'code' | 'done'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Request access · EventControl';
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters for the password.');
    if (password !== confirm) return setError('The passwords do not match.');
    void run(async () => {
      const res = await api.requestAccess({ name, email, password });
      setStep(res.verify ? 'code' : 'done');
    });
  };
  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.verifyAccess(email, code);
      setStep('done');
    });
  };

  return (
    <Centered>
      <div className="ec-card ec-modal-in w-full max-w-sm rounded-lg p-6 text-left">
        <div className="mb-5 flex items-center justify-between">
          <BrandMark />
          <KeyRound size={18} className="text-slate-500" />
        </div>
        {step === 'form' && (
          <form onSubmit={submit}>
            <h1 className="t-page">Request access</h1>
            <p className="t-support mt-1.5 mb-5">
              Choose the email and password you’ll sign in with.{verify ? ' We’ll email you a code to confirm the address.' : ''} The administrator approves each
              account.
            </p>
            <div className="grid gap-3">
              <Field label="Your name">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus required maxLength={80} />
              </Field>
              <Field label="Email">
                <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </Field>
              <Field label="Password (at least 8 characters)">
                <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
              </Field>
              <Field label="Repeat password">
                <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
              </Field>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" variant="primary" size="lg" className="mt-1 h-11" disabled={busy}>
                {busy ? 'Please wait…' : 'Request access'}
              </Button>
              <p className="t-support">Your password goes straight to the sign-in service: nobody, the administrator included, can see it.</p>
            </div>
          </form>
        )}
        {step === 'code' && (
          <form onSubmit={submitCode}>
            <h1 className="t-page">Check your email</h1>
            <p className="t-support mt-1.5 mb-5">
              We sent a 6-digit code to <span className="font-semibold text-slate-200">{email}</span>. It may take a minute, and can land in spam.
            </p>
            <div className="grid gap-3">
              <Field label="Code">
                <TextInput
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  className="t-num text-center text-[20px] tracking-[0.4em]"
                />
              </Field>
              {error && <p className="text-sm text-red-400">{error}</p>}
              {note && <p className="text-sm text-emerald-400">{note}</p>}
              <Button type="submit" variant="primary" size="lg" className="mt-1 h-11" disabled={busy || code.length !== 6}>
                {busy ? 'Please wait…' : 'Confirm'}
              </Button>
              <button
                type="button"
                className="t-support text-left hover:underline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.resendAccessCode(email);
                    setNote('A new code is on its way.');
                  })
                }
              >
                Didn’t get it? Send a new code
              </button>
            </div>
          </form>
        )}
        {step === 'done' && (
          <div>
            <h1 className="t-page">Request sent</h1>
            <p className="t-support mt-1.5 mb-5">
              The administrator will review it. {verify ? 'You’ll get an email when it’s approved; then' : 'Once it’s approved,'} sign in with{' '}
              <span className="font-semibold text-slate-200">{email}</span> and the password you chose.
            </p>
          </div>
        )}
        <Button size="sm" variant="ghost" className="mt-4" onClick={onBack}>
          ← Back to sign in
        </Button>
      </div>
    </Centered>
  );
}

/**
 * On arrival, a short note that this is a temporary demo and how long it lasts. It steps
 * aside by itself after a few seconds so it never covers the console; the account corner of
 * the rail keeps saying "Demo".
 */
function DemoBanner({ endsAt, onEnd }: { endsAt: number; onEnd: () => void }) {
  const [hidden, setHidden] = useState(false);
  const [lastMinute, setLastMinute] = useState(false);
  useEffect(() => {
    const hide = window.setTimeout(() => setHidden(true), 12_000);
    // Back once more with a minute to go, so the end isn't a surprise.
    const warn = window.setTimeout(() => {
      setLastMinute(true);
      setHidden(false);
    }, Math.max(0, endsAt - Date.now() - 60_000));
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(warn);
    };
  }, [endsAt]);
  if (hidden) return null;
  const minutes = lastMinute ? 1 : Math.max(0, Math.round((endsAt - Date.now()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const left = h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
  return (
    <div role="status" className="ec-card ec-modal-in fixed bottom-4 left-1/2 z-40 flex w-[min(34rem,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-md py-2 pr-2 pl-3.5 text-[13px] shadow-lg">
      <span className="ec-label shrink-0 text-[var(--accent-500)]">Demo</span>
      <span className="min-w-0 flex-1 text-slate-300">{lastMinute ? 'One minute left in your demo.' : `Your private copy: try anything. It’s deleted in ${left}.`}</span>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={onEnd}>
        End demo
      </Button>
      <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={() => setHidden(true)} aria-label="Hide" title="Hide">
        <X size={14} />
      </Button>
    </div>
  );
}

/** Google's "G", drawn inline (brand guidelines ask for the original colours). */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
