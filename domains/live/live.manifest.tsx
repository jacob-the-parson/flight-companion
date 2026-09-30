// LIVE — field domain. See what a connected aircraft is reporting now: mode,
// armed or not, attitude, height, battery, GPS, and what the board says. It
// hears a copy of what QGroundControl hears. It cannot send anything.
'use client';
import { Info, Plane, RadioTower, ShieldCheck } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';
import { LiveAircraftPage, LiveLinkPage, LiveRulesPage } from './LiveDrawerPages';
import { LivePracticeAction, LiveReportAction, LiveStatus, LiveStopAction } from './LiveFooterActions';
import { LiveSettings } from './LiveSettings';

export const live: AppDefinition = {
  id: 'live',
  route: 'live',
  name: 'Live',
  description: 'What a connected aircraft is reporting now. It listens to a copy of what QGroundControl hears, and cannot send.',
  icon: RadioTower,
  category: 'field',
  theme: {
    colorClass: 'text-sky-600 dark:text-sky-400',
    bgClass: 'bg-sky-50 dark:bg-sky-900/40',
    hoverBorder: 'hover:border-sky-300 dark:hover:border-sky-500',
  },
  navigation: { showInSidebar: true, showInDashboard: true, showInSettings: true },
  drawerRight: {
    pages: [
      { id: 'link', title: 'Link', icon: Info, content: LiveLinkPage },
      { id: 'aircraft', title: 'Aircraft', icon: Plane, content: LiveAircraftPage },
      { id: 'rules', title: 'Rules', icon: ShieldCheck, content: LiveRulesPage },
    ],
  },
  // footer shape: [what is heard][practice flight][CENTER reserved][Stop][Report]
  shellFooter: [LiveStatus, LivePracticeAction, null, LiveStopAction, LiveReportAction],
  settingsBody: LiveSettings,
};
