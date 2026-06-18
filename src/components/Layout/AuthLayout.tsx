import React from 'react';
import { ThemeToggle } from '../ui/ThemeToggle';
import { GrooveMark } from '../ui/Logo';

export interface AuthLayoutProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({
  children,
  title,
  subtitle,
}) => (
  <div className="relative flex min-h-screen items-center justify-center bg-[var(--bg-base)] px-4 py-12 text-[var(--text-primary)]">
    <div className="absolute right-4 top-4">
      <ThemeToggle />
    </div>
    <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[var(--accent-soft)] via-transparent to-[var(--accent-soft)]" />
    <div className="w-full max-w-md">
      <div className="mb-8 flex flex-col items-center">
        <GrooveMark className="mb-3 h-14 w-14 text-[var(--accent)]" title="Overhearr" />
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {title ?? 'Welcome to Overhearr'}
        </h1>
        {subtitle && (
          <p className="mt-2 text-center text-sm text-[var(--text-secondary)]">
            {subtitle}
          </p>
        )}
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6 shadow-xl">
        {children}
      </div>
    </div>
  </div>
);

export default AuthLayout;
