// BadgeCategory — THE category color language:
//   FIELD = green (go fly) · PLAN = blue (before the field) · REVIEW = violet (after).
// Use BadgeCategory for the pill, CATEGORY_TEXT for inline colored text, wherever a
// category marker appears (breadcrumb, dashboard cards and section labels).
'use client';
import type { AppCategory } from '@/lib/registry.types';

export const CATEGORY_LABEL: Record<AppCategory, string> = {
  field: 'Field',
  plan: 'Plan',
  review: 'Review',
};

export const CATEGORY_TEXT: Record<AppCategory, string> = {
  field: 'text-emerald-600 dark:text-emerald-400',
  plan: 'text-sky-600 dark:text-sky-400',
  review: 'text-violet-600 dark:text-violet-400',
};

const CATEGORY_BADGE: Record<AppCategory, string> = {
  field:
    'border-emerald-300/60 bg-emerald-50/60 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-900/30 dark:text-emerald-400',
  plan: 'border-sky-300/60 bg-sky-50/60 text-sky-700 dark:border-sky-700/50 dark:bg-sky-900/30 dark:text-sky-400',
  review:
    'border-violet-300/60 bg-violet-50/60 text-violet-700 dark:border-violet-700/50 dark:bg-violet-900/30 dark:text-violet-400',
};

export function BadgeCategory({ category, className = '' }: { category: AppCategory; className?: string }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${CATEGORY_BADGE[category]} ${className}`}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}
