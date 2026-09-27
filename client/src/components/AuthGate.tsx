import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
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
}

const AuthContext = createContext<AuthContextValue>({ status: null, signOut: async () => {} });
export const useAuth = () => useContext(AuthContext);

/**
 * Wraps the operator UI. First run: choose a password. Afterwards: sign in.
 * The projector display is deliberately outside this gate.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstLoad = useRef(true);
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

  const signOut = useCallback(async () => {
    clearTabSignedIn();
    announceSignOut();
    await api.logout().catch(() => {});
    await load();
  }, [load]);

  if (error)
    return (
      <Centered>
        <p className="text-slate-300">{error}</p>
        <Button className="mt-4" onClick={load}>
          Retry
        </Button>
      </Centered>
    );
  if (!status)
    return (
      <Centered>
        <Pending label="Opening EventControl…" />
      </Centered>
    );
  if (!status.authenticated) return <SignIn status={status} onDone={load} />;
  return (
    <AuthContext.Provider value={{ status, signOut }}>
      {status.account && <AccountSync key={status.account.email} />}
      {children}
    </AuthContext.Provider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">{children}</div>;
}

function SignIn({ status, onDone }: { status: AuthStatus; onDone: () => Promise<void> }) {
  const setup = status.provider === 'local' && !status.configured;
  const supabase = status.provider === 'supabase';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Coming back from "Continue with Google" with a refusal: show why.
  const [error, setError] = useState<string | null>(() => {
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
        <h1 className="t-page">{setup ? 'Create the operator password' : 'Sign in'}</h1>
        <p className="t-support mt-1.5 mb-5">
          {setup
            ? 'This stops other people on the same Wi-Fi from controlling your projector. You will use it every time you open the dashboard.'
            : supabase
              ? 'Use the email and password you were given. Your events and settings are private to your account.'
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
          {supabase && <p className="t-support">No account yet, or forgot your password? Ask your EventControl administrator.</p>}
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
