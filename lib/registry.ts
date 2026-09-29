// The compose list — one import line per domain (Open/Closed: adding a domain
// never edits the Shell). Cross-domain PERMANENT chrome (AircraftDock,
// FooterPilot) is assembled by DrawerLeft, not declared here.
import type { AppDefinition } from './registry.types';
import { dashboard } from '@/domains/dashboard/dashboard.manifest';
import { checklists } from '@/domains/checklists/checklists.manifest';
import { planner } from '@/domains/planner/planner.manifest';
import { missions } from '@/domains/missions/missions.manifest';
import { logs } from '@/domains/logs/logs.manifest';
import { settings } from '@/domains/settings/settings.manifest';

export const APP_REGISTRY: AppDefinition[] = [dashboard, checklists, planner, missions, logs, settings];

export function appByRoute(segment: string | null): AppDefinition {
  return APP_REGISTRY.find((a) => a.route === segment) ?? APP_REGISTRY[0];
}
