// Parameters right-drawer pages (zero-prop, store-connected):
//   ParametersParameterPage — the selected parameter: what it is, its value, a note
//   ParametersFindingsPage  — what stands out in the set, worst first
//   ParametersSetPage       — the set as a whole: name, where it came from
//   ParametersExportPage    — choose a format, read what it drops, download
'use client';
import { Download, Undo2 } from 'lucide-react';
import { CardCheck } from '@/components/ui/CardCheck';
import { CardReport } from '@/components/ui/CardReport';
import { DrawerField, DrawerSection, DrawerStat } from '@/components/ui/DrawerSection';
import { FieldNumber } from '@/components/ui/FieldNumber';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import { flagsOf, listedLabel, valueMeaning } from '@/lib/params/analysis';
import { paramFormatById } from '@/lib/params/codecs';
import { isEdited, isFloatType, MAV_PARAM_TYPE, valueText } from '@/lib/params/model';
import { entryKey, useFindings, useParamsStore, useSelectedEntry, useWrittenParams } from '@/stores/domains/paramsStore';
import { autopilotName, BTN, CopyParamsButton, downloadParams, ParamFormatSelect } from './ParametersParts';
import { FlagTags } from './ParametersViews';

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="p-4 text-xs italic leading-snug text-ink-muted opacity-80">{children}</p>
);

export function ParametersParameterPage() {
  const set = useParamsStore((s) => s.set);
  const reference = useParamsStore((s) => s.reference);
  const setValue = useParamsStore((s) => s.setValue);
  const putBack = useParamsStore((s) => s.putBack);
  const setNote = useParamsStore((s) => s.setNote);
  const e = useSelectedEntry();
  if (!set) return <Empty>Open a parameter file to see its parameters here.</Empty>;
  if (!e) return <Empty>Select a parameter in the list to see what it is and to change its value.</Empty>;

  const meta = set.autopilot === 'ardupilot' ? undefined : reference?.parameters[e.name];
  const flags = flagsOf(e, meta, set.autopilot);
  const k = entryKey(e);
  const whole = e.type !== null ? !isFloatType(e.type) : meta ? meta.type !== 'FLOAT' : Number.isInteger(e.value);
  const meaning = valueMeaning(e.value, meta);
  const listed = meta?.values ? Object.entries(meta.values) : null;
  const bits = meta?.bits ? Object.entries(meta.bits) : null;
  const edited = isEdited(e);

  return (
    <div className="space-y-6 p-4">
      <header className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{meta?.group ?? 'Not in the reference'}</p>
        <p className="break-all font-mono text-sm font-semibold text-ink">{e.name}</p>
        {meta && <p className="text-sm leading-snug text-ink">{meta.short}</p>}
        {meta?.long && <p className="text-xs leading-snug text-ink-muted">{meta.long}</p>}
        <p className="flex flex-wrap gap-1 pt-0.5">
          <FlagTags flags={flags} />
        </p>
        {!meta && set.autopilot !== 'ardupilot' && reference && (
          <p className="text-xs leading-snug text-ink-muted">
            {flags.ardupilotLike
              ? 'PX4 has no parameter by this name. It has the shape of an ArduPilot name. There is no table that turns one autopilot’s names into the other’s: look up in PX4’s documentation which parameter does what this one was for.'
              : `The ${reference.firmware} reference does not list this name, so the app cannot say what it is. A board can have parameters the reference leaves out.`}
          </p>
        )}
        {set.autopilot === 'ardupilot' && (
          <p className="text-xs leading-snug text-ink-muted">
            This is an ArduPilot set. The app holds no ArduPilot reference, so it cannot say what the parameter is.
          </p>
        )}
      </header>

      <DrawerSection title="Value" first>
        {listed ? (
          <DrawerField label="Value">
            <select value={String(e.value)} onChange={(ev) => setValue(k, Number(ev.target.value))} className={INPUT_CLASS}>
              {listedLabel(e.value, meta) === null && <option value={String(e.value)}>{e.value} (not listed)</option>}
              {listed.map(([v, label]) => (
                <option key={v} value={String(Number(v))}>
                  {Number(v)}: {label}
                </option>
              ))}
            </select>
          </DrawerField>
        ) : (
          <FieldNumber
            label="Value"
            unit={meta?.unit}
            step={meta?.increment ?? (whole ? 1 : undefined)}
            value={e.value}
            onChange={(v) => setValue(k, v)}
          />
        )}
        {meaning && !listed && <p className="text-xs text-ink">Switched on: {meaning}.</p>}
        {bits && (
          <ul className="space-y-1">
            {bits.map(([bit, label]) => {
              const on = Number.isInteger(e.value) && (Math.floor(e.value / 2 ** Number(bit)) & 1) === 1;
              return (
                <li key={bit}>
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setValue(k, e.value + (on ? -1 : 1) * 2 ** Number(bit))}
                      className="mt-0.5 h-3.5 w-3.5 accent-amber-600"
                    />
                    <span>
                      {label} <span className="font-mono text-[10px] text-ink-muted">bit {bit}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {(flags.belowMin || flags.aboveMax) && meta && (
          <p className="rounded-lg border border-amber-300 bg-amber-50/70 p-2.5 text-xs leading-snug text-ink dark:border-amber-800 dark:bg-amber-950/30">
            {flags.belowMin ? `Below the lowest value the reference gives, ${meta.min}.` : `Above the highest value the reference gives, ${meta.max}.`}{' '}
            The app lets you type any number: it does not know your aircraft. Check the unit
            {meta.unit ? `, which is "${meta.unit}"` : ''}.
          </p>
        )}
        {edited && (
          <button onClick={() => putBack(k)} className={BTN}>
            <Undo2 size={13} /> Put back {e.original}, the value the file had
          </button>
        )}
      </DrawerSection>

      {meta && (
        <DrawerSection title="From PX4’s reference">
          {meta.default !== undefined && (
            <DrawerStat
              label="Firmware default"
              value={`${meta.default}${meta.default_means ? ` ${meta.default_means}` : valueMeaning(meta.default, meta) && !meta.bits ? ` ${valueMeaning(meta.default, meta)}` : ''}`}
            />
          )}
          {meta.min !== undefined && <DrawerStat label="Lowest" value={meta.min} />}
          {meta.max !== undefined && <DrawerStat label="Highest" value={meta.max} />}
          {meta.increment !== undefined && <DrawerStat label="Step" value={meta.increment} />}
          {meta.unit && <DrawerStat label="Unit" value={meta.unit} />}
          <DrawerStat label="Type" value={meta.type} />
          <DrawerStat label="After a change" value={meta.reboot_required ? 'restart the autopilot' : 'takes effect at once'} />
          <p className="text-[11px] leading-snug text-ink-muted">
            These are PX4’s words and numbers for {reference?.firmware}. The default is the firmware’s: choosing an
            airframe changes many parameters from it.
          </p>
        </DrawerSection>
      )}

      <DrawerSection title="In the file">
        <DrawerStat label="Written as" value={valueText(e)} />
        <DrawerStat label="MAVLink type" value={e.type === null ? 'not given' : `${e.type} ${MAV_PARAM_TYPE[e.type]}`} />
        <DrawerStat label="Vehicle · component" value={`${e.vehicleId} · ${e.componentId}`} />
      </DrawerSection>

      <DrawerSection title="Your note">
        <textarea
          value={e.note ?? ''}
          onChange={(ev) => setNote(k, ev.target.value)}
          rows={3}
          placeholder="Why it is set this way, and who decided"
          className={`${INPUT_CLASS} resize-y text-xs`}
          aria-label={`Note on ${e.name}`}
        />
        <p className="text-[11px] leading-snug text-ink-muted">
          Kept in saved sets, in the table and in the parameter document. A ground station’s file has nowhere for it.
        </p>
      </DrawerSection>
    </div>
  );
}

export function ParametersFindingsPage() {
  const set = useParamsStore((s) => s.set);
  const select = useParamsStore((s) => s.select);
  const setView = useParamsStore((s) => s.setView);
  const findings = useFindings();
  if (!set) return <Empty>Open a parameter file to see what stands out in it.</Empty>;
  return (
    <div className="space-y-3 p-4">
      {findings.map((f) => (
        <CardCheck
          key={f.id}
          level={f.level}
          title={f.title}
          detail={f.detail}
          chips={f.names}
          chipLimit={f.id === 'not-default' ? 0 : 10}
          chipTitle={(n) => `Select ${n}`}
          onChip={(n) => {
            const e = set.entries.find((x) => x.name === n);
            if (e) {
              select(entryKey(e));
              setView('list');
            }
          }}
        />
      ))}
      <p className="text-[11px] leading-snug text-ink-muted">
        The findings read the file and PX4’s reference and nothing else. They say whether the file is well formed.
        They cannot say whether the aircraft is set up correctly: that is decided on the bench, one parameter at a
        time, with the reason written down.
      </p>
    </div>
  );
}

export function ParametersSetPage() {
  const set = useParamsStore((s) => s.set);
  const reference = useParamsStore((s) => s.reference);
  const referenceState = useParamsStore((s) => s.referenceState);
  const rename = useParamsStore((s) => s.rename);
  if (!set) return <Empty>Open a parameter file to see where it came from.</Empty>;
  const edited = set.entries.filter(isEdited).length;
  const components = [...new Set(set.entries.map((e) => e.componentId))];
  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Set" first>
        <DrawerField label="Name">
          <input value={set.name} onChange={(e) => rename(e.target.value)} className={INPUT_CLASS} />
        </DrawerField>
        <DrawerStat label="Parameters" value={set.entries.length} />
        <DrawerStat label="Changed here" value={edited} />
        <DrawerStat label="With a note" value={set.entries.filter((e) => e.note).length} />
        <DrawerStat label="Components" value={components.join(', ')} />
      </DrawerSection>

      <DrawerSection title="Whose parameters">
        <DrawerStat label="Autopilot" value={autopilotName(set.autopilot)} />
        <p className="text-[11px] leading-snug text-ink-muted">Worked out from: {set.autopilotFrom}.</p>
        {set.stack && <DrawerStat label="Stack" value={set.stack} />}
        {set.vehicle && <DrawerStat label="Vehicle" value={set.vehicle} />}
        {set.version && <DrawerStat label="Version" value={set.version.trim()} />}
        {set.gitRevision && <DrawerStat label="Revision" value={set.gitRevision.slice(0, 12)} />}
        {set.sourceFile && <p className="break-all font-mono text-[11px] text-ink-muted">{set.sourceFile}</p>}
      </DrawerSection>

      <DrawerSection title="Reference">
        {referenceState === 'ready' && reference ? (
          <>
            <DrawerStat label="Firmware" value={reference.firmware} />
            <DrawerStat label="Parameters in it" value={reference.count} />
            <p className="text-[11px] leading-snug text-ink-muted">
              Descriptions, units, limits and defaults are PX4’s own, from its documentation. Licence: {reference.licence}
            </p>
          </>
        ) : (
          <p className="text-xs leading-snug text-ink-muted">
            {referenceState === 'failed' ? 'The reference could not be loaded.' : 'Loading the reference.'}
          </p>
        )}
      </DrawerSection>

      {set.notes.length > 0 && (
        <DrawerSection title="Notes from reading the file">
          <ul className="list-disc space-y-1.5 pl-4 text-[11px] leading-snug text-ink-muted">
            {set.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </DrawerSection>
      )}
    </div>
  );
}

export function ParametersExportPage() {
  const has = useParamsStore((s) => s.set !== null);
  const format = useParamsStore((s) => s.exportFormat);
  const written = useWrittenParams();
  if (!has) return <Empty>Open a parameter file to write it in another format.</Empty>;
  const f = paramFormatById(format);
  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Format" first>
        <ParamFormatSelect />
        <p className="text-[11px] leading-snug text-ink-muted">
          {f.about} Read by: {f.usedBy}.
        </p>
      </DrawerSection>

      <DrawerSection title="What the file will hold">
        {written && !written.ok && <p className="text-xs leading-snug text-ink">{written.reason}</p>}
        {written?.ok && <CardReport report={written.file.report} compact />}
      </DrawerSection>

      <DrawerSection title="Download">
        <button disabled={!written?.ok} onClick={() => written?.ok && downloadParams(written.file)} className={BTN}>
          <Download size={13} className="text-green-600 dark:text-green-500" />
          {written?.ok ? written.file.name : `Download .${f.extensions[0]}`}
        </button>
        <CopyParamsButton />
      </DrawerSection>

      {f.loadable && (
        <DrawerSection title="Before you load it">
          <ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-snug text-ink-muted">
            <li>Save the aircraft’s own parameters to a file first. That file is the way back.</li>
            <li>Props off. Load the file from the ground station: this app never talks to an aircraft.</li>
            <li>Restart the autopilot, then save the parameters again.</li>
            <li>Compare that file with the one from step 1 here, and explain every row that moved.</li>
          </ol>
        </DrawerSection>
      )}
    </div>
  );
}
