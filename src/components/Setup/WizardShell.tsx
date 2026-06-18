import React from 'react';
import clsx from 'clsx';
import { CheckIcon } from '@heroicons/react/24/solid';
import {
  STEP_TITLES,
  VISIBLE_STEPS,
  type SetupStep,
} from './setupMachine';

interface WizardShellProps {
  current: SetupStep;
  /** Step heading rendered above the children. */
  heading: string;
  /** Optional one-line description shown beneath the heading. */
  description?: string;
  children: React.ReactNode;
}

const STEP_LABELS: Record<Exclude<SetupStep, 'done'>, string> = {
  admin: 'Admin',
  'lidarr-connection': 'Lidarr',
  'lidarr-profiles': 'Profiles',
};

/**
 * Renders the step indicator (numbered dots + connector lines) plus the
 * active step's body. The "done" step still uses this shell so the user
 * sees a polished finalising state.
 */
export const WizardShell: React.FC<WizardShellProps> = ({
  current,
  heading,
  description,
  children,
}) => {
  // For indicator highlighting, treat `done` as "past the last visible step".
  const currentIndex =
    current === 'done'
      ? VISIBLE_STEPS.length
      : VISIBLE_STEPS.indexOf(current);
  const total = VISIBLE_STEPS.length;
  const stepNumber = current === 'done' ? total : currentIndex + 1;

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex items-center justify-between" aria-label="Setup progress">
        {VISIBLE_STEPS.map((step, idx) => {
          const isComplete = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const label = STEP_LABELS[step];
          return (
            <li
              key={step}
              className={clsx(
                'flex flex-1 items-center gap-2',
                idx > 0 && 'pl-2 sm:pl-3'
              )}
            >
              {idx > 0 && (
                <span
                  aria-hidden="true"
                  className={clsx(
                    'hidden h-px flex-1 sm:block',
                    isComplete || isCurrent
                      ? 'bg-[var(--accent)]'
                      : 'bg-[var(--border)]'
                  )}
                />
              )}
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                    isComplete &&
                      'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]',
                    isCurrent &&
                      'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]',
                    !isComplete &&
                      !isCurrent &&
                      'border-[var(--border)] bg-[var(--bg-input)] text-[var(--text-muted)]'
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isComplete ? (
                    <CheckIcon className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    idx + 1
                  )}
                </span>
                <span
                  className={clsx(
                    'hidden text-xs font-medium sm:inline',
                    isCurrent
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)]'
                  )}
                >
                  {label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
          Step {stepNumber} of {total}
          {' · '}
          {STEP_TITLES[current]}
        </p>
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">
          {heading}
        </h2>
        {description && (
          <p className="text-sm text-[var(--text-secondary)]">{description}</p>
        )}
      </div>

      <div>{children}</div>
    </div>
  );
};

export default WizardShell;
