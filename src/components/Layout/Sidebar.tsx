import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  HomeIcon,
  MagnifyingGlassIcon,
  QueueListIcon,
  Cog6ToothIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import Image from 'next/image';
import type { PublicUser } from '../../types/api';

export interface SidebarNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

export const NAV_ITEMS: SidebarNavItem[] = [
  { href: '/', label: 'Discover', icon: HomeIcon },
  { href: '/search', label: 'Search', icon: MagnifyingGlassIcon },
  { href: '/requests', label: 'Requests', icon: QueueListIcon },
  { href: '/settings', label: 'Settings', icon: Cog6ToothIcon, adminOnly: true },
  { href: '/users', label: 'Users', icon: UsersIcon, adminOnly: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const Sidebar: React.FC<{
  user: PublicUser | null;
  onNavigate?: () => void;
}> = ({ user, onNavigate }) => {
  const router = useRouter();
  const isAdmin = user?.role === 'ADMIN';
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-elevated)]">
      <div className="flex h-16 items-center gap-3 border-b border-[var(--border)] px-5">
        <Image
          src="/overhearr.png"
          alt="Overhearr"
          width={32}
          height={32}
          className="h-8 w-8"
          priority
        />
        <span className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
          Overhearr
        </span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(router.pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={clsx(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                active
                  ? 'bg-indigo-600/15 text-indigo-300'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'
              )}
            >
              <Icon
                className={clsx(
                  'h-5 w-5',
                  active
                    ? 'text-indigo-300'
                    : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--text-muted)]">
        Overhearr v1
      </div>
    </div>
  );
};

export default Sidebar;
