// CardReport — what writing a file in some format kept, changed and could not
// hold. Shown before every download, so nothing is lost without being said.
// Spec: CardReport.md
'use client';
import type { ReactNode } from 'react';

export interface WriteReport {
  kept: string[];
  dropped: { what: string; count: number; why: string }[];
  changed: string[];
  warnings: string[];
}

function Block({ title, tone, size, children }: { title: string; tone: string; size: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className={`text-[10px] font-bold uppercase tracking-wider ${tone}`}>{title}</h4>
      <ul className={`space-y-1 leading-snug text-ink ${size}`}>{children}</ul>
    </div>
  );
}

export function CardReport({ report, compact = false }: { report: WriteReport; compact?: boolean }) {
  const size = compact ? 'text-[11px]' : 'text-xs';
  return (
    <div className="space-y-3">
      {report.dropped.length > 0 && (
        <Block size={size} title="Not in the file" tone="text-status-critical">
          {report.dropped.map((d) => (
            <li key={d.what + d.why}>
              <span className="font-semibold">
                {d.what} ({d.count})
              </span>
              <span className="text-ink-muted">: {d.why}.</span>
            </li>
          ))}
        </Block>
      )}
      {report.changed.length > 0 && (
        <Block size={size} title="Changed to fit" tone="text-ink-muted">
          {report.changed.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </Block>
      )}
      {report.kept.length > 0 && (
        <Block size={size} title="Kept" tone="text-ink-muted">
          {report.kept.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </Block>
      )}
      {report.warnings.length > 0 && (
        <Block size={size} title="Know before you use it" tone="text-ink-muted">
          {report.warnings.map((w) => (
            <li key={w} className="text-ink-muted">
              {w}
            </li>
          ))}
        </Block>
      )}
    </div>
  );
}
