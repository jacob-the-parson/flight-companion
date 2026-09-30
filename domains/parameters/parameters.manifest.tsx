// PARAMETERS — plan domain. Open a parameter file, see what each parameter is
// in the autopilot's own words, compare two files, change values, and write a
// file for the ground station to load.
'use client';
import { FileDown, Info, ListChecks, SlidersHorizontal, Tag } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';
import { ParametersLibraryPanel } from './ParametersLibraryPanel';
import {
  ParametersExportPage,
  ParametersFindingsPage,
  ParametersParameterPage,
  ParametersSetPage,
} from './ParametersDrawerPages';
import {
  ParametersCloseAction,
  ParametersDownloadAction,
  ParametersSaveAction,
  ParametersStatusAction,
} from './ParametersFooterActions';
import { ParametersSettings } from './ParametersSettings';

export const parameters: AppDefinition = {
  id: 'parameters',
  route: 'parameters',
  name: 'Parameters',
  description: 'Open, compare and edit parameter files, with each parameter explained in PX4’s own words.',
  icon: SlidersHorizontal,
  category: 'plan',
  theme: {
    colorClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-900/40',
    hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-500',
  },
  navigation: { showInSidebar: true, showInDashboard: true, showInSettings: true },
  drawerLeftBottom: ParametersLibraryPanel,
  drawerRight: {
    pages: [
      { id: 'parameter', title: 'Value', icon: Tag, content: ParametersParameterPage },
      { id: 'findings', title: 'Findings', icon: ListChecks, content: ParametersFindingsPage },
      { id: 'set', title: 'Set', icon: Info, content: ParametersSetPage },
      { id: 'export', title: 'Export', icon: FileDown, content: ParametersExportPage },
    ],
  },
  // footer shape: [status][download][CENTER reserved][Close][Save]
  shellFooter: [ParametersStatusAction, ParametersDownloadAction, null, ParametersCloseAction, ParametersSaveAction],
  settingsBody: ParametersSettings,
};
