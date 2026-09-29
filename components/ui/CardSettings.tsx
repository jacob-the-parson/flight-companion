// CardSettings — the tri-part "Settings Card" pattern (born in Stitcher,
// echoed in Animator), as a primitive:
//   1. the CARD    — header (icon + title) + inline body content
//   2. the POPOUT  — three-dot quick-apply preset menu (PopMenu)
//   3. the MODAL   — deep configuration (ModalBase), opened from the header icon
'use client';
import { useState, type ComponentType, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PopMenu } from './PopMenu';
import { ModalBase } from './ModalBase';

export interface CardSettingsPreset {
  id: string;
  label: string;
  hint?: string;
  onApply: () => void;
}

interface CardSettingsProps {
  title: string;
  icon: LucideIcon;
  children?: ReactNode;
  /** Quick-apply entries for the three-dot popout. */
  presets?: CardSettingsPreset[];
  /** Deep-config modal body; header icon becomes its trigger when provided. */
  modalBody?: ComponentType<{ close: () => void }>;
  modalTitle?: string;
  /** ACCENT variant: a panel's PRIMARY card wears the domain tint while
   *  secondary cards stay neutral. Extra classes for the root. */
  cardClass?: string;
  /** Accent variant: classes for the header title/icon. */
  titleClass?: string;
}

export function CardSettings({
  title,
  icon: Icon,
  children,
  presets,
  modalBody: ModalBody,
  modalTitle,
  cardClass = '',
  titleClass = '',
}: CardSettingsProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className={`rounded-lg border border-edge bg-surface-raised/60 ${cardClass}`}>
      {/* card header */}
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <button
          onClick={ModalBody ? () => setModalOpen(true) : undefined}
          disabled={!ModalBody}
          title={ModalBody ? `Configure ${title}` : undefined}
          className={`flex items-center gap-2 text-xs font-semibold ${titleClass || 'text-ink'} ${
            ModalBody ? 'cursor-pointer transition-colors hover:text-secondary' : ''
          }`}
        >
          <Icon size={14} />
          {title}
        </button>

        {presets && presets.length > 0 && (
          <PopMenu
            align="right"
            trigger={
              <button
                className="rounded p-1 text-ink-muted transition-colors hover:bg-control hover:text-ink"
                title="Quick presets"
              >
                <MoreHorizontal size={14} />
              </button>
            }
          >
            <div className="max-h-56 overflow-y-auto py-1">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={p.onApply}
                  className="flex w-full flex-col px-3 py-1.5 text-left transition-colors hover:bg-control"
                >
                  <span className="text-xs text-ink">{p.label}</span>
                  {p.hint && <span className="text-[10px] text-ink-muted">{p.hint}</span>}
                </button>
              ))}
            </div>
          </PopMenu>
        )}
      </div>

      {/* inline body */}
      {children && <div className="space-y-3 p-3">{children}</div>}

      {/* deep-config modal */}
      {ModalBody && (
        <ModalBase isOpen={modalOpen} onClose={() => setModalOpen(false)} title={modalTitle ?? title}>
          <ModalBody close={() => setModalOpen(false)} />
        </ModalBase>
      )}
    </div>
  );
}
