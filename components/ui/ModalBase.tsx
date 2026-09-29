// ModalBase — the one modal primitive (kind-prefix law: every modal is Modal*).
// Portal, backdrop, Esc-to-close, body scroll lock, capped height w/ internal
// scroll. `title` takes ReactNode (chips welcome); `headerActions` slot sits
// left of the close button; `maxWidth` widens it (default max-w-md).
'use client';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalBaseProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  headerActions?: ReactNode;
  maxWidth?: string;
  children: ReactNode;
}

export function ModalBase({
  isOpen,
  onClose,
  title,
  headerActions,
  maxWidth = 'max-w-md',
  children,
}: ModalBaseProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`flex max-h-[90dvh] w-full flex-col rounded-xl border border-edge bg-surface-raised p-5 shadow-2xl ${maxWidth}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">{title}</h2>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <button
              onClick={onClose}
              className="group rounded p-1 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
              aria-label="Close"
            >
              <X size={16} className="transition-transform group-hover:-translate-y-0.5" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
