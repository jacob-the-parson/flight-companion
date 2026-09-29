// Checklists domain store — templates, the run in progress, and saved runs.
// Every slot of the checklists domain self-connects here (zero-prop law).
// Persisted: a checklist half done at the field must survive a page reload.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BUILT_IN_TEMPLATES, builtInById } from '@/lib/checklists/seed';
import {
  PHASES,
  type ChecklistItem,
  type ChecklistRun,
  type ChecklistSection,
  type ChecklistTemplate,
  type ItemState,
  type PhaseId,
} from '@/lib/checklists/types';
import { uid } from '@/lib/units';

type Mode = 'run' | 'edit';

interface ChecklistsState {
  templates: ChecklistTemplate[];
  activeTemplateId: string;
  activePhase: PhaseId;
  mode: Mode;
  run: ChecklistRun;
  history: ChecklistRun[];
  /** A saved run being looked at; null while working on the live run. */
  viewingRunId: string | null;

  setActiveTemplate: (id: string) => void;
  setPhase: (phase: PhaseId) => void;
  setMode: (mode: Mode) => void;

  // run
  setResult: (itemId: string, state: ItemState) => void;
  setNote: (itemId: string, note: string) => void;
  setRunField: (field: 'pilot' | 'site' | 'notes', value: string) => void;
  tickNext: () => void;
  resetRun: () => void;
  saveRun: () => void;
  viewRun: (id: string | null) => void;
  deleteRun: (id: string) => void;

  // templates
  addTemplate: () => void;
  duplicateTemplate: (id: string) => void;
  deleteTemplate: (id: string) => void;
  restoreBuiltIn: (id: string) => void;
  importTemplate: (json: string) => string | null;
  updateTemplate: (patch: Partial<Pick<ChecklistTemplate, 'name' | 'aircraft' | 'description'>>) => void;
  addSection: (phase: PhaseId) => void;
  updateSection: (sectionId: string, title: string) => void;
  removeSection: (sectionId: string) => void;
  addItem: (sectionId: string) => void;
  updateItem: (sectionId: string, itemId: string, patch: Partial<Omit<ChecklistItem, 'id'>>) => void;
  removeItem: (sectionId: string, itemId: string) => void;
  moveItem: (sectionId: string, itemId: string, dir: 1 | -1) => void;
}

function newRun(t: ChecklistTemplate): ChecklistRun {
  return {
    id: uid('run'),
    templateId: t.id,
    templateName: t.name,
    aircraft: t.aircraft,
    startedAt: Date.now(),
    pilot: '',
    site: '',
    notes: '',
    results: {},
  };
}

function seedTemplates(): ChecklistTemplate[] {
  return structuredClone(BUILT_IN_TEMPLATES);
}

/** Apply a change to the active template's sections. */
function editSections(
  s: ChecklistsState,
  fn: (sections: ChecklistSection[]) => ChecklistSection[],
): Partial<ChecklistsState> {
  return {
    templates: s.templates.map((t) =>
      t.id === s.activeTemplateId ? { ...t, sections: fn(t.sections) } : t,
    ),
  };
}

export const useChecklistsStore = create<ChecklistsState>()(
  persist(
    (set, get) => ({
      templates: seedTemplates(),
      activeTemplateId: BUILT_IN_TEMPLATES[0].id,
      activePhase: 'preflight',
      mode: 'run',
      run: newRun(BUILT_IN_TEMPLATES[0]),
      history: [],
      viewingRunId: null,

      setActiveTemplate: (id) => {
        const t = get().templates.find((x) => x.id === id);
        if (!t || id === get().activeTemplateId) return;
        // a run belongs to one template: switching template starts a fresh run
        set({ activeTemplateId: id, run: newRun(t), activePhase: 'preflight', viewingRunId: null });
      },
      setPhase: (activePhase) => set({ activePhase }),
      setMode: (mode) => set({ mode, viewingRunId: null }),

      setResult: (itemId, state) =>
        set((s) => {
          if (s.viewingRunId) return s; // saved runs are read-only
          const results = { ...s.run.results };
          const prev = results[itemId];
          // pressing the same state again clears the item
          if (prev?.state === state) delete results[itemId];
          else results[itemId] = { state, at: Date.now(), ...(prev?.note ? { note: prev.note } : null) };
          return { run: { ...s.run, results } };
        }),
      setNote: (itemId, note) =>
        set((s) => {
          if (s.viewingRunId) return s;
          const prev = s.run.results[itemId];
          if (!prev) return s; // a note hangs off a result
          return { run: { ...s.run, results: { ...s.run.results, [itemId]: { ...prev, note } } } };
        }),
      setRunField: (field, value) => set((s) => ({ run: { ...s.run, [field]: value } })),

      tickNext: () => {
        const s = get();
        if (s.viewingRunId) return;
        const t = s.templates.find((x) => x.id === s.activeTemplateId);
        if (!t) return;
        // first open item, walking the phases in order from the active one
        const order = PHASES.map((p) => p.id);
        const start = order.indexOf(s.activePhase);
        for (let k = 0; k < order.length; k++) {
          const phase = order[(start + k) % order.length];
          for (const sec of t.sections) {
            if (sec.phase !== phase) continue;
            const item = sec.items.find((i) => !s.run.results[i.id]);
            if (item) {
              set({
                activePhase: phase,
                run: {
                  ...s.run,
                  results: { ...s.run.results, [item.id]: { state: 'ok', at: Date.now() } },
                },
              });
              return;
            }
          }
        }
      },

      resetRun: () => {
        const s = get();
        const t = s.templates.find((x) => x.id === s.activeTemplateId) ?? s.templates[0];
        set({
          run: { ...newRun(t), pilot: s.run.pilot, site: s.run.site },
          activePhase: 'preflight',
          viewingRunId: null,
        });
      },

      saveRun: () => {
        const s = get();
        if (s.viewingRunId) return;
        if (Object.keys(s.run.results).length === 0) return; // nothing to keep
        const t = s.templates.find((x) => x.id === s.activeTemplateId);
        const saved: ChecklistRun = {
          ...s.run,
          savedAt: Date.now(),
          templateName: t?.name ?? s.run.templateName,
          aircraft: t?.aircraft ?? s.run.aircraft,
          sections: structuredClone(t?.sections ?? []),
        };
        set({
          history: [saved, ...s.history.filter((r) => r.id !== saved.id)].slice(0, 200),
          run: { ...newRun(t ?? s.templates[0]), pilot: s.run.pilot, site: s.run.site },
          activePhase: 'preflight',
        });
      },
      viewRun: (viewingRunId) => set({ viewingRunId, mode: 'run' }),
      deleteRun: (id) =>
        set((s) => ({
          history: s.history.filter((r) => r.id !== id),
          viewingRunId: s.viewingRunId === id ? null : s.viewingRunId,
        })),

      addTemplate: () => {
        const t: ChecklistTemplate = {
          id: uid('tpl'),
          name: 'New checklist',
          aircraft: '',
          description: '',
          sections: PHASES.map((p) => ({ id: uid('sec'), phase: p.id, title: p.label, items: [] })),
        };
        set((s) => ({
          templates: [...s.templates, t],
          activeTemplateId: t.id,
          run: newRun(t),
          mode: 'edit',
          activePhase: 'preflight',
          viewingRunId: null,
        }));
      },
      duplicateTemplate: (id) => {
        const src = get().templates.find((x) => x.id === id);
        if (!src) return;
        const t: ChecklistTemplate = {
          ...structuredClone(src),
          id: uid('tpl'),
          name: `${src.name} copy`,
          builtIn: false,
        };
        // fresh ids so results of one template never land on another
        t.sections = t.sections.map((sec) => ({
          ...sec,
          id: uid('sec'),
          items: sec.items.map((i) => ({ ...i, id: uid('item') })),
        }));
        set((s) => ({
          templates: [...s.templates, t],
          activeTemplateId: t.id,
          run: newRun(t),
          mode: 'edit',
          viewingRunId: null,
        }));
      },
      deleteTemplate: (id) =>
        set((s) => {
          if (s.templates.length <= 1) return s; // never zero templates
          const templates = s.templates.filter((t) => t.id !== id);
          if (s.activeTemplateId !== id) return { templates };
          return { templates, activeTemplateId: templates[0].id, run: newRun(templates[0]), mode: 'run' };
        }),
      restoreBuiltIn: (id) => {
        const fresh = builtInById(id);
        if (!fresh) return;
        set((s) => ({
          templates: s.templates.map((t) => (t.id === id ? fresh : t)),
          run: s.activeTemplateId === id ? newRun(fresh) : s.run,
        }));
      },
      importTemplate: (json) => {
        try {
          const raw = JSON.parse(json) as Partial<ChecklistTemplate>;
          if (!raw || typeof raw.name !== 'string' || !Array.isArray(raw.sections)) {
            return 'That file is not a checklist template.';
          }
          const phaseIds = new Set<string>(PHASES.map((p) => p.id));
          const sections: ChecklistSection[] = [];
          for (const sec of raw.sections) {
            if (!sec || typeof sec.title !== 'string' || !phaseIds.has(sec.phase) || !Array.isArray(sec.items)) {
              return 'A section in that file is missing its title, phase or items.';
            }
            sections.push({
              id: uid('sec'),
              phase: sec.phase,
              title: sec.title,
              items: sec.items
                .filter((i) => i && typeof i.text === 'string')
                .map((i) => ({
                  id: uid('item'),
                  text: i.text,
                  ...(typeof i.expect === 'string' && i.expect ? { expect: i.expect } : null),
                  ...(i.critical ? { critical: true } : null),
                })),
            });
          }
          const t: ChecklistTemplate = {
            id: uid('tpl'),
            name: raw.name,
            aircraft: typeof raw.aircraft === 'string' ? raw.aircraft : '',
            description: typeof raw.description === 'string' ? raw.description : '',
            sections,
          };
          set((s) => ({
            templates: [...s.templates, t],
            activeTemplateId: t.id,
            run: newRun(t),
            viewingRunId: null,
          }));
          return null;
        } catch {
          return 'That file could not be read as JSON.';
        }
      },
      updateTemplate: (patch) =>
        set((s) => ({
          templates: s.templates.map((t) => (t.id === s.activeTemplateId ? { ...t, ...patch } : t)),
        })),

      addSection: (phase) =>
        set((s) =>
          editSections(s, (secs) => [...secs, { id: uid('sec'), phase, title: 'New section', items: [] }]),
        ),
      updateSection: (sectionId, title) =>
        set((s) => editSections(s, (secs) => secs.map((x) => (x.id === sectionId ? { ...x, title } : x)))),
      removeSection: (sectionId) =>
        set((s) => editSections(s, (secs) => secs.filter((x) => x.id !== sectionId))),
      addItem: (sectionId) =>
        set((s) =>
          editSections(s, (secs) =>
            secs.map((x) =>
              x.id === sectionId ? { ...x, items: [...x.items, { id: uid('item'), text: '' }] } : x,
            ),
          ),
        ),
      updateItem: (sectionId, itemId, patch) =>
        set((s) =>
          editSections(s, (secs) =>
            secs.map((x) =>
              x.id === sectionId
                ? { ...x, items: x.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }
                : x,
            ),
          ),
        ),
      removeItem: (sectionId, itemId) =>
        set((s) =>
          editSections(s, (secs) =>
            secs.map((x) =>
              x.id === sectionId ? { ...x, items: x.items.filter((i) => i.id !== itemId) } : x,
            ),
          ),
        ),
      moveItem: (sectionId, itemId, dir) =>
        set((s) =>
          editSections(s, (secs) =>
            secs.map((x) => {
              if (x.id !== sectionId) return x;
              const from = x.items.findIndex((i) => i.id === itemId);
              const to = from + dir;
              if (from < 0 || to < 0 || to >= x.items.length) return x;
              const items = [...x.items];
              [items[from], items[to]] = [items[to], items[from]];
              return { ...x, items };
            }),
          ),
        ),
    }),
    {
      name: 'fc-checklists',
      version: 1,
      partialize: (s) => ({
        templates: s.templates,
        activeTemplateId: s.activeTemplateId,
        activePhase: s.activePhase,
        run: s.run,
        history: s.history,
      }),
    },
  ),
);

/** The template on screen. */
export function useActiveTemplate(): ChecklistTemplate {
  return useChecklistsStore(
    (s) => s.templates.find((t) => t.id === s.activeTemplateId) ?? s.templates[0],
  );
}

/** What the workspace shows: the live run, or a saved one being looked at. */
export function useShownRun(): { run: ChecklistRun; sections: ChecklistSection[]; readOnly: boolean } {
  const template = useActiveTemplate();
  const live = useChecklistsStore((s) => s.run);
  const viewing = useChecklistsStore((s) =>
    s.viewingRunId ? (s.history.find((r) => r.id === s.viewingRunId) ?? null) : null,
  );
  if (viewing) return { run: viewing, sections: viewing.sections ?? template.sections, readOnly: true };
  return { run: live, sections: template.sections, readOnly: false };
}
