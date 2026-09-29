// MissionsFooterActions — THE FOOTER SHAPE (all domains):
//   [ domain status ] [ domain action ] [ CENTER reserved ] [ Close (red) ] [ Save (green) ]
// Status = the worst check and the size of the mission. Action = write the file
// in the chosen format.
'use client';
import { FileDown, Save, X } from 'lucide-react';
import { KeycapAction } from '@/components/ui/KeycapAction';
import { formatById } from '@/lib/mission/formats';
import { useMissionChecks, useMissionsStore, useWritten } from '@/stores/domains/missionsStore';
import { ACCENT, downloadWritten, LEVEL_STYLE, worstLevel } from './MissionsParts';

export function MissionsStatusAction() {
  const count = useMissionsStore((s) => s.mission?.items.length ?? null);
  const checks = useMissionChecks();
  if (count === null) {
    return (
      <div className="flex h-full w-full items-center justify-center opacity-60">
        <span className="font-medium uppercase tracking-wide">No mission</span>
      </div>
    );
  }
  const level = worstLevel(checks);
  const L = LEVEL_STYLE[level];
  return (
    <div
      className="flex h-full w-full items-center justify-center gap-1.5 text-ink"
      title={
        level === 'critical'
          ? 'A check says stop. Open Checks in the tools drawer.'
          : level === 'warning'
            ? 'A check needs a look. Open Checks in the tools drawer.'
            : 'Nothing stands out in the checks'
      }
    >
      <L.icon size={13} className={L.tone} />
      <span className="truncate font-medium uppercase tracking-wide">
        {L.word} · {count} item{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

export function MissionsDownloadAction() {
  const format = useMissionsStore((s) => s.exportFormat);
  const written = useWritten();
  const ready = !!written?.ok;
  const ext = formatById(format).extensions[0];
  return (
    <button
      onClick={() => written?.ok && downloadWritten(written.file)}
      disabled={!ready}
      className={`group flex h-full w-full items-center justify-center gap-1.5 outline-none transition-colors ${
        ready ? `cursor-pointer hover:bg-control ${ACCENT.hoverText}` : 'cursor-not-allowed opacity-40'
      }`}
      title={
        written?.ok
          ? `Download ${written.file.name}. The format is chosen in the Export page of the tools drawer.`
          : written
            ? written.reason
            : 'Open a mission first'
      }
    >
      <FileDown size={13} className={ready ? 'transition-transform group-hover:-translate-y-0.5' : ''} />
      <span className="truncate font-medium uppercase tracking-wide">.{ext}</span>
    </button>
  );
}

export function MissionsCloseAction() {
  const open = useMissionsStore((s) => s.mission !== null);
  const dirty = useMissionsStore((s) => s.dirty);
  const closeMission = useMissionsStore((s) => s.closeMission);
  return (
    <KeycapAction
      icon={X}
      label="Close"
      tone="red"
      disabled={!open}
      title="Close this mission. Saved missions and files on disk are kept."
      onClick={() => {
        if (!dirty || window.confirm('Close this mission? Its changes have not been saved.')) closeMission();
      }}
    />
  );
}

export function MissionsSaveAction() {
  const open = useMissionsStore((s) => s.mission !== null);
  const save = useMissionsStore((s) => s.save);
  return (
    <KeycapAction
      icon={Save}
      label="Save"
      tone="green"
      disabled={!open}
      title="Save this mission to the list in the left drawer. To make a file, use Download."
      onClick={save}
    />
  );
}
