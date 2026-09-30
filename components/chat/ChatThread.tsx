// ChatThread — a conversation, oldest first, and ChatInput, the box it is
// written in. Both read the assistant store; `compact` is the widget's size.
// Spec: Chat.md
'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, CircleAlert, Info, Paperclip, Square, X } from 'lucide-react';
import { adapterById } from '@/lib/assistant/adapters';
import { ATTACHMENT_LIMIT_BYTES, attachmentKind, KIND_LABEL, type ChatMessage } from '@/lib/assistant/types';
import { useAdapterId, useAssistantStore } from '@/stores/core/assistantStore';
import { ChatAttachment, ChatMarkdown, ChatToolCard } from './ChatParts';

function Message({ m, compact }: { m: ChatMessage; compact: boolean }) {
  const mine = m.role === 'user';
  const adapter = adapterById(m.adapter ?? '');
  const waiting = m.state === 'streaming' && m.text === '' && (m.tools?.length ?? 0) === 0;
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <article
        aria-label={mine ? 'You said' : `${adapter.label} said`}
        className={`min-w-0 space-y-2 ${compact ? 'max-w-[94%]' : 'max-w-[min(46rem,92%)]'} ${
          mine ? 'rounded-2xl rounded-br-md border border-edge bg-control px-3.5 py-2.5' : 'w-full'
        }`}
      >
        {!mine && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            {adapter.label}
            {m.model ? <span className="ml-1.5 font-mono font-normal normal-case tracking-normal">{m.model}</span> : null}
            {!adapter.isModel ? <span className="ml-1.5 font-normal normal-case tracking-normal">not an AI</span> : null}
          </p>
        )}
        {m.attachments && m.attachments.length > 0 && (
          <div className="flex flex-wrap items-start gap-2">
            {m.attachments.map((a) => (
              <ChatAttachment key={a.id} attachment={a} compact={compact} />
            ))}
          </div>
        )}
        {m.tools?.map((t, i) => <ChatToolCard key={t.id || i} tool={t} index={i} />)}
        {mine ? (
          m.text && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{m.text}</p>
        ) : (
          m.text && <ChatMarkdown text={m.text} />
        )}
        {waiting && (
          <p className="flex items-center gap-1.5 text-xs text-ink-muted" role="status">
            <span className="inline-flex gap-1" aria-hidden>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted [animation-delay:300ms]" />
            </span>
            Working
          </p>
        )}
        {m.notices?.map((n) => (
          <p key={n} className="flex items-start gap-1.5 rounded-md border border-edge bg-control/50 px-2.5 py-1.5 text-[11px] leading-snug text-ink-muted">
            <Info size={12} className="mt-0.5 shrink-0" /> {n}
          </p>
        ))}
        {m.state === 'failed' && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-1.5 text-xs leading-snug text-ink dark:border-amber-800 dark:bg-amber-950/30">
            <CircleAlert size={13} className="mt-0.5 shrink-0 text-status-warning" />
            <span>
              <span className="font-semibold">Could not answer.</span> {m.error}
            </span>
          </p>
        )}
        {m.state === 'stopped' && <p className="text-[11px] italic text-ink-muted">Stopped before the end.</p>}
      </article>
    </li>
  );
}

export function ChatThread({ compact = false, empty }: { compact?: boolean; empty?: React.ReactNode }) {
  const messages = useAssistantStore((s) => s.messages);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // follow the answer as it is written, unless the reader has scrolled up to read
  const pinned = useRef(true);
  const last = messages[messages.length - 1];
  const tick = `${messages.length}/${last?.text.length ?? 0}/${last?.tools?.length ?? 0}/${last?.state ?? ''}`;
  useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [tick]);

  if (messages.length === 0) return <div className="min-h-0 flex-1 overflow-y-auto">{empty}</div>;
  return (
    <div
      ref={boxRef}
      onScroll={() => {
        const b = boxRef.current;
        if (b) pinned.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
      role="log"
      aria-label="Conversation"
      aria-live="polite"
    >
      <ol className={`mx-auto w-full space-y-5 ${compact ? 'p-3' : 'max-w-4xl p-5'}`}>
        {messages.map((m) => (
          <Message key={m.id} m={m} compact={compact} />
        ))}
      </ol>
      <div ref={endRef} />
    </div>
  );
}

export function ChatInput({ compact = false }: { compact?: boolean }) {
  const busy = useAssistantStore((s) => s.busy);
  const send = useAssistantStore((s) => s.send);
  const stop = useAssistantStore((s) => s.stop);
  const adapter = adapterById(useAdapterId());
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const add = (more: File[]) => setFiles((f) => [...f, ...more].slice(0, 12));
  const ready = !busy && (text.trim() !== '' || files.length > 0);
  const go = () => {
    if (!ready) return;
    void send(text, files);
    setText('');
    setFiles([]);
    if (box.current) box.current.style.height = 'auto';
  };

  return (
    <div className={`shrink-0 border-t border-edge ${compact ? 'p-2' : 'px-5 py-3'}`}>
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.stopPropagation();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          add(Array.from(e.dataTransfer.files));
        }}
        className={`mx-auto w-full rounded-2xl border bg-surface-raised transition-colors focus-within:border-secondary ${compact ? '' : 'max-w-4xl'} ${
          over ? 'border-secondary bg-secondary/5' : 'border-edge'
        }`}
      >
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 border-b border-edge p-2">
            {files.map((f, i) => {
              const kind = attachmentKind(f.name, f.type);
              const tooBig = f.size > ATTACHMENT_LIMIT_BYTES;
              return (
                <li key={`${f.name}/${i}`} className="flex max-w-full items-center gap-1.5 rounded-md border border-edge bg-control px-2 py-1 text-[11px] text-ink">
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="shrink-0 text-ink-muted">{tooBig ? 'too large' : KIND_LABEL[kind]}</span>
                  <button onClick={() => setFiles((all) => all.filter((_, k) => k !== i))} className="shrink-0 text-ink-muted hover:text-ink" aria-label={`Take ${f.name} off`}>
                    <X size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-end gap-1.5 p-1.5">
          <input
            ref={pick}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <button
            onClick={() => pick.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            title="Attach a file: a picture, a video, a mission, a parameter file, a flight log"
            aria-label="Attach a file"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            ref={box}
            value={text}
            rows={1}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                go();
              }
            }}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length > 0) {
                e.preventDefault();
                add(pasted);
              }
            }}
            placeholder={over ? 'Drop to attach' : `Ask ${adapter.label}`}
            aria-label="Your message"
            className="max-h-[200px] min-h-9 w-full min-w-0 resize-none bg-transparent px-1 py-2 text-sm leading-snug text-ink outline-none placeholder:text-ink-muted"
          />
          {busy ? (
            <button
              onClick={stop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-surface-raised transition-opacity hover:opacity-80"
              title="Stop"
              aria-label="Stop the answer"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={go}
              disabled={!ready}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-control disabled:text-ink-muted"
              title="Send. Enter sends; Shift and Enter makes a new line."
              aria-label="Send"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      {!compact && (
        <p className="mx-auto mt-1.5 max-w-4xl px-2 text-[10px] leading-snug text-ink-muted">
          {adapter.isModel
            ? `${adapter.label} can be wrong. Check what it says against the tool cards in its answer, which show what it was given.`
            : 'The practice assistant is not an AI. It answers only from the tools.'}{' '}
          Nothing here can send to an aircraft.
        </p>
      )}
    </div>
  );
}
