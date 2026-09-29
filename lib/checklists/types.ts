// Checklist data model. A TEMPLATE is the reusable list; a RUN is one use of it
// on one day, with a result and a time against every item that was touched.

export const PHASES = [
  { id: 'preflight', label: 'Pre-flight', short: 'Pre' },
  { id: 'inflight', label: 'In flight', short: 'Flight' },
  { id: 'landing', label: 'Landing', short: 'Land' },
  { id: 'postlanding', label: 'Post-landing', short: 'Shutdown' },
  { id: 'postflight', label: 'Post-flight', short: 'Review' },
] as const;

export type PhaseId = (typeof PHASES)[number]['id'];

export interface ChecklistItem {
  id: string;
  text: string;
  /** What a pass looks like: the reading, the sound, the light. */
  expect?: string;
  /** A failed critical item is a no-go for the flight. */
  critical?: boolean;
}

export interface ChecklistSection {
  id: string;
  phase: PhaseId;
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  aircraft: string;
  description: string;
  /** Built-in templates can be restored to their shipped content. */
  builtIn?: boolean;
  sections: ChecklistSection[];
}

export type ItemState = 'ok' | 'fail' | 'na';

export interface ItemResult {
  state: ItemState;
  /** Epoch milliseconds. */
  at: number;
  note?: string;
}

export interface ChecklistRun {
  id: string;
  templateId: string;
  templateName: string;
  aircraft: string;
  startedAt: number;
  savedAt?: number;
  pilot: string;
  site: string;
  notes: string;
  results: Record<string, ItemResult>;
  /** Frozen copy of the sections as they were when the run was saved. */
  sections?: ChecklistSection[];
}

export interface PhaseProgress {
  total: number;
  done: number;
  failed: number;
  criticalFailed: number;
}

export function phaseProgress(
  sections: ChecklistSection[],
  results: Record<string, ItemResult>,
  phase?: PhaseId,
): PhaseProgress {
  const p: PhaseProgress = { total: 0, done: 0, failed: 0, criticalFailed: 0 };
  for (const s of sections) {
    if (phase && s.phase !== phase) continue;
    for (const item of s.items) {
      p.total++;
      const r = results[item.id];
      if (!r) continue;
      p.done++;
      if (r.state === 'fail') {
        p.failed++;
        if (item.critical) p.criticalFailed++;
      }
    }
  }
  return p;
}
