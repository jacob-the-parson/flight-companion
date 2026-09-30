// What the page is given by the desktop app: four functions for the assistant,
// three for the Live screen, and nothing else.
// The page has no Node, no file system and no way to start a program; it asks
// for an answer and is sent events. lib/assistant/types.ts names this shape
// DesktopBridge.
import { contextBridge, ipcRenderer } from 'electron';

type Listener = (event: unknown) => void;

const channel = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

contextBridge.exposeInMainWorld('flightCompanion', {
  desktop: true,
  assistant: {
    version: 1,
    assistants: () => ipcRenderer.invoke('assistant:list'),
    ask: async (request: unknown, onEvent: Listener) => {
      const id = channel();
      const name = `assistant:event:${id}`;
      const pass = (_e: unknown, event: unknown) => onEvent(event);
      ipcRenderer.on(name, pass);
      try {
        await ipcRenderer.invoke('assistant:ask', request, id);
      } finally {
        ipcRenderer.removeListener(name, pass);
      }
    },
    stop: () => ipcRenderer.invoke('assistant:stop'),
    forget: (conversationId: string) => ipcRenderer.invoke('assistant:forget', conversationId),
  },
  // Listening for the aircraft. There is no function here that sends to one, and the app has none.
  observer: {
    version: 1,
    start: () => ipcRenderer.invoke('observer:start'),
    stop: () => ipcRenderer.invoke('observer:stop'),
    view: () => ipcRenderer.invoke('observer:view'),
  },
});
