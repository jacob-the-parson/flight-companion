// CHECKLISTS — field domain. Build and run checklists for the five phases of a
// flight: pre-flight, in flight, landing, post-landing, post-flight.
'use client';
import { ClipboardCheck, History, ListChecks, SquarePen } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';
import { ChecklistsLibraryPanel } from './ChecklistsLibraryPanel';
import { ChecklistsHistoryPage, ChecklistsRunPage, ChecklistsTemplatePage } from './ChecklistsDrawerPages';
import {
  ChecklistsResetAction,
  ChecklistsSaveAction,
  ChecklistsStatusAction,
  ChecklistsTickAction,
} from './ChecklistsFooterActions';
import { ChecklistsSettings } from './ChecklistsSettings';

export const checklists: AppDefinition = {
  id: 'checklists',
  route: 'checklists',
  name: 'Checklists',
  description: 'Pre-flight, in flight, landing, post-landing and post-flight, with a go/no-go.',
  icon: ClipboardCheck,
  category: 'field',
  theme: {
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-50 dark:bg-emerald-900/40',
    hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-500',
  },
  navigation: { showInSidebar: true, showInDashboard: true, showInSettings: true },
  drawerLeftBottom: ChecklistsLibraryPanel,
  drawerRight: {
    pages: [
      { id: 'run', title: 'Run', icon: ListChecks, content: ChecklistsRunPage },
      { id: 'history', title: 'History', icon: History, content: ChecklistsHistoryPage },
      { id: 'template', title: 'Template', icon: SquarePen, content: ChecklistsTemplatePage },
    ],
  },
  // footer shape: [status][tick][CENTER reserved][Reset][Save]
  shellFooter: [ChecklistsStatusAction, ChecklistsTickAction, null, ChecklistsResetAction, ChecklistsSaveAction],
  settingsBody: ChecklistsSettings,
};
