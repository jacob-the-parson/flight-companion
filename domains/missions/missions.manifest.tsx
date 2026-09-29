// MISSIONS — plan domain. Open a mission file from any of the tools that make
// them, see it, edit it, and write it in another tool's format, with a plain
// account of what that format cannot hold.
'use client';
import { FileDown, ListChecks, MapPin, SlidersHorizontal, Waypoints } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';
import { MissionsLibraryPanel } from './MissionsLibraryPanel';
import {
  MissionsChecksPage,
  MissionsExportPage,
  MissionsItemPage,
  MissionsMissionPage,
} from './MissionsDrawerPages';
import {
  MissionsCloseAction,
  MissionsDownloadAction,
  MissionsSaveAction,
  MissionsStatusAction,
} from './MissionsFooterActions';
import { MissionsSettings } from './MissionsSettings';

export const missions: AppDefinition = {
  id: 'missions',
  route: 'missions',
  name: 'Missions',
  description: 'Open, edit and convert mission files: QGroundControl, Mission Planner, DJI, Garmin, KML and GPX.',
  icon: Waypoints,
  category: 'plan',
  theme: {
    colorClass: 'text-teal-600 dark:text-teal-400',
    bgClass: 'bg-teal-50 dark:bg-teal-900/40',
    hoverBorder: 'hover:border-teal-300 dark:hover:border-teal-500',
  },
  navigation: { showInSidebar: true, showInDashboard: true, showInSettings: true },
  drawerLeftBottom: MissionsLibraryPanel,
  drawerRight: {
    pages: [
      { id: 'item', title: 'Item', icon: MapPin, content: MissionsItemPage },
      { id: 'mission', title: 'Mission', icon: SlidersHorizontal, content: MissionsMissionPage },
      { id: 'checks', title: 'Checks', icon: ListChecks, content: MissionsChecksPage },
      { id: 'export', title: 'Export', icon: FileDown, content: MissionsExportPage },
    ],
  },
  // footer shape: [status][download][CENTER reserved][Close][Save]
  shellFooter: [MissionsStatusAction, MissionsDownloadAction, null, MissionsCloseAction, MissionsSaveAction],
  settingsBody: MissionsSettings,
};
