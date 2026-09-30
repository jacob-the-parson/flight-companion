// AssistantWorkspace — the center surface. The chat is the main screen:
//   HeaderWorkspace [ identity · view switch · new conversation ]
//   → the conversation, and the box it is written in.
// The other views teach what MCP is, guide the setup, and list the tools.
'use client';
import { useState } from 'react';
import { BookOpen, MessageCircle, Plus, TriangleAlert, Wrench, X, Plug } from 'lucide-react';
import { ChatInput, ChatThread } from '@/components/chat/ChatThread';
import { HeaderWorkspace } from '@/components/ui/HeaderWorkspace';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import { adapterById } from '@/lib/assistant/adapters';
import { useAdapterId, useAssistantStore, type AssistantView } from '@/stores/core/assistantStore';
import { useLogsStore } from '@/stores/domains/logsStore';
import { useMissionsStore } from '@/stores/domains/missionsStore';
import { useParamsStore } from '@/stores/domains/paramsStore';
import { AssistantLearn, AssistantSetup, AssistantTools } from './AssistantViews';

export const ACCENT = 'text-orange-600 dark:text-orange-400';

const VIEWS: { id: AssistantView; label: string; short: string; icon: typeof MessageCircle; title: string }[] = [
  { id: 'chat', label: 'Chat', short: 'Chat', icon: MessageCircle, title: 'Talk to the assistant' },
  { id: 'learn', label: 'How it works', short: 'How', icon: BookOpen, title: 'What MCP is, with a tool to try by hand' },
  { id: 'setup', label: 'Set up', short: 'Set up', icon: Plug, title: 'Give an assistant on your own computer this app’s tools' },
  { id: 'tools', label: 'Tools', short: 'Tools', icon: Wrench, title: 'Every tool, and every assistant' },
];

function Welcome() {
  const send = useAssistantStore((s) => s.send);
  const setView = useAssistantStore((s) => s.setView);
  const adapter = adapterById(useAdapterId());
  const desktop = useAssistantStore((s) => s.desktop);
  const mission = useMissionsStore((s) => s.mission?.name ?? null);
  const params = useParamsStore((s) => s.set?.name ?? null);
  const log = useLogsStore((s) => s.logs.find((l) => l.id === s.activeId)?.name ?? null);
  const open = [mission && `the mission "${mission}"`, params && `the parameters "${params}"`, log && `the log "${log}"`].filter(Boolean);

  const starters = [
    'What is COM_KILL_DISARM?',
    'find battery low',
    ...(mission ? ['Tell me about the mission'] : []),
    ...(params ? ['What stands out in the parameters?'] : []),
    ...(log ? ['How was the battery in the flight?'] : []),
    'What is open?',
  ].slice(0, 5);

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-5 p-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-ink">Ask about your aircraft&apos;s files</h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          The assistant can read the mission, the parameters and the flight log that are open in the app, and any
          file you attach. It looks parameters up in PX4&apos;s own reference. It cannot change anything, and it
          cannot send anything to an aircraft.
        </p>
        <p className="text-xs text-ink-muted">
          {open.length > 0 ? `Open now: ${open.join(', ')}.` : 'Nothing is open in the app yet. Open an example in Missions or Parameters, or attach a file here.'}
        </p>
      </div>

      <div className="rounded-xl border border-edge bg-surface-raised p-4">
        <p className="text-xs font-semibold text-ink">
          {adapter.label}
          {!adapter.isModel && <span className="ml-1.5 font-normal text-ink-muted">not an AI</span>}
        </p>
        <p className="mt-1 text-xs leading-snug text-ink-muted">{adapter.about}</p>
        {!adapter.isModel && (
          <p className="mt-2 text-xs leading-snug text-ink-muted">
            {desktop
              ? `A real assistant, Claude Code, answers here once it is installed and signed in. ${desktop.find((d) => d.id === 'claude-code')?.why ?? ''} Until then this one shows how the tools work,`
              : 'A real assistant, Claude Code, answers in the desktop app. Until then this one shows how the tools work,'}{' '}
            and{' '}
            <button onClick={() => setView('setup')} className="text-secondary underline underline-offset-2">
              your own assistant can be given the same tools
            </button>
            .
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {starters.map((s) => (
          <button
            key={s}
            onClick={() => void send(s, [])}
            className="rounded-full border border-edge bg-surface-raised px-3 py-1.5 text-xs text-ink transition-colors hover:border-edge-strong/40 hover:bg-control"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AssistantWorkspace() {
  const view = useAssistantStore((s) => s.view);
  const setView = useAssistantStore((s) => s.setView);
  const notice = useAssistantStore((s) => s.notice);
  const dismissNotice = useAssistantStore((s) => s.dismissNotice);
  const newConversation = useAssistantStore((s) => s.newConversation);
  const send = useAssistantStore((s) => s.send);
  const title = useAssistantStore((s) => s.conversations.find((c) => c.id === s.activeId)?.title ?? null);
  const count = useAssistantStore((s) => s.messages.length);
  const adapter = adapterById(useAdapterId());
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        if (view === 'chat' && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        // a file dropped anywhere on the chat is sent as it is, with no words
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (view === 'chat' && files.length > 0) void send('', files);
      }}
    >
      <HeaderWorkspace
        icon={MessageCircle}
        iconClass={ACCENT}
        title={view === 'chat' && title ? title : 'Assistant'}
        subtitle={`${adapter.label}${adapter.isModel ? '' : ', not an AI'} · ${count > 0 ? `${count} message${count === 1 ? '' : 's'}` : 'reads what is open in the app and what you attach'}`}
        center={<SegmentedTrack ariaLabel="Assistant view" options={VIEWS} value={view} onChange={setView} />}
        actions={
          <button onClick={newConversation} className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-edge bg-control px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken" title="Start a new conversation">
            <Plus size={13} /> <span className="hidden @md:inline">New</span>
          </button>
        }
      />

      {notice && (
        <div role="status" className="flex shrink-0 items-start gap-2 border-b border-edge bg-amber-50/70 px-4 py-2 text-xs text-ink dark:bg-amber-950/30">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-status-warning" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={dismissNotice} className="rounded p-0.5 text-ink-muted hover:text-ink" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {view === 'chat' && (
        <>
          <ChatThread empty={<Welcome />} />
          <ChatInput />
        </>
      )}
      {view === 'learn' && <div className="min-h-0 flex-1"><AssistantLearn /></div>}
      {view === 'setup' && <div className="min-h-0 flex-1"><AssistantSetup /></div>}
      {view === 'tools' && <div className="min-h-0 flex-1"><AssistantTools /></div>}

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-[600] flex items-center justify-center rounded-xl border-2 border-dashed border-orange-500 bg-orange-50/80 text-base font-semibold text-ink dark:bg-orange-950/70">
          Drop to attach and send
        </div>
      )}
    </div>
  );
}
