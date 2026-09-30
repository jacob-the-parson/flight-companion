// ParametersFooterActions — THE FOOTER SHAPE (all domains):
//   [ domain status ] [ domain action ] [ CENTER reserved ] [ Close (red) ] [ Save (green) ]
// Status = the worst finding and the size of the set. Action = write the file
// in the chosen format.
'use client';
import { FileDown, Save, X } from 'lucide-react';
import { LEVEL_STYLE, worstLevel } from '@/components/ui/CardCheck';
import { KeycapAction } from '@/components/ui/KeycapAction';
import { paramFormatById } from '@/lib/params/codecs';
import { useFindings, useParamsStore, useWrittenParams } from '@/stores/domains/paramsStore';
import { ACCENT, downloadParams } from './ParametersParts';

export function ParametersStatusAction() {
  const count = useParamsStore((s) => s.set?.entries.length ?? null);
  const findings = useFindings();
  if (count === null) {
    return (
      <div className="flex h-full w-full items-center justify-center opacity-60">
        <span className="font-medium uppercase tracking-wide">No set</span>
      </div>
    );
  }
  const level = worstLevel(findings.map((f) => f.level));
  const L = LEVEL_STYLE[level];
  return (
    <div
      className="flex h-full w-full items-center justify-center gap-1.5 text-ink"
      title={
        level === 'critical'
          ? 'A finding says stop. Open Findings in the tools drawer.'
          : level === 'warning'
            ? 'A finding needs a look. Open Findings in the tools drawer.'
            : 'Nothing stands out in the file'
      }
    >
      <L.icon size={13} className={L.tone} />
      <span className="truncate font-medium uppercase tracking-wide">
        {L.word} · {count}
      </span>
    </div>
  );
}

export function ParametersDownloadAction() {
  const format = useParamsStore((s) => s.exportFormat);
  const written = useWrittenParams();
  const ready = !!written?.ok;
  return (
    <button
      onClick={() => written?.ok && downloadParams(written.file)}
      disabled={!ready}
      className={`group flex h-full w-full items-center justify-center gap-1.5 outline-none transition-colors ${
        ready ? `cursor-pointer hover:bg-control ${ACCENT.hoverText}` : 'cursor-not-allowed opacity-40'
      }`}
      title={
        written?.ok
          ? `Download ${written.file.name}. The format is chosen in the Export page of the tools drawer.`
          : written
            ? written.reason
            : 'Open a parameter file first'
      }
    >
      <FileDown size={13} className={ready ? 'transition-transform group-hover:-translate-y-0.5' : ''} />
      <span className="truncate font-medium uppercase tracking-wide">.{paramFormatById(format).extensions[0]}</span>
    </button>
  );
}

export function ParametersCloseAction() {
  const open = useParamsStore((s) => s.set !== null);
  const dirty = useParamsStore((s) => s.dirty);
  const closeSet = useParamsStore((s) => s.closeSet);
  return (
    <KeycapAction
      icon={X}
      label="Close"
      tone="red"
      disabled={!open}
      title="Close this set. Saved sets and files on disk are kept."
      onClick={() => {
        if (!dirty || window.confirm('Close this set? Its changes have not been saved.')) closeSet();
      }}
    />
  );
}

export function ParametersSaveAction() {
  const open = useParamsStore((s) => s.set !== null);
  const save = useParamsStore((s) => s.save);
  return (
    <KeycapAction
      icon={Save}
      label="Save"
      tone="green"
      disabled={!open}
      title="Save this set, with its notes, to the list in the left drawer. To make a file, use Download."
      onClick={() => void save()}
    />
  );
}
