import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Transition } from '@headlessui/react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  warning: (msg: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const MAX_STACK = 4;
const AUTO_DISMISS_MS = 4000;

const ICONS: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  info: InformationCircleIcon,
  warning: ExclamationTriangleIcon,
};

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'border-emerald-500/40 text-emerald-300',
  error: 'border-red-500/40 text-red-300',
  info: 'border-indigo-500/40 text-indigo-300',
  warning: 'border-amber-500/40 text-amber-300',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      idRef.current += 1;
      const id = idRef.current;
      setItems((cur) => {
        const next = [...cur, { id, message, variant }];
        return next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next;
      });
      window.setTimeout(() => remove(id), AUTO_DISMISS_MS);
    },
    [remove]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
      warning: (m) => push('warning', m),
    }),
    [push]
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:top-auto sm:items-end"
      >
        {items.map((t) => (
          <ToastView key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

const ToastView: React.FC<{ toast: ToastItem; onClose: () => void }> = ({
  toast,
  onClose,
}) => {
  const Icon = ICONS[toast.variant];
  const [show, setShow] = useState(false);
  useEffect(() => setShow(true), []);
  return (
    <Transition
      show={show}
      enter="transform transition duration-200 ease-out"
      enterFrom="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
      enterTo="translate-y-0 opacity-100 sm:translate-x-0"
      leave="transition duration-150 ease-in"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <div
        className={clsx(
          'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-[var(--bg-elevated)] px-4 py-3 shadow-lg backdrop-blur',
          VARIANT_CLASSES[toast.variant]
        )}
      >
        <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <p className="flex-1 text-sm text-[var(--text-primary)]">{toast.message}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
          aria-label="Dismiss notification"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </Transition>
  );
};

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}
