// AssistantWidget — the small assistant in the corner of every domain. It is
// the same conversation as the Assistant screen, in a smaller window. On the
// Assistant screen itself it is not drawn.
//
// It also does the two jobs that belong to the app as a whole: it tells the
// assistant's tools where to look (the other domains' stores), and it brings
// the open conversation back from storage. A meta-domain, like the dashboard,
// is allowed to read every domain's store; it changes none of them.
'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Maximize2, MessageCircle, Plus, X } from 'lucide-react';
import { ChatInput, ChatThread } from '@/components/chat/ChatThread';
import { adapterById } from '@/lib/assistant/adapters';
import { setToolContext, useAdapterId, useAssistantStore } from '@/stores/core/assistantStore';
import { useShellStore } from '@/stores/core/shellStore';
import { useLogsStore } from '@/stores/domains/logsStore';
import { useMissionsStore } from '@/stores/domains/missionsStore';
import { useParamsStore } from '@/stores/domains/paramsStore';

/** Where the tools look. Each function reads a store at the moment a tool runs. */
function connectTools(): void {
  setToolContext({
    mission: () => useMissionsStore.getState().mission,
    parameters: () => {
      const s = useParamsStore.getState();
      return { set: s.set, other: s.other };
    },
    reference: async () => {
      const s = useParamsStore.getState();
      if (!s.reference) await s.loadReference();
      return useParamsStore.getState().reference;
    },
    log: () => {
      const s = useLogsStore.getState();
      const l = s.logs.find((x) => x.id === s.activeId);
      return l?.summary ? { name: l.name, summary: l.summary } : null;
    },
  });
}

const WHERE: Record<string, string> = {
  missions: 'Ask about the mission that is open.',
  parameters: 'Ask about the parameters that are open, or type a parameter’s name.',
  logs: 'Ask about the flight log that is open.',
  planner: 'Send the plan to Missions, then ask about it here.',
  checklists: 'Type a parameter’s name to see what PX4 says it is.',
};

export function AssistantWidget() {
  const segment = usePathname()?.split('/').filter(Boolean)[0] ?? 'dashboard';
  const open = useAssistantStore((s) => s.widgetOpen);
  const setOpen = useAssistantStore((s) => s.setWidgetOpen);
  const restore = useAssistantStore((s) => s.restore);
  const newConversation = useAssistantStore((s) => s.newConversation);
  const busy = useAssistantStore((s) => s.busy);
  const count = useAssistantStore((s) => s.messages.length);
  const compact = useShellStore((s) => s.tier === 'compact');
  const drawerOpen = useShellStore((s) => s.rightOpen);
  const adapter = adapterById(useAdapterId());

  useEffect(() => {
    connectTools();
    void restore();
    // parameters that were open before a reload are brought back, so a tool can see them
    void useParamsStore.getState().restore();
  }, [restore]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (segment === 'assistant') return null;
  // on a phone a drawer is laid over the page; the widget keeps out of its way
  const hidden = compact && drawerOpen;

  return (
    <div className="print:hidden">
      <AnimatePresence>
        {open && !hidden && (
          <motion.section
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.35 }}
            aria-label="Assistant"
            className={`fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-edge bg-surface-raised shadow-vibe-lg ${
              compact ? 'inset-x-2 bottom-[4.5rem] top-16' : 'bottom-[4.75rem] right-5 h-[min(36rem,calc(100dvh-9rem))] w-[24rem]'
            }`}
          >
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-3">
              <MessageCircle size={15} className="text-secondary" />
              <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                {adapter.label}
                {!adapter.isModel && <span className="ml-1.5 font-normal text-ink-muted">not an AI</span>}
              </h2>
              <button onClick={newConversation} className="rounded p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink" title="Start a new conversation" aria-label="New conversation">
                <Plus size={15} />
              </button>
              <Link href="/assistant" onClick={() => setOpen(false)} className="rounded p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink" title="Open the Assistant screen" aria-label="Open the Assistant screen">
                <Maximize2 size={14} />
              </Link>
              <button onClick={() => setOpen(false)} className="rounded p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink" title="Close" aria-label="Close the assistant">
                <X size={15} />
              </button>
            </header>
            <ChatThread
              compact
              empty={
                <div className="space-y-2 p-4 text-xs leading-snug text-ink-muted">
                  <p className="text-sm font-medium text-ink">{WHERE[segment] ?? 'Ask about what is open in the app.'}</p>
                  <p>{adapter.about}</p>
                  <p>Attach a picture, a video, a mission, a parameter file or a flight log with the paperclip, or drop it on the box.</p>
                </div>
              }
            />
            <ChatInput compact />
          </motion.section>
        )}
      </AnimatePresence>

      {!hidden && !open && (
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? 'Close the assistant' : 'Open the assistant'}
          title={open ? 'Close the assistant' : 'Ask the assistant'}
          className="fixed bottom-[4.75rem] right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-white shadow-vibe-lg transition-transform hover:scale-105"
        >
          <MessageCircle size={20} />
          {busy && <span className="absolute right-0 top-0 h-3 w-3 animate-pulse rounded-full border-2 border-surface-raised bg-status-good" aria-hidden />}
          {!busy && count > 0 && <span className="sr-only">{count} messages in the conversation</span>}
        </button>
      )}
    </div>
  );
}
