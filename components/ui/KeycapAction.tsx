// KeycapAction — the shared footer-keycap leaf (action color language,
// DESIGN-TOKENS.md): icon carries its tone AT REST; hover = tinted wash +
// label takes the tone + icon shade-shifts + hover-lift. Presentational leaf —
// the domain's slot component owns the store wiring.
'use client';
import type { LucideIcon } from 'lucide-react';

const TONES = {
  /** destroy/dismiss family (trash-clear, reset) */
  red: {
    icon: 'text-red-500 dark:text-red-400 group-hover:text-red-600 dark:group-hover:text-red-300',
    hover: 'hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30 dark:hover:text-red-400',
  },
  /** export/save family (vault send, download) */
  green: {
    icon: 'text-green-600 dark:text-green-500 group-hover:text-green-700 dark:group-hover:text-green-300',
    hover: 'hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20 dark:hover:text-green-400',
  },
} as const;

interface KeycapActionProps {
  icon: LucideIcon;
  label: string;
  tone: keyof typeof TONES;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}

export function KeycapAction({ icon: Icon, label, tone, onClick, title, disabled }: KeycapActionProps) {
  const t = TONES[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`group flex h-full w-full items-center justify-center gap-1.5 outline-none transition-colors ${
        disabled ? 'cursor-not-allowed opacity-50' : `cursor-pointer ${t.hover}`
      }`}
    >
      <Icon
        size={13}
        className={`${t.icon} ${disabled ? '' : 'transition-all group-hover:-translate-y-0.5'}`}
      />
      <span className="font-medium uppercase tracking-wide">{label}</span>
    </button>
  );
}
