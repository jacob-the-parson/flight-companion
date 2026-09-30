// The assistant, as this app sees one. The chat, the widget and the tools know
// only what is in this file. WHICH assistant answers is an adapter: Claude Code
// today, others in the same slot later.
//
// An adapter is handed a conversation and says what happens as a stream of
// events. It never touches the screen and the screen never knows its name.

export type AttachmentKind = 'image' | 'video' | 'mission' | 'parameters' | 'log' | 'text' | 'other';

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  kind: AttachmentKind;
}

/** One use of a tool inside an answer: what was asked, and what came back. */
export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
  /** Absent while the tool is still running. */
  result?: string;
  ok?: boolean;
}

export type MessageState = 'streaming' | 'done' | 'stopped' | 'failed';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  at: number;
  text: string;
  attachments?: Attachment[];
  tools?: ToolUse[];
  state?: MessageState;
  /** Said to the user, in words, when the answer failed. */
  error?: string;
  /** Things the user should know that are not part of the answer. */
  notices?: string[];
  /** Which adapter answered, and what it says its model is. */
  adapter?: string;
  model?: string | null;
}

export type AssistantEvent =
  /** The assistant has begun. sessionId lets the next message continue this conversation. */
  | { type: 'started'; model: string | null; sessionId: string | null; tools: string[] }
  /** A piece of the answer, to be added to the end of it. */
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; ok: boolean; text: string }
  /** Something the user should know that is not part of the answer. */
  | { type: 'notice'; text: string }
  | { type: 'done'; sessionId: string | null }
  | { type: 'error'; message: string };

/** A tool the APP runs, in the browser, on what is open in it. */
export interface AppTool {
  name: string;
  title: string;
  description: string;
  /** JSON Schema of the input, as MCP and every model API expect it. */
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface SendRequest {
  /** Everything said before, oldest first. */
  history: ChatMessage[];
  /** What the user has just said. */
  message: ChatMessage;
  /** From the last 'started' or 'done' of this conversation, if the adapter gave one. */
  sessionId: string | null;
  /** The tools the app offers. An adapter that brings its own may ignore them. */
  tools: AppTool[];
  /** The bytes of an attachment, for an adapter that can send them. */
  attachmentBytes: (id: string) => Promise<Uint8Array | null>;
  /** Which conversation this is, for an adapter that keeps something for each. */
  conversationId: string;
  /**
   * What is open in the app, as files: for an assistant that runs outside the
   * page and reads files, and so cannot use the app's own tools.
   */
  openFiles: () => Promise<{ name: string; about: string; bytes: Uint8Array }[]>;
}

/** What an adapter needs before it can answer. */
export type AdapterNeeds = 'nothing' | 'desktop' | 'key';

export interface Availability {
  ok: boolean;
  /** Why not, in words a user can act on. */
  why?: string;
}

export interface AssistantAdapter {
  id: string;
  label: string;
  /** One or two sentences: what it is and whose account does the work. */
  about: string;
  needs: AdapterNeeds;
  /** True if it is an AI. The practice assistant is not, and says so. */
  isModel: boolean;
  /** What it can take in besides text. */
  takes: { images: boolean; files: boolean };
  availability: () => Availability;
  send: (request: SendRequest, emit: (event: AssistantEvent) => void, signal: AbortSignal) => Promise<void>;
}

/**
 * What the desktop app puts on `window` for the page to use. The page cannot
 * start a program; the desktop app can, and this is the whole of what it offers.
 * Absent in a browser.
 */
export interface DesktopBridge {
  version: number;
  assistants: () => Promise<{ id: string; found: boolean; version: string | null; why?: string }[]>;
  /** Start one answer. Events arrive through onEvent; the promise ends when the answer does. */
  ask: (
    request: {
      adapter: string;
      conversationId: string;
      prompt: string;
      sessionId: string | null;
      /** Files for this message: what was attached, and what is open in the app. */
      files: { name: string; about: string; bytes: Uint8Array }[];
    },
    onEvent: (event: AssistantEvent) => void,
  ) => Promise<void>;
  stop: () => Promise<void>;
  /** Delete what is kept on disk for a conversation. */
  forget: (conversationId: string) => Promise<void>;
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { flightCompanion?: { assistant?: DesktopBridge } }).flightCompanion?.assistant;
  return b && typeof b.ask === 'function' ? b : null;
}

const BY_EXTENSION: Record<string, AttachmentKind> = {
  ulg: 'log',
  plan: 'mission',
  mission: 'mission',
  waypoints: 'mission',
  kmz: 'mission',
  kml: 'mission',
  gpx: 'mission',
  fpl: 'mission',
  params: 'parameters',
  param: 'parameters',
  parm: 'parameters',
  txt: 'text',
  md: 'text',
  csv: 'text',
  json: 'text',
  log: 'text',
};

export function attachmentKind(name: string, mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return BY_EXTENSION[ext] ?? (mime.startsWith('text/') ? 'text' : 'other');
}

export const KIND_LABEL: Record<AttachmentKind, string> = {
  image: 'Image',
  video: 'Video',
  mission: 'Mission file',
  parameters: 'Parameter file',
  log: 'Flight log',
  text: 'Text',
  other: 'File',
};

/** The most one attached file may weigh. A flight log is a few megabytes; a video is the large one. */
export const ATTACHMENT_LIMIT_BYTES = 200 * 1024 * 1024;

/** The name a tool is shown by: an MCP tool arrives as mcp__server__name. */
export function toolDisplayName(name: string): string {
  const parts = name.split('__');
  const own = parts[0] === 'mcp' && parts.length >= 3 ? parts.slice(2).join('__') : name;
  return own.replace(/_/g, ' ');
}
