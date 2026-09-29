// PopContext — the right-click context menu primitive (slicer-inventory
// heritage, extracted before a second inline copy existed). Portal at cursor,
// viewport-clamped, global click/Esc dismiss. Spec: PopContext.md
'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface PopContextItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Red family styling (delete/destroy actions). */
  danger?: boolean;
}

interface PopContextProps {
  x: number;
  y: number;
  items: PopContextItem[];
  onClose: () => void;
}

export function PopContext({ x, y, items, onClose }: PopContextProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // defer so the opening right-click doesn't instantly dismiss
    const id = setTimeout(() => {
      window.addEventListener('click', onClose);
      window.addEventListener('contextmenu', onClose);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      window.removeEventListener('click', onClose);
      window.removeEventListener('contextmenu', onClose);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // clamp to viewport once mounted
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${y - rect.height}px`;
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[100] min-w-36 rounded-md border border-edge bg-surface-raised py-1 shadow-2xl"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
            item.danger
              ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
              : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
