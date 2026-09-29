// PopMenu — the one popout primitive (kind-prefix law: every popout is Pop*).
// Trigger + floating panel, click-outside to close.
'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface PopMenuProps {
  trigger: ReactNode;
  children: ReactNode;
  /** Where the panel opens relative to the trigger. */
  direction?: 'up' | 'down';
  align?: 'left' | 'right';
}

export function PopMenu({ trigger, children, direction = 'down', align = 'left' }: PopMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <div onClick={() => setIsOpen((o) => !o)}>{trigger}</div>
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className={`absolute z-50 min-w-44 rounded-lg border border-edge bg-surface-raised py-1 shadow-vibe-lg ${
            direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${align === 'left' ? 'left-0' : 'right-0'}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
