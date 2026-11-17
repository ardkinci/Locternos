import type { ReactNode } from 'react';

export const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500';

export const buttonClass =
  'rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButtonClass =
  'rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

export const dangerButtonClass =
  'rounded-md border border-rose-800 px-3 py-2 text-sm text-rose-300 transition hover:bg-rose-950 disabled:cursor-not-allowed disabled:opacity-50';

export const cardClass = 'rounded-lg border border-slate-800 bg-slate-900/60 p-4';

export const labelClass = 'block text-sm font-medium text-slate-300';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Centered dialog used for confirmations and forms. */
export function Modal({ title, onClose, children, footer }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="border-t border-slate-800 px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

/** Label plus control with an optional hint line. */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="block space-y-1">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

interface StatusBadgeProps {
  status: string;
}

/** Colored badge for the server lifecycle status. */
export function StatusBadge({ status }: StatusBadgeProps) {
  const tone: Record<string, string> = {
    running: 'bg-emerald-500/15 text-emerald-300 border-emerald-700',
    starting: 'bg-amber-500/15 text-amber-300 border-amber-700',
    stopping: 'bg-amber-500/15 text-amber-300 border-amber-700',
    crashed: 'bg-rose-500/15 text-rose-300 border-rose-700',
    stopped: 'bg-slate-700/40 text-slate-300 border-slate-600',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
        tone[status] ?? tone.stopped
      }`}
    >
      {status}
    </span>
  );
}
