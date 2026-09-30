// The three views of a set of parameters:
//   ParametersList    — every parameter, grouped as the reference groups them
//   ParametersCompare — how the set differs from another
//   ParametersFile    — the file itself, as the chosen format writes it
'use client';
import { useMemo } from 'react';
import { Download, FileUp, GraduationCap, Search, X } from 'lucide-react';
import { CardReport } from '@/components/ui/CardReport';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import { flagsOf, groupOf, valueMeaning, type ParamFlags } from '@/lib/params/analysis';
import { paramFormatById } from '@/lib/params/codecs';
import { isEdited, valueText, type ParamEntry, type ParamMeta } from '@/lib/params/model';
import { PARAM_FORMAT_READING, PARAM_SAMPLES } from '@/lib/params/samples';
import { usePrefsStore } from '@/stores/core/prefsStore';
import {
  entryKey,
  useDiff,
  useParamsStore,
  useWrittenParams,
  type ParamFilter,
} from '@/stores/domains/paramsStore';
import { ACCENT, autopilotName, downloadParams, ParamFormatSelect, TOOL_BTN, useFilePicker } from './ParametersParts';

interface Row {
  e: ParamEntry;
  meta: ParamMeta | undefined;
  flags: ParamFlags;
  group: string;
}

const isFlagged = (f: ParamFlags) => f.ardupilotLike || f.belowMin || f.aboveMax || f.notListed || f.typeDiffers;

/** A word beside a value: never colour alone. */
function Tag({ children, tone = 'muted', title }: { children: React.ReactNode; tone?: 'muted' | 'warn' | 'stop'; title?: string }) {
  const cls =
    tone === 'stop'
      ? 'border-red-300 text-ink dark:border-red-900'
      : tone === 'warn'
        ? 'border-amber-300 text-ink dark:border-amber-800'
        : 'border-edge text-ink-muted';
  return (
    <span title={title} className={`whitespace-nowrap rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

export function FlagTags({ flags }: { flags: ParamFlags }) {
  return (
    <>
      {flags.ardupilotLike && <Tag tone="stop" title="PX4 has no parameter by this name. It has the shape of an ArduPilot name.">not PX4</Tag>}
      {flags.belowMin && <Tag tone="warn" title="Below the lowest value the reference gives">below limit</Tag>}
      {flags.aboveMax && <Tag tone="warn" title="Above the highest value the reference gives">above limit</Tag>}
      {flags.notListed && <Tag tone="warn" title="Not one of the values the reference lists">not listed</Tag>}
      {flags.typeDiffers && <Tag tone="warn" title="The file's type is not the reference's">type</Tag>}
      {flags.edited && <Tag title="Changed here. The file on disk is not touched.">changed here</Tag>}
      {flags.reboot && <Tag title="A change takes effect after the autopilot restarts">restart</Tag>}
    </>
  );
}

export function ParametersList() {
  const set = useParamsStore((s) => s.set);
  const reference = useParamsStore((s) => s.reference);
  const referenceState = useParamsStore((s) => s.referenceState);
  const selected = useParamsStore((s) => s.selected);
  const filter = useParamsStore((s) => s.filter);
  const search = useParamsStore((s) => s.search);
  const select = useParamsStore((s) => s.select);
  const setFilter = useParamsStore((s) => s.setFilter);
  const setSearch = useParamsStore((s) => s.setSearch);

  const rows = useMemo<Row[]>(() => {
    if (!set) return [];
    const ref = set.autopilot === 'ardupilot' ? null : reference;
    return set.entries.map((e) => {
      const meta = ref?.parameters[e.name];
      return { e, meta, flags: flagsOf(e, meta, set.autopilot), group: groupOf(e.name, ref) };
    });
  }, [set, reference]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      'not-default': rows.filter((r) => r.flags.notDefault).length,
      flagged: rows.filter((r) => isFlagged(r.flags)).length,
      edited: rows.filter((r) => r.flags.edited).length,
      notes: rows.filter((r) => r.e.note).length,
    }),
    [rows],
  );

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const kept = rows.filter((r) => {
      if (filter === 'not-default' && !r.flags.notDefault) return false;
      if (filter === 'flagged' && !isFlagged(r.flags)) return false;
      if (filter === 'edited' && !r.flags.edited) return false;
      if (filter === 'notes' && !r.e.note) return false;
      if (q === '') return true;
      return (
        r.e.name.toLowerCase().includes(q) ||
        r.group.toLowerCase().includes(q) ||
        (r.meta?.short.toLowerCase().includes(q) ?? false) ||
        (r.e.note?.toLowerCase().includes(q) ?? false)
      );
    });
    const by = new Map<string, Row[]>();
    for (const r of kept) by.set(r.group, [...(by.get(r.group) ?? []), r]);
    return [...by].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, filter, search]);

  if (!set) return null;
  const shown = groups.reduce((n, [, g]) => n + g.length, 0);
  const options: { id: ParamFilter; label: string; short: string; title: string }[] = [
    { id: 'all', label: `All ${counts.all}`, short: 'All', title: 'Every parameter in the set' },
    { id: 'not-default', label: `Not default ${counts['not-default']}`, short: 'Not def.', title: 'Differs from the firmware’s default. Choosing an airframe does this to many.' },
    { id: 'flagged', label: `Flagged ${counts.flagged}`, short: 'Flagged', title: 'Outside its limits, not a listed value, or not a PX4 name' },
    { id: 'edited', label: `Changed here ${counts.edited}`, short: 'Changed', title: 'Values you changed in this app' },
    { id: 'notes', label: `Notes ${counts.notes}`, short: 'Notes', title: 'Parameters you wrote a note on' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
        <label className="flex min-w-40 flex-1 items-center gap-2 rounded-md border border-edge bg-surface-raised px-2.5 py-1.5 focus-within:border-secondary">
          <Search size={13} className="shrink-0 text-ink-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find by name, group or what it does"
            aria-label="Find a parameter"
            className="w-full min-w-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-ink-muted hover:text-ink" aria-label="Clear the search">
              <X size={13} />
            </button>
          )}
        </label>
        <SegmentedTrack ariaLabel="Which parameters to show" size="sm" options={options} value={filter} onChange={setFilter} />
      </div>

      <div className="@container min-h-0 flex-1 overflow-y-auto">
        {referenceState === 'failed' && (
          <p className="border-b border-edge bg-amber-50/70 px-4 py-2 text-xs text-ink dark:bg-amber-950/30">
            PX4’s reference could not be loaded, so descriptions, units and limits are missing. Names and values are
            all here.
          </p>
        )}
        {shown === 0 && (
          <p className="p-8 text-center text-sm text-ink-muted">
            {search ? `Nothing matches "${search}".` : 'No parameter fits this filter.'}
          </p>
        )}
        {groups.map(([group, list]) => (
          <section key={group} style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${32 + list.length * 34}px` }}>
            <h3 className="sticky top-0 z-10 flex items-center gap-2 border-b border-edge bg-surface-raised px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              {group}
              <span className="font-mono font-normal">{list.length}</span>
            </h3>
            <ul>
              {list.map(({ e, meta, flags }) => {
                const k = entryKey(e);
                const active = k === selected;
                const meaning = valueMeaning(e.value, meta);
                return (
                  <li key={k}>
                    <button
                      onClick={() => select(k)}
                      aria-pressed={active}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-b border-edge px-4 py-1.5 text-left text-xs transition-colors hover:bg-control/60 @2xl:grid-cols-[minmax(9rem,16rem)_minmax(5rem,9rem)_minmax(0,1fr)] ${active ? ACCENT.row : ''}`}
                    >
                      <span className="truncate font-mono font-medium text-ink" title={e.name}>
                        {e.name}
                      </span>
                      <span className="truncate text-right font-mono text-ink" title={valueText(e)}>
                        {valueText(e)}
                        {meta?.unit ? <span className="ml-1 font-sans text-[10px] text-ink-muted">{meta.unit}</span> : null}
                      </span>
                      {/* on a narrow surface what it is goes under the name */}
                      <span className="col-span-2 flex min-w-0 items-baseline gap-1.5 @2xl:col-span-1">
                        <FlagTags flags={flags} />
                        <span className="min-w-0 truncate text-ink-muted">
                          {meaning ? <span className="text-ink">{meaning}. </span> : null}
                          {e.note ? <span className="italic">{e.note} </span> : null}
                          {meta?.short ?? ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

const KIND: Record<'changed' | 'only-here' | 'only-there', string> = {
  changed: 'Different',
  'only-here': 'Only in this set',
  'only-there': 'Only in the other',
};

export function ParametersCompare() {
  const set = useParamsStore((s) => s.set);
  const other = useParamsStore((s) => s.other);
  const reference = useParamsStore((s) => s.reference);
  const saved = useParamsStore((s) => s.saved);
  const loadedId = useParamsStore((s) => s.loadedId);
  const selected = useParamsStore((s) => s.selected);
  const learn = usePrefsStore((s) => s.learn);
  const select = useParamsStore((s) => s.select);
  const compareWithFile = useParamsStore((s) => s.compareWithFile);
  const compareWithSaved = useParamsStore((s) => s.compareWithSaved);
  const compareWithSample = useParamsStore((s) => s.compareWithSample);
  const clearCompare = useParamsStore((s) => s.clearCompare);
  const diff = useDiff();
  const { input, open } = useFilePicker((files) => void compareWithFile(files[0]), false);
  if (!set) return null;
  const others = saved.filter((m) => m.id !== loadedId);
  const ref = set.autopilot === 'ardupilot' ? null : reference;
  const th = 'sticky top-0 z-10 border-b border-edge bg-surface-raised px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-muted';

  if (!other || !diff) {
    return (
      <div className="h-full overflow-y-auto p-6">
        {input}
        <div className="mx-auto max-w-xl space-y-4">
          <h2 className="text-base font-semibold text-ink">Compare with another set</h2>
          <p className="text-sm leading-snug text-ink-muted">
            Save the aircraft’s parameters before a change and again after it. Comparing the two files shows every
            parameter that moved, including the ones nobody meant to move.
          </p>
          <button onClick={open} className={`${TOOL_BTN} py-2`}>
            <FileUp size={13} /> Open the file to compare with
          </button>
          {others.length > 0 && (
            <section className="space-y-1.5">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Or a saved set</h3>
              {others.map((m) => (
                <button key={m.id} onClick={() => void compareWithSaved(m.id)} className="flex w-full flex-col rounded-md border border-edge bg-surface-raised/60 px-3 py-2 text-left transition-colors hover:border-edge-strong/40">
                  <span className="truncate text-xs font-medium text-ink">{m.name}</span>
                  <span className="text-[10px] text-ink-muted">
                    {m.count} parameters · {autopilotName(m.autopilot)} · {new Date(m.savedAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </section>
          )}
          {learn && reference && (
            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                <GraduationCap size={13} className={ACCENT.text} /> Or an example
              </h3>
              {PARAM_SAMPLES.map((s) => (
                <button key={s.id} onClick={() => compareWithSample(s.id)} className="flex w-full flex-col rounded-md border border-edge bg-surface-raised/60 px-3 py-2 text-left transition-colors hover:border-edge-strong/40">
                  <span className="truncate text-xs font-medium text-ink">{s.title}</span>
                  <span className="text-[10px] leading-snug text-ink-muted">{s.shows}</span>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>
    );
  }

  const mixed = set.autopilot !== other.autopilot && set.autopilot !== 'unknown' && other.autopilot !== 'unknown';
  return (
    <div className="flex h-full flex-col">
      {input}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-edge px-4 py-2 text-xs">
        <p className="min-w-0 flex-1 text-ink">
          <span className="font-semibold">{set.name}</span>
          <span className="text-ink-muted"> compared with </span>
          <span className="font-semibold">{other.name}</span>
        </p>
        <p className="font-mono text-ink-muted">
          {diff.changed} different · {diff.onlyHere} only here · {diff.onlyThere} only there · {diff.same} the same
        </p>
        <button onClick={open} className={TOOL_BTN}>
          <FileUp size={13} /> Another file
        </button>
        <button onClick={clearCompare} className={TOOL_BTN} title="Stop comparing">
          <X size={13} />
        </button>
      </div>
      {mixed && (
        <p className="shrink-0 border-b border-edge bg-amber-50/70 px-4 py-2 text-xs text-ink dark:bg-amber-950/30">
          One set is {autopilotName(set.autopilot)} and the other {autopilotName(other.autopilot)}. The two do not share
          parameter names, so almost nothing will match. That is not a fault in either file.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {diff.rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-muted">
            The two sets hold the same {diff.same} parameters with the same values.
          </p>
        ) : (
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs">
            <caption className="sr-only">Parameters that differ between the two sets</caption>
            <thead>
              <tr>
                <th className={th}>Parameter</th>
                <th className={th}>How</th>
                <th className={`${th} text-right`}>This set</th>
                <th className={`${th} text-right`}>The other</th>
                <th className={th}>What it is</th>
              </tr>
            </thead>
            <tbody>
              {diff.rows.map((r) => {
                const meta = ref?.parameters[r.name];
                const mine = set.entries.find((e) => e.name === r.name);
                const active = mine ? entryKey(mine) === selected : false;
                const td = `border-b border-edge px-3 py-1.5 align-baseline ${active ? ACCENT.row : ''}`;
                const cell = (v: number | null) =>
                  v === null ? (
                    <span className="font-sans text-ink-muted">not there</span>
                  ) : (
                    <>
                      {v}
                      {valueMeaning(v, meta) ? <span className="ml-1.5 font-sans text-[10px] text-ink-muted">{valueMeaning(v, meta)}</span> : null}
                    </>
                  );
                return (
                  <tr
                    key={`${r.kind}/${r.name}`}
                    onClick={() => mine && select(entryKey(mine))}
                    className={mine ? 'cursor-pointer transition-colors hover:bg-control/60' : ''}
                  >
                    <td className={`${td} font-mono font-medium text-ink`}>{r.name}</td>
                    <td className={`${td} whitespace-nowrap text-ink-muted`}>{KIND[r.kind]}</td>
                    <td className={`${td} text-right font-mono text-ink`}>{cell(r.here)}</td>
                    <td className={`${td} text-right font-mono text-ink`}>{cell(r.there)}</td>
                    <td className={`${td} text-ink-muted`}>
                      {meta?.short ?? ''}
                      {meta?.unit ? ` Unit: ${meta.unit}.` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const PREVIEW_LIMIT = 300_000;

export function ParametersFile() {
  const format = useParamsStore((s) => s.exportFormat);
  const edited = useParamsStore((s) => s.set?.entries.filter(isEdited).length ?? 0);
  const learn = usePrefsStore((s) => s.learn);
  const written = useWrittenParams();
  const f = paramFormatById(format);
  const text = written?.ok ? new TextDecoder().decode(written.file.data) : '';
  const cut = text.length > PREVIEW_LIMIT;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-edge px-4 py-3">
        <label className="w-64 max-w-full space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Format</span>
          <ParamFormatSelect />
        </label>
        <button disabled={!written?.ok} onClick={() => written?.ok && downloadParams(written.file)} className={`${TOOL_BTN} py-2`}>
          <Download size={13} className="text-green-600 dark:text-green-500" />
          {written?.ok ? written.file.name : 'Download'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          <p className="max-w-3xl text-xs leading-snug text-ink-muted">
            <span className="font-semibold text-ink">{f.label}.</span> {f.about} Read by: {f.usedBy}. Definition taken
            from: {f.source}.
            {edited > 0 ? ` The ${edited} value${edited > 1 ? 's' : ''} changed here ${edited > 1 ? 'are' : 'is'} written with the new value.` : ''}
          </p>
          {learn && (
            <aside className="max-w-3xl rounded-lg border border-edge bg-control/50 p-3">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                <GraduationCap size={13} className={ACCENT.text} /> How to read this file
              </h3>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-snug text-ink">
                {PARAM_FORMAT_READING[format].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </aside>
          )}
          {written && !written.ok && <p className="text-sm text-ink">{written.reason}</p>}
          {written?.ok && (
            <>
              <section className="overflow-hidden rounded-lg border border-edge">
                <h3 className="flex items-center justify-between gap-3 border-b border-edge bg-control/60 px-3 py-1.5 font-mono text-[11px] text-ink">
                  <span className="truncate">{written.file.name}</span>
                  <span className="shrink-0 text-ink-muted">{text.split('\n').length - (text.endsWith('\n') ? 1 : 0)} lines</span>
                </h3>
                <pre className="max-h-[70vh] overflow-auto bg-surface-sunken p-3 font-mono text-[11px] leading-relaxed text-ink">
                  {cut ? text.slice(0, PREVIEW_LIMIT) : text}
                </pre>
                {cut && (
                  <p className="border-t border-edge px-3 py-1.5 text-[11px] text-ink-muted">
                    The beginning of the file is shown. The download holds all of it.
                  </p>
                )}
              </section>
              <section className="max-w-3xl rounded-lg border border-edge bg-surface-raised p-4">
                <CardReport report={written.file.report} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
