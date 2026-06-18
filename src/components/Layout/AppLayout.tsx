import React, { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { useRouteGuard } from '../../hooks/useRouteGuard';
import { Sidebar } from './Sidebar';
import { UserMenu } from './UserMenu';

export interface AppLayoutProps {
  children: React.ReactNode;
}

const FullScreenSpinner: React.FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)]">
    <svg
      className="h-8 w-8 animate-spin text-[var(--accent)]"
      viewBox="0 0 24 24"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" fill="none" />
    </svg>
  </div>
);

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { loading, user } = useRouteGuard({ require: 'auth' });
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) return <FullScreenSpinner />;
  if (!user) return null; // Guard redirected.

  return (
    <div className="flex min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-shrink-0 border-r border-[var(--border)] lg:block">
        <Sidebar user={user} />
      </aside>

      {/* Mobile slide-over */}
      <Transition show={mobileOpen} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-40 lg:hidden"
          onClose={setMobileOpen}
        >
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/60" />
          </Transition.Child>
          <Transition.Child
            as={Fragment}
            enter="transition ease-out duration-200 transform"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition ease-in duration-150 transform"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
          >
            <Dialog.Panel className="fixed inset-y-0 left-0 flex w-72 flex-col">
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
                className="absolute right-3 top-3 z-10 rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
              <Sidebar user={user} onNavigate={() => setMobileOpen(false)} />
            </Dialog.Panel>
          </Transition.Child>
        </Dialog>
      </Transition>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-base)]/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] lg:hidden"
              aria-label="Open navigation"
            >
              <Bars3Icon className="h-5 w-5" />
            </button>
          </div>
          <UserMenu user={user} />
        </header>
        <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
