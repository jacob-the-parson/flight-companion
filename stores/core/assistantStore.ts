// Assistant — the conversations, the one that is open, and which adapter
// answers. Core, not a domain store: the widget is in every domain and talks
// to the same conversation as the Assistant screen.
//
// Three kinds of memory:
//   - the LIST of conversations and the settings are in localStorage;
//   - the messages of each conversation are in IndexedDB, fc-chat:<id>;
//   - attached files are in IndexedDB, fc-chat-file:<id>, and nowhere else.
//
// The tools need to see what is open in the other domains. A core store may not
// import a domain store, so the app hands in a function that looks
// (setToolContext), from globals/assistant/AssistantContext.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import { ADAPTERS, adapterById, practiceAdapter } from '@/lib/assistant/adapters';
import { appTools, openFiles, type ToolContext } from '@/lib/assistant/tools';
import {
  ATTACHMENT_LIMIT_BYTES,
  attachmentKind,
  desktopBridge,
  type AssistantAdapter,
  type Attachment,
  type AssistantEvent,
  type Availability,
  type ChatMessage,
} from '@/lib/assistant/types';
import { uid } from '@/lib/units';

export type AssistantView = 'chat' | 'learn' | 'setup' | 'tools';

export interface ConversationInfo {
  id: string;
  title: string;
  updatedAt: number;
  messages: number;
  /** To continue the conversation, where the adapter gives one. */
  sessionId: string | null;
  adapter: string;
}

const chatKey = (id: string) => `fc-chat:${id}`;
const fileKey = (id: string) => `fc-chat-file:${id}`;
const CONVERSATION_LIMIT = 60;

export interface DesktopFound {
  id: string;
  found: boolean;
  version: string | null;
  why?: string;
}

const NEEDS_DESKTOP = 'It is a program on your computer, and a web page cannot start a program. It works in the Flight Companion desktop app.';

/** Can this adapter answer here? For one that needs the desktop app: is the app here, and did it find the program. */
export function availabilityIn(adapter: AssistantAdapter, desktop: DesktopFound[] | null): Availability {
  if (adapter.needs !== 'desktop') return adapter.availability();
  if (!desktop) return { ok: false, why: NEEDS_DESKTOP };
  const found = desktop.find((d) => d.id === adapter.id);
  if (found?.found) return { ok: true };
  return { ok: false, why: found?.why ?? `${adapter.label} was not found on this computer.` };
}

/** The adapter to start with: the first real assistant that can answer here, else the practice one. */
export function bestAdapterId(desktop: DesktopFound[] | null): string {
  return (ADAPTERS.find((a) => a.isModel && availabilityIn(a, desktop).ok) ?? practiceAdapter).id;
}

/** What the app can see, handed in by the app. Until it is, the tools see nothing open. */
type ContextParts = Pick<ToolContext, 'mission' | 'parameters' | 'reference' | 'log'>;
let lookAtApp: ContextParts = {
  mission: () => null,
  parameters: () => ({ set: null, other: null }),
  reference: async () => null,
  log: () => null,
};
export function setToolContext(parts: ContextParts): void {
  lookAtApp = parts;
}

interface AssistantState {
  conversations: ConversationInfo[];
  activeId: string | null;
  messages: ChatMessage[];
  /** '' until the user chooses: then the best adapter that can answer here. */
  adapterId: string;
  /** May the assistant be told where flights took place. */
  mayShowPlace: boolean;
  view: AssistantView;
  widgetOpen: boolean;
  busy: boolean;
  restored: boolean;
  notice: string | null;
  /**
   * What the desktop app found on this computer. null in a browser, and null
   * until the page has loaded: the first drawing of a page is the same
   * everywhere, and only then is it told where it is.
   */
  desktop: DesktopFound[] | null;

  restore: () => Promise<void>;
  newConversation: () => void;
  openConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => void;
  send: (text: string, files: File[]) => Promise<void>;
  stop: () => void;
  setAdapter: (id: string) => void;
  setMayShowPlace: (yes: boolean) => void;
  setView: (view: AssistantView) => void;
  setWidgetOpen: (open: boolean) => void;
  dismissNotice: () => void;
}

let running: AbortController | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function attachmentBytes(id: string): Promise<Uint8Array | null> {
  return idbGet<Uint8Array>(fileKey(id))
    .then((b) => b ?? null)
    .catch(() => null);
}

function titleOf(text: string, files: Attachment[]): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t) return t.length > 48 ? `${t.slice(0, 47)}…` : t;
  return files[0]?.name ?? 'New conversation';
}

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set, get) => {
      /** Write the open conversation's messages a moment after the last change. */
      const saveSoon = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const s = get();
          if (s.activeId) void idbSet(chatKey(s.activeId), s.messages).catch(() => undefined);
        }, 300);
      };
      const patchLast = (fn: (m: ChatMessage) => ChatMessage) => {
        set((s) => {
          const last = s.messages[s.messages.length - 1];
          return last && last.role === 'assistant' ? { messages: [...s.messages.slice(0, -1), fn(last)] } : s;
        });
        saveSoon();
      };
      const touch = (id: string, patch: Partial<ConversationInfo>) =>
        set((s) => ({
          conversations: s.conversations
            .map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now(), messages: s.messages.length } : c))
            .sort((a, b) => b.updatedAt - a.updatedAt),
        }));

      return {
        conversations: [],
        activeId: null,
        messages: [],
        adapterId: '',
        mayShowPlace: false,
        view: 'chat',
        widgetOpen: false,
        busy: false,
        restored: false,
        notice: null,
        desktop: null,

        restore: async () => {
          if (get().restored) return;
          const bridge = desktopBridge();
          if (bridge) {
            const desktop = (await bridge.assistants().catch(() => [])) as DesktopFound[];
            set({ desktop });
          }
          const id = get().activeId;
          const stored = id ? await idbGet<ChatMessage[]>(chatKey(id)).catch(() => undefined) : undefined;
          // an answer that was being written when the page closed was never finished
          const messages = (stored ?? []).map((m) => (m.state === 'streaming' ? { ...m, state: 'stopped' as const } : m));
          set((s) => ({ restored: true, messages: s.messages.length > 0 ? s.messages : messages, activeId: stored ? id : null }));
        },

        newConversation: () => {
          get().stop();
          set({ activeId: null, messages: [], notice: null, view: 'chat' });
        },

        openConversation: async (id) => {
          if (id === get().activeId) return;
          get().stop();
          const stored = await idbGet<ChatMessage[]>(chatKey(id)).catch(() => undefined);
          if (!stored) {
            set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id), notice: 'That conversation is no longer in this browser’s storage.' }));
            return;
          }
          set({ activeId: id, messages: stored, notice: null, view: 'chat' });
        },

        deleteConversation: (id) => {
          const s = get();
          if (id === s.activeId) s.stop();
          // what the desktop app kept on disk for it goes too
          void desktopBridge()?.forget(id).catch(() => undefined);
          // its attached files go with it
          void idbGet<ChatMessage[]>(chatKey(id))
            .then((messages) => {
              for (const m of messages ?? []) for (const a of m.attachments ?? []) void del(fileKey(a.id));
              return del(chatKey(id));
            })
            .catch(() => undefined);
          set({
            conversations: s.conversations.filter((c) => c.id !== id),
            ...(id === s.activeId ? { activeId: null, messages: [] } : null),
          });
        },

        send: async (text, files) => {
          const s = get();
          if (s.busy) return;
          const refused: string[] = [];
          const attachments: Attachment[] = [];
          for (const file of files) {
            if (file.size > ATTACHMENT_LIMIT_BYTES) {
              refused.push(`${file.name} is larger than ${Math.round(ATTACHMENT_LIMIT_BYTES / 1e6)} MB and was left out.`);
              continue;
            }
            const a: Attachment = { id: uid('file'), name: file.name, mime: file.type, bytes: file.size, kind: attachmentKind(file.name, file.type) };
            try {
              await idbSet(fileKey(a.id), new Uint8Array(await file.arrayBuffer()));
              attachments.push(a);
            } catch {
              refused.push(`${file.name} could not be kept: this browser refused the storage.`);
            }
          }
          if (text.trim() === '' && attachments.length === 0) {
            if (refused.length > 0) set({ notice: refused.join(' ') });
            return;
          }

          const adapter = adapterById(s.adapterId || bestAdapterId(s.desktop));
          const here = availabilityIn(adapter, s.desktop);
          const id = s.activeId ?? uid('chat');
          const user: ChatMessage = { id: uid('msg'), role: 'user', at: Date.now(), text: text.trim(), ...(attachments.length > 0 ? { attachments } : null) };
          const answer: ChatMessage = { id: uid('msg'), role: 'assistant', at: Date.now(), text: '', state: 'streaming', adapter: adapter.id };
          const history = s.messages;
          const info = s.conversations.find((c) => c.id === id);

          set((st) => ({
            activeId: id,
            messages: [...st.messages, user, answer],
            busy: true,
            notice: refused.length > 0 ? refused.join(' ') : null,
            conversations: info
              ? st.conversations
              : [{ id, title: titleOf(text, attachments), updatedAt: Date.now(), messages: 0, sessionId: null, adapter: adapter.id }, ...st.conversations].slice(0, CONVERSATION_LIMIT),
          }));
          touch(id, { adapter: adapter.id });
          saveSoon();

          if (!here.ok) {
            patchLast((m) => ({ ...m, state: 'failed', error: here.why ?? `${adapter.label} cannot answer here.` }));
            set({ busy: false });
            return;
          }

          const all = () => get().messages.flatMap((m) => m.attachments ?? []);
          const tools = appTools({ ...lookAtApp, attachments: all, attachmentBytes, mayShowPlace: () => get().mayShowPlace });
          const controller = new AbortController();
          running = controller;
          let ended = false;

          const emit = (e: AssistantEvent) => {
            // a conversation the user has left does not go on being written to
            if (get().activeId !== id || controller.signal.aborted) return;
            switch (e.type) {
              case 'started':
                patchLast((m) => ({ ...m, model: e.model }));
                if (e.sessionId) touch(id, { sessionId: e.sessionId });
                break;
              case 'text':
                patchLast((m) => ({ ...m, text: m.text + e.text }));
                break;
              case 'tool-call':
                patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), { id: e.id, name: e.name, input: e.input }] }));
                break;
              case 'tool-result':
                patchLast((m) => ({ ...m, tools: (m.tools ?? []).map((t) => (t.id === e.id ? { ...t, result: e.text, ok: e.ok } : t)) }));
                break;
              case 'notice':
                patchLast((m) => ({ ...m, notices: [...(m.notices ?? []), e.text] }));
                break;
              case 'done':
                ended = true;
                patchLast((m) => ({ ...m, state: 'done' }));
                if (e.sessionId) touch(id, { sessionId: e.sessionId });
                break;
              case 'error':
                ended = true;
                patchLast((m) => ({ ...m, state: 'failed', error: e.message }));
                break;
            }
          };

          try {
            await adapter.send(
              {
                history,
                message: user,
                sessionId: info?.sessionId ?? null,
                tools,
                attachmentBytes,
                conversationId: id,
                openFiles: () => openFiles({ ...lookAtApp, mayShowPlace: () => get().mayShowPlace }),
              },
              emit,
              controller.signal,
            );
          } catch (err) {
            emit({ type: 'error', message: err instanceof Error ? err.message : 'The assistant stopped without saying why.' });
          }
          if (get().activeId === id) {
            // stopped by the user, or ended without a word: neither is "done"
            if (!ended) patchLast((m) => (m.state === 'streaming' ? { ...m, state: 'stopped' } : m));
            touch(id, {});
          }
          if (running === controller) {
            running = null;
            set({ busy: false });
          }
        },

        stop: () => {
          if (!running) return;
          running.abort();
          running = null;
          patchLast((m) => (m.state === 'streaming' ? { ...m, state: 'stopped' } : m));
          set({ busy: false });
        },

        setAdapter: (adapterId) => set({ adapterId }),
        setMayShowPlace: (mayShowPlace) => set({ mayShowPlace }),
        setView: (view) => set({ view }),
        setWidgetOpen: (widgetOpen) => set({ widgetOpen }),
        dismissNotice: () => set({ notice: null }),
      };
    },
    {
      name: 'fc-assistant',
      version: 1,
      partialize: (s) => ({
        conversations: s.conversations,
        activeId: s.activeId,
        adapterId: s.adapterId,
        mayShowPlace: s.mayShowPlace,
        view: s.view,
      }),
    },
  ),
);

/** The adapter that will answer: the one chosen, else the best that can answer here. */
export function useAdapterId(): string {
  const chosen = useAssistantStore((s) => s.adapterId);
  const desktop = useAssistantStore((s) => s.desktop);
  return chosen || bestAdapterId(desktop);
}

export function useAvailability(adapter: AssistantAdapter): Availability {
  const desktop = useAssistantStore((s) => s.desktop);
  return availabilityIn(adapter, desktop);
}

/** The version the desktop app found, for an adapter that is a program. */
export function useFoundVersion(adapterId: string): string | null {
  return useAssistantStore((s) => s.desktop?.find((d) => d.id === adapterId)?.version ?? null);
}

/** The conversation as text, for keeping or for pasting somewhere. */
export function transcript(title: string, messages: ChatMessage[]): string {
  const lines = [`# ${title}`, ''];
  for (const m of messages) {
    const who = m.role === 'user' ? 'You' : adapterById(m.adapter ?? '').label;
    lines.push(`## ${who}, ${new Date(m.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`, '');
    for (const a of m.attachments ?? []) lines.push(`Attached: ${a.name} (${Math.round(a.bytes / 1024)} KB)`);
    for (const t of m.tools ?? []) lines.push(`Used the tool ${t.name} with ${JSON.stringify(t.input)}: ${t.ok === false ? 'it could not answer' : t.result === undefined ? 'no answer' : 'answered'}`);
    if ((m.attachments?.length ?? 0) + (m.tools?.length ?? 0) > 0) lines.push('');
    if (m.text) lines.push(m.text.trim(), '');
    for (const n of m.notices ?? []) lines.push(`Note: ${n}`, '');
    if (m.error) lines.push(`Could not answer: ${m.error}`, '');
    if (m.state === 'stopped') lines.push('(stopped before the end)', '');
  }
  return `${lines.join('\n').trim()}\n`;
}
