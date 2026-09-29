// PLANNER — plan domain. Draw an area, a line or a point; get a flight path,
// its numbers and its checks; write a file the ground station can open.
'use client';
import { Camera, FileDown, ListChecks, Route, SlidersHorizontal } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';
import { PlannerPlansPanel } from './PlannerPlansPanel';
import {
  PlannerCameraPage,
  PlannerExportPage,
  PlannerResultsPage,
  PlannerSurveyPage,
} from './PlannerDrawerPages';
import {
  PlannerClearAction,
  PlannerExportAction,
  PlannerSaveAction,
  PlannerStatusAction,
} from './PlannerFooterActions';
import { PlannerSettings } from './PlannerSettings';

export const planner: AppDefinition = {
  id: 'planner',
  route: 'planner',
  name: 'Flight Planner',
  description: 'Area grid, crosshatch, corridor, orbit and perimeter surveys, exported for your ground station.',
  icon: Route,
  category: 'plan',
  theme: {
    colorClass: 'text-sky-600 dark:text-sky-400',
    bgClass: 'bg-sky-50 dark:bg-sky-900/40',
    hoverBorder: 'hover:border-sky-300 dark:hover:border-sky-500',
  },
  navigation: { showInSidebar: true, showInDashboard: true, showInSettings: true },
  drawerLeftBottom: PlannerPlansPanel,
  drawerRight: {
    pages: [
      { id: 'survey', title: 'Survey', icon: SlidersHorizontal, content: PlannerSurveyPage },
      { id: 'camera', title: 'Camera', icon: Camera, content: PlannerCameraPage },
      { id: 'results', title: 'Results', icon: ListChecks, content: PlannerResultsPage },
      { id: 'export', title: 'Export', icon: FileDown, content: PlannerExportPage },
    ],
  },
  // footer shape: [status][export .plan][CENTER reserved][Clear][Save]
  shellFooter: [PlannerStatusAction, PlannerExportAction, null, PlannerClearAction, PlannerSaveAction],
  settingsBody: PlannerSettings,
};
