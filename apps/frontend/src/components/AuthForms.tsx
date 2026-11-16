import { useState, type FormEvent } from 'react';
import type { User } from '@locternos/shared';
import { api, ApiError } from '../lib/api';

const MIN_PASSWORD_LENGTH = 8;

const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500';
const buttonClass =
  'w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50';

interface FormProps {
  onAuthenticated: (user: User) => void;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto mt-16 max-w-sm p-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-6 space-y-4">{children}</div>
    </main>
  );
}

/** First-run form: creates the single Admin account. */
export function SetupForm({ onAuthenticated }: FormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { user } = await api.setup({ email, password });
      onAuthenticated(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Setup is already complete. Reload the page to sign in.');
      } else if (err instanceof ApiError && err.status === 400) {
        setError('Enter a valid email address.');
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Create the admin account">
      <p className="text-sm text-slate-400">
        First run: this account will manage every server on this panel.
      </p>
      <form className="space-y-4" onSubmit={onSubmit}>
        <input
          className={inputClass}
          type="email"
          name="email"
          autoComplete="email"
          placeholder="Email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={inputClass}
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder={`Password (min ${MIN_PASSWORD_LENGTH} characters)`}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          className={inputClass}
          type="password"
          name="confirm"
          autoComplete="new-password"
          placeholder="Repeat password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className={buttonClass} type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create admin account'}
        </button>
      </form>
    </AuthCard>
  );
}

/** Sign-in form for an existing Admin. */
export function LoginForm({ onAuthenticated }: FormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login({ email, password });
      onAuthenticated(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid email or password.');
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Sign in">
      <form className="space-y-4" onSubmit={onSubmit}>
        <input
          className={inputClass}
          type="email"
          name="email"
          autoComplete="email"
          placeholder="Email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={inputClass}
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className={buttonClass} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  );
}
