// The Assistant domain's chrome, all zero-prop and store-connected:
//   AssistantConversationsPanel — left-bottom: the conversations
//   AssistantAssistantPage, AssistantSeesPage, AssistantFilesPage — right drawer
//   Assistant*Action — the footer: [status][new][reserved][delete][save]
//   AssistantSettings — the Settings tab
'use client';
import { useMemo } from 'react';
import { Download, MessageCircle, MessagesSquare, Plus, Trash2 } from 'lucide-react';
import { ChatAttachment } from '@/components/chat/ChatParts';
import { DrawerSection, DrawerStat } from '@/components/ui/DrawerSection';
import { KeycapAction } from '@/components/ui/KeycapAction';
import { ADAPTERS, adapterById } from '@/lib/assistant/adapters';
import { downloadFile, slug } from '@/lib/units';
import { availabilityIn, transcript, useAdapterId, useAssistantStore, useAvailability } from '@/stores/core/assistantStore';
import { useLogsStore } from '@/stores/domains/logsStore';
import { useMissionsStore } from '@/stores/domains/missionsStore';
import { useParamsStore } from '@/stores/domains/paramsStore';

const ACCENT = 'text-orange-600 dark:text-orange-400';
const ACTIVE = 'border-orange-400 bg-orange-50/70 dark:border-orange-700 dark:bg-orange-950/30';
const IDLE = 'border-edge bg-surface-raised/60 hover:border-edge-strong/40';

export function AssistantConversationsPanel() {
  const conversations = useAssistantStore((s) => s.conversations);
  const activeId = useAssistantStore((s) => s.activeId);
  const open = useAssistantStore((s) => s.openConversation);
  const remove = useAssistantStore((s) => s.deleteConversation);
  const fresh = useAssistantStore((s) => s.newConversation);
  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-edge bg-surface-raised/95 px-3 py-2">
        <MessagesSquare size={13} className={ACCENT} />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Conversations</h3>
        <span className="ml-auto font-mono text-[10px] text-ink-muted">{conversations.length}</span>
      </div>
      <div className="space-y-1 p-2">
        <button onClick={fresh} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-edge py-1.5 text-xs text-ink-muted transition-colors hover:border-edge-strong/40 hover:text-ink">
          <Plus size={12} /> New conversation
        </button>
        {conversations.length === 0 && <p className="px-2 py-2 text-xs italic text-ink-muted opacity-60">None yet. They are kept in this browser.</p>}
        {conversations.map((c) => (
          <div key={c.id} className="group relative">
            <button onClick={() => void open(c.id)} className={`flex w-full flex-col rounded-md border px-2.5 py-1.5 pr-8 text-left transition-colors ${c.id === activeId ? ACTIVE : IDLE}`}>
              <span className="truncate text-xs font-medium text-ink">{c.title}</span>
              <span className="truncate text-[10px] text-ink-muted">
                {adapterById(c.adapter).label} · {c.messages} · {new Date(c.updatedAt).toLocaleDateString()}
              </span>
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Delete the conversation "${c.title}" and the files attached to it?`)) remove(c.id);
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
              title="Delete"
              aria-label={`Delete the conversation ${c.title}`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AssistantAssistantPage() {
  const chosen = useAdapterId();
  const desktop = useAssistantStore((s) => s.desktop);
  const setAdapter = useAssistantStore((s) => s.setAdapter);
  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Who answers" first>
        <div className="space-y-1.5" role="radiogroup" aria-label="Who answers">
          {ADAPTERS.map((a) => {
            const here = availabilityIn(a, desktop);
            const version = desktop?.find((d) => d.id === a.id)?.version;
            const on = a.id === chosen;
            return (
              <button
                key={a.id}
                role="radio"
                aria-checked={on}
                onClick={() => setAdapter(a.id)}
                className={`w-full rounded-md border p-2.5 text-left transition-colors ${on ? ACTIVE : IDLE}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{a.label}</span>
                  <span className="shrink-0 text-[10px] text-ink-muted">
                    {here.ok ? (version ? `found, version ${version}` : 'can answer here') : desktop ? 'not found' : 'needs the desktop app'}
                  </span>
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-ink-muted">{a.about}</span>
                {!here.ok && on && <span className="mt-1 block text-[11px] leading-snug text-ink">{here.why}</span>}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] leading-snug text-ink-muted">
          The app holds no key and no account. Where a real assistant answers, it is one you have installed and
          signed in to yourself, and your account with its maker does the work.
        </p>
      </DrawerSection>
    </div>
  );
}

export function AssistantSeesPage() {
  const mission = useMissionsStore((s) => s.mission);
  const set = useParamsStore((s) => s.set);
  const other = useParamsStore((s) => s.other);
  const log = useLogsStore((s) => s.logs.find((l) => l.id === s.activeId) ?? null);
  const place = useAssistantStore((s) => s.mayShowPlace);
  const setPlace = useAssistantStore((s) => s.setMayShowPlace);
  const adapter = adapterById(useAdapterId());
  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="What it can read" first>
        <DrawerStat label="Mission" value={mission ? mission.name : 'none open'} />
        <DrawerStat label="Parameters" value={set ? set.name : 'none open'} />
        {other && <DrawerStat label="Compared with" value={other.name} />}
        <DrawerStat label="Flight log" value={log?.summary ? log.name.replace(/\.ulg$/i, '') : 'none open'} />
        <p className="text-[11px] leading-snug text-ink-muted">
          It reads these when it uses a tool, and only then. Every use is a card in its answer. It reads what is
          open at that moment, so open something else and ask again.
        </p>
      </DrawerSection>

      <DrawerSection title="Where you fly">
        <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-orange-600" />
          <span>
            The assistant may be told where a flight took off
            <span className="block text-[11px] text-ink-muted">
              Off, a flight log is read with its position left out. A takeoff point is somebody&apos;s address.
              {adapter.isModel ? ` On, it goes to ${adapter.label}’s maker with the rest of the answer.` : ''}
            </span>
          </span>
        </label>
        <p className="text-[11px] leading-snug text-ink-muted">
          A mission holds positions and cannot be read without them. Do not open or attach a mission of a place
          you would not tell the assistant&apos;s maker about.
        </p>
      </DrawerSection>

      <DrawerSection title="Where your words go">
        <p className="text-[11px] leading-snug text-ink-muted">
          {adapter.isModel
            ? `What you type, what you attach and what the tools give back are sent to ${adapter.label}, and from there to its maker’s service, under your own account and their terms. This app sends nothing anywhere else.`
            : 'Nowhere. The practice assistant runs in this page. Nothing you type or attach leaves this computer.'}
        </p>
      </DrawerSection>
    </div>
  );
}

export function AssistantFilesPage() {
  const messages = useAssistantStore((s) => s.messages);
  const files = useMemo(() => messages.flatMap((m) => m.attachments ?? []), [messages]);
  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Attached to this conversation" first>
        {files.length === 0 && (
          <p className="text-xs italic leading-snug text-ink-muted opacity-80">
            Nothing yet. Use the paperclip, drop a file on the chat, or paste a picture.
          </p>
        )}
        <div className="flex flex-col items-start gap-2">
          {files.map((a) => (
            <ChatAttachment key={a.id} attachment={a} compact />
          ))}
        </div>
        <p className="text-[11px] leading-snug text-ink-muted">
          Kept in this browser with the conversation, and deleted with it. A mission, a parameter file, a flight
          log and text can be read by a tool. A picture is for an assistant that can see. A video is for you.
        </p>
      </DrawerSection>
    </div>
  );
}

export function AssistantStatusAction() {
  const busy = useAssistantStore((s) => s.busy);
  const adapter = adapterById(useAdapterId());
  const here = useAvailability(adapter);
  return (
    <div className="flex h-full w-full items-center justify-center gap-1.5 text-ink" title={here.ok ? adapter.about : here.why}>
      <MessageCircle size={13} className={busy ? 'animate-pulse text-status-good' : ACCENT} />
      <span className="truncate font-medium uppercase tracking-wide">{busy ? 'Answering' : here.ok ? adapter.label : 'Needs desktop app'}</span>
    </div>
  );
}

export function AssistantNewAction() {
  const fresh = useAssistantStore((s) => s.newConversation);
  const any = useAssistantStore((s) => s.messages.length > 0);
  return (
    <button
      onClick={fresh}
      disabled={!any}
      className={`group flex h-full w-full items-center justify-center gap-1.5 outline-none transition-colors ${
        any ? 'cursor-pointer hover:bg-control hover:text-orange-600 dark:hover:text-orange-400' : 'cursor-not-allowed opacity-40'
      }`}
      title="Start a new conversation. This one is kept."
    >
      <Plus size={13} />
      <span className="truncate font-medium uppercase tracking-wide">New chat</span>
    </button>
  );
}

export function AssistantDeleteAction() {
  const id = useAssistantStore((s) => s.activeId);
  const remove = useAssistantStore((s) => s.deleteConversation);
  return (
    <KeycapAction
      icon={Trash2}
      label="Delete"
      tone="red"
      disabled={!id}
      title="Delete this conversation and the files attached to it"
      onClick={() => {
        if (id && window.confirm('Delete this conversation and the files attached to it?')) remove(id);
      }}
    />
  );
}

export function AssistantSaveAction() {
  const messages = useAssistantStore((s) => s.messages);
  const title = useAssistantStore((s) => s.conversations.find((c) => c.id === s.activeId)?.title ?? 'Conversation');
  return (
    <KeycapAction
      icon={Download}
      label="Save"
      tone="green"
      disabled={messages.length === 0}
      title="Download the conversation as text, with the tools that were used"
      onClick={() => downloadFile(`${new Date().toISOString().slice(0, 10)}-${slug(title)}.md`, transcript(title, messages), 'text/markdown')}
    />
  );
}

export function AssistantSettings() {
  const conversations = useAssistantStore((s) => s.conversations.length);
  return (
    <div className="flex items-start gap-4">
      <div className="rounded-full bg-orange-100 p-3 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400">
        <MessageCircle size={24} />
      </div>
      <div className="min-w-0 flex-1 space-y-3 text-sm text-ink-muted">
        <h3 className="text-lg font-medium text-ink">Assistant</h3>
        <p>
          {conversations} conversation{conversations === 1 ? '' : 's'} in this browser, with the files attached to
          them. Deleting a conversation deletes its files.
        </p>
        <h4 className="pt-1 text-xs font-bold uppercase tracking-wider text-ink">Who answers</h4>
        <ul className="list-disc space-y-1.5 pl-5">
          {ADAPTERS.map((a) => (
            <li key={a.id}>
              <span className="font-medium text-ink">{a.label}.</span> {a.about}
            </li>
          ))}
        </ul>
        <h4 className="pt-1 text-xs font-bold uppercase tracking-wider text-ink">What an assistant can do here</h4>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Read the mission, the parameters and the log that are open, and files you attach.</li>
          <li>Look a parameter up in PX4&apos;s own reference for v1.16.0.</li>
          <li>Nothing else. It has no tool that changes the app, writes a file or sends to an aircraft.</li>
          <li>
            An assistant on your own computer can also be given the observer, which hears what an aircraft
            connected to QGroundControl is reporting. It listens and cannot send.
          </li>
        </ul>
        <h4 className="pt-1 text-xs font-bold uppercase tracking-wider text-ink">What has been checked</h4>
        <p>
          Claude Code was started with the command line this app builds, under the login it already had, with this
          app&apos;s tools server and no other tool. It used the tool and answered from it. That was done from a
          terminal: the desktop app that will do it from this chat is not built yet.
        </p>
        <p>
          An answer shows no picture from the internet. An address in an answer is chosen by whatever wrote the
          answer; it is shown as a link for you to decide on.
        </p>
      </div>
    </div>
  );
}
