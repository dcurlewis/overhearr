import React, { Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Menu, Transition } from '@headlessui/react';
import {
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { Avatar } from '../ui/Avatar';
import { ThemeToggle } from '../ui/ThemeToggle';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../ui/Toast';
import type { PublicUser } from '../../types/api';

export const UserMenu: React.FC<{ user: PublicUser }> = ({ user }) => {
  const { logout } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Signed out');
      router.replace('/login');
    } catch {
      toast.error('Failed to sign out');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <ThemeToggle />
      <Menu as="div" className="relative">
        <Menu.Button className="flex items-center gap-2 rounded-full p-1 transition hover:bg-[var(--bg-elevated)]">
          <Avatar name={user.username} size="md" />
          <span className="hidden pr-2 text-sm font-medium text-[var(--text-primary)] sm:inline">
            {user.username}
          </span>
        </Menu.Button>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <Menu.Items className="absolute right-0 mt-2 w-56 origin-top-right rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-lg focus:outline-none">
            <div className="border-b border-[var(--border)] px-3 py-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {user.username}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {user.role === 'ADMIN' ? 'Administrator' : 'User'}
              </p>
            </div>
            <Menu.Item>
              {({ active }) => (
                <Link
                  href="/profile"
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-2 text-sm',
                    active
                      ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                  )}
                >
                  <UserCircleIcon className="h-4 w-4" />
                  Profile
                </Link>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <button
                  type="button"
                  onClick={handleLogout}
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                    active
                      ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                  )}
                >
                  <ArrowRightOnRectangleIcon className="h-4 w-4" />
                  Sign out
                </button>
              )}
            </Menu.Item>
          </Menu.Items>
        </Transition>
      </Menu>
    </div>
  );
};

export default UserMenu;
