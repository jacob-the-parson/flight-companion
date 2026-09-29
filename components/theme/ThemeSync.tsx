// ThemeSync — client island mirroring themeStore onto <html>: .dark class for
// THEME, data-vibe attribute for VIBE. Mounted once in the root layout.
'use client';
import { useEffect } from 'react';
import { useThemeStore } from '@/stores/core/themeStore';

export function ThemeSync() {
  const isDark = useThemeStore((s) => s.isDark);
  const vibe = useThemeStore((s) => s.vibe);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.dataset.vibe = vibe;
  }, [isDark, vibe]);

  return null;
}
