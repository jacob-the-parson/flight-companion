// Dashboard — meta-domain (no category badge). Chrome only; the page lives at
// app/(main)/dashboard/page.tsx. It declares no footer: all five slots read N/A.
'use client';
import { House } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';

export const dashboard: AppDefinition = {
  id: 'dashboard',
  route: 'dashboard',
  name: 'Dashboard',
  description: 'Every domain at a glance.',
  icon: House,
  theme: {
    colorClass: 'text-indigo-500 dark:text-indigo-400',
    bgClass: 'bg-indigo-50 dark:bg-indigo-900/40',
    hoverBorder: 'hover:border-indigo-300 dark:hover:border-indigo-500',
  },
  navigation: { showInSidebar: true, showInDashboard: false, showInSettings: false },
};
