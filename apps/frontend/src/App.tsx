import { useEffect, useState } from 'react';
import type { User } from '@locternos/shared';
import { Dashboard } from './components/Dashboard';
import { LoginForm, SetupForm } from './components/AuthForms';
import { api, ApiError } from './lib/api';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'setup' }
  | { kind: 'login' }
  | { kind: 'ready'; user: User };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  // Decide which screen to show: first-run setup, sign-in, or the dashboard.
  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const { setupRequired } = await api.setupStatus();
        if (!active) return;
        if (setupRequired) {
          setPhase({ kind: 'setup' });
          return;
        }
        const { user } = await api.me();
        if (active) setPhase({ kind: 'ready', user });
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          setPhase({ kind: 'login' });
        } else {
          setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    try {
      await api.logout();
    } finally {
      // Even if the request failed, the user should not stay on the dashboard.
      setPhase({ kind: 'login' });
    }
  }

  const signedIn = (user: User) => setPhase({ kind: 'ready', user });

  switch (phase.kind) {
    case 'loading':
      return <p className="p-8 text-slate-400">Loading…</p>;
    case 'error':
      return <p className="p-8 text-rose-400">Could not reach the panel: {phase.message}</p>;
    case 'setup':
      return <SetupForm onAuthenticated={signedIn} />;
    case 'login':
      return <LoginForm onAuthenticated={signedIn} />;
    case 'ready':
      return <Dashboard user={phase.user} onLogout={signOut} />;
  }
}
