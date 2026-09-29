// LOGS — review domain. Open a PX4 flight log and see what the flight was:
// findings first, then charts that move together, a map, events and parameters.
'use client';
import { Activity, ChartLine, Info, Search } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';
import { LogsInventoryPanel } from './LogsInventoryPanel';
import { LogsFindingsPage, LogsInfoPage, LogsPlotsPage } from './LogsDrawerPages';
import { LogsCloseAction, LogsCursorStatus, LogsReportAction, LogsWholeAction } from './LogsFooterActions';
import { LogsSettings } from './LogsSettings';

export const logs: AppDefinition = {
  id: 'logs',
  route: 'logs',
  name: 'Flight Logs',
  description: 'Open a PX4 log: findings, charts, map, events and parameters.',
  icon: Activity,
  category: 'review',
  theme: {
    colorClass: 'text-violet-600 dark:text-violet-400',
    bgClass: 'bg-violet-50 dark:bg-violet-900/40',
    hoverBorder: 'hover:border-violet-300 dark:hover:border-violet-500',
  },
  navigation: { showInSidebar: true, showInDashboard: true, showInSettings: true },
  drawerLeftBottom: LogsInventoryPanel,
  drawerRight: {
    title: 'Inspector',
    icon: Search,
    pages: [
      { id: 'findings', title: 'Findings', icon: Search, content: LogsFindingsPage },
      { id: 'plots', title: 'Plots', icon: ChartLine, content: LogsPlotsPage },
      { id: 'info', title: 'Info', icon: Info, content: LogsInfoPage },
    ],
  },
  // footer shape: [cursor status][whole log][CENTER reserved][Close][Report]
  shellFooter: [LogsCursorStatus, LogsWholeAction, null, LogsCloseAction, LogsReportAction],
  settingsBody: LogsSettings,
};
