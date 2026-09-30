// The compose list — one import line per domain (Open/Closed: adding a domain
// never edits the Shell). Cross-domain PERMANENT chrome (AircraftDock,
// FooterPilot) is assembled by DrawerLeft, not declared here.
import type { AppDefinition } from './registry.types';
import { dashboard } from '@/domains/dashboard/dashboard.manifest';
import { checklists } from '@/domains/checklists/checklists.manifest';
import { planner } from '@/domains/planner/planner.manifest';
import { missions } from '@/domains/missions/missions.manifest';
import { parameters } from '@/domains/parameters/parameters.manifest';
import { live } from '@/domains/live/live.manifest';
import { logs } from '@/domains/logs/logs.manifest';
import { assistant } from '@/domains/assistant/assistant.manifest';
import { settings } from '@/domains/settings/settings.manifest';

export const APP_REGISTRY: AppDefinition[] = [dashboard, checklists, live, planner, missions, parameters, logs, assistant, settings];

export function appByRoute(segment: string | null): AppDefinition {
  return APP_REGISTRY.find((a) => a.route === segment) ?? APP_REGISTRY[0];
}
