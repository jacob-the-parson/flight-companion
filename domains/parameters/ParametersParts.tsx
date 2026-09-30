// Small pieces shared by the Parameters workspace, its views and its drawer pages.
'use client';
import { useRef, useState } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import { ACCEPTED_PARAM_EXTENSIONS, PARAM_FORMATS, paramsDocument } from '@/lib/params/codecs';
import type { ParamFormatId, WrittenParams } from '@/lib/params/model';
import { downloadFile } from '@/lib/units';
import { useParamsStore } from '@/stores/domains/paramsStore';

/** The domain's accent, written out so the class scanner sees every name. */
export const ACCENT = {
  text: 'text-amber-600 dark:text-amber-400',
  hoverText: 'hover:text-amber-600 dark:hover:text-amber-400',
  chip: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
  active: 'border-amber-400 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/30',
  row: 'bg-amber-50/70 dark:bg-amber-950/30',
  drop: 'hover:border-amber-400 hover:bg-amber-50/40 dark:hover:bg-amber-950/20',
  dropping: 'border-amber-500 bg-amber-50/80 dark:bg-amber-950/70',
};

export const BTN =
  'flex w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-control py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40';

export const TOOL_BTN =
  'flex items-center gap-1.5 whitespace-nowrap rounded-md border border-edge bg-control px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40';

export function autopilotName(a: string): string {
  return a === 'px4' ? 'PX4' : a === 'ardupilot' ? 'ArduPilot' : 'Autopilot not stated';
}

export function ParamFormatSelect() {
  const format = useParamsStore((s) => s.exportFormat);
  const setExportFormat = useParamsStore((s) => s.setExportFormat);
  return (
    <select
      value={format}
      onChange={(e) => setExportFormat(e.target.value as ParamFormatId)}
      className={INPUT_CLASS}
      aria-label="File format"
    >
      {PARAM_FORMATS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label} (.{f.extensions[0]})
        </option>
      ))}
    </select>
  );
}

export function downloadParams(file: WrittenParams): void {
  const bytes = new Uint8Array(file.data);
  downloadFile(file.name, new Blob([bytes.buffer], { type: file.mime }), file.mime);
}

/** A hidden file input and the function that opens it. */
export function useFilePicker(onFiles: (files: File[]) => void, multiple = true) {
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_PARAM_EXTENSIONS.join(',')}
      multiple={multiple}
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length > 0) onFiles(files);
        e.target.value = '';
      }}
    />
  );
  return { input, open: () => inputRef.current?.click() };
}

/** Copy the set, with what each parameter is and what the app noticed, as JSON for an assistant. */
export function CopyParamsButton() {
  const set = useParamsStore((s) => s.set);
  const reference = useParamsStore((s) => s.reference);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    if (!set) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(paramsDocument(set, reference), null, 2));
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  };
  return (
    <div className="space-y-1.5">
      <button onClick={() => void copy()} disabled={!set} className={BTN}>
        {state === 'copied' ? <Check size={13} className="text-status-good" /> : <ClipboardCopy size={13} />}
        {state === 'copied' ? 'Copied' : 'Copy for an assistant'}
      </button>
      <p className="text-[11px] leading-snug text-ink-muted">
        {state === 'failed'
          ? 'The browser did not allow the copy. Download the parameter document instead: it holds the same.'
          : 'Puts every parameter on the clipboard as JSON, with what it is, its unit and limits and what the app noticed, to paste into Claude, ChatGPT or another assistant.'}
      </p>
    </div>
  );
}
