// Settings — meta-domain: Global sub-area + one sub-area per domain that opts
// in via manifest.settingsBody. Page: app/(main)/settings.
'use client';
import { Settings as SettingsIcon } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';

export const settings: AppDefinition = {
  id: 'settings',
  route: 'settings',
  name: 'Settings',
  description: 'Units, appearance and per-domain preferences.',
  icon: SettingsIcon,
  theme: {
    colorClass: 'text-zinc-500 dark:text-zinc-400',
    bgClass: 'bg-zinc-100 dark:bg-zinc-800/60',
    hoverBorder: 'hover:border-zinc-300 dark:hover:border-zinc-600',
  },
  navigation: { showInSidebar: true, showInDashboard: true, showInSettings: false },
};
