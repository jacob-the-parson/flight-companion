// CardCheck — one thing the app noticed: a level, a title, what it means, and
// the things it points at. Status is always an icon AND a word; colour alone
// never carries it. Spec: CardCheck.md
'use client';
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type CheckLevel = 'critical' | 'warning' | 'info' | 'good';

export const LEVEL_STYLE: Record<CheckLevel, { icon: LucideIcon; tone: string; box: string; word: string }> = {
  critical: {
    icon: OctagonAlert,
    tone: 'text-status-critical',
    box: 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30',
    word: 'Stop',
  },
  warning: {
    icon: TriangleAlert,
    tone: 'text-status-warning',
    box: 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30',
    word: 'Check',
  },
  info: { icon: Info, tone: 'text-ink-muted', box: 'border-edge bg-control/50', word: 'Note' },
  good: {
    icon: CircleCheck,
    tone: 'text-status-good',
    box: 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30',
    word: 'Good',
  },
};

/** The worst level in a list: stop, then check, else good. Notes do not count. */
export function worstLevel(levels: CheckLevel[]): CheckLevel {
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('warning')) return 'warning';
  return 'good';
}

interface CardCheckProps {
  level: CheckLevel;
  title: string;
  detail: string;
  /** What the check points at: item numbers, parameter names. */
  chips?: string[];
  /** How many chips to show before "and N more". */
  chipLimit?: number;
  onChip?: (chip: string) => void;
  chipTitle?: (chip: string) => string;
}

export function CardCheck({ level, title, detail, chips = [], chipLimit = 12, onChip, chipTitle }: CardCheckProps) {
  const L = LEVEL_STYLE[level];
  return (
    <article className={`print-break-avoid rounded-lg border p-3 ${L.box}`}>
      <div className="flex gap-2.5">
        <L.icon size={15} className={`mt-0.5 shrink-0 ${L.tone}`} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="text-xs font-semibold text-ink">
            <span className="mr-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">{L.word}</span>
            {title}
          </h3>
          <p className="text-[11px] leading-snug text-ink-muted">{detail}</p>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {chips.slice(0, chipLimit).map((chip) =>
                onChip ? (
                  <button
                    key={chip}
                    onClick={() => onChip(chip)}
                    className="max-w-full truncate rounded border border-edge bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-ink transition-colors hover:bg-surface-sunken"
                    title={chipTitle?.(chip)}
                  >
                    {chip}
                  </button>
                ) : (
                  <span key={chip} className="max-w-full truncate rounded border border-edge bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-ink">
                    {chip}
                  </span>
                ),
              )}
              {chips.length > chipLimit && (
                <span className="px-1 py-0.5 text-[10px] text-ink-muted">and {chips.length - chipLimit} more</span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
