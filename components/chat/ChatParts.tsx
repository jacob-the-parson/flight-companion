// The pieces a conversation is drawn with: the text of an answer, an attached
// file, and the card for one use of a tool. Used by the Assistant screen and
// by the widget. Spec: Chat.md
'use client';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, ChevronDown, ChevronRight, CircleAlert, Copy, File as FileIcon, FileText, Film, Image as ImageIcon, LoaderCircle, Route, SlidersHorizontal, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { mcpExchange } from '@/lib/assistant/tools';
import { KIND_LABEL, toolDisplayName, type Attachment, type AttachmentKind, type ToolUse } from '@/lib/assistant/types';
import { attachmentBytes } from '@/stores/core/assistantStore';

/**
 * An answer's text. Markdown, with two things held back:
 *   - no HTML is ever taken from the text;
 *   - no picture is fetched from the internet. An address in an answer is
 *     chosen by whatever wrote the answer, and fetching it tells a stranger's
 *     server that this page is open. A remote picture is shown as its link.
 */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-prose min-w-0 break-words text-sm leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-secondary underline underline-offset-2">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            const s = typeof src === 'string' ? src : '';
            if (s.startsWith('blob:') || s.startsWith('data:image/')) {
              // eslint-disable-next-line @next/next/no-img-element
              return <img src={s} alt={alt ?? ''} className="my-2 max-h-80 max-w-full rounded-lg border border-edge" />;
            }
            return (
              <span className="text-ink-muted">
                [picture not loaded: {alt || 'no description'}
                {s ? `, ${s}` : ''}]
              </span>
            );
          },
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          h1: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold">{children}</h4>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-edge-strong/40 pl-3 text-ink-muted">{children}</blockquote>,
          code: ({ className, children }) =>
            /language-/.test(className ?? '') || String(children).includes('\n') ? (
              <code className="block overflow-x-auto rounded-md bg-surface-sunken p-3 font-mono text-[12px] leading-relaxed">{children}</code>
            ) : (
              <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-[12px]">{children}</code>
            ),
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border border-edge">
              <table className="w-full border-separate border-spacing-0 text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-edge bg-control/60 px-2.5 py-1.5 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-edge px-2.5 py-1.5 align-top">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const KIND_ICON: Record<AttachmentKind, LucideIcon> = {
  image: ImageIcon,
  video: Film,
  mission: Route,
  parameters: SlidersHorizontal,
  log: Activity,
  text: FileText,
  other: FileIcon,
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** An address for a stored file, made when it is first shown and given back when it no longer is. */
function useStoredUrl(a: Attachment, wanted: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let made: string | null = null;
    let gone = false;
    void attachmentBytes(a.id).then((bytes) => {
      if (gone || !bytes) return;
      made = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: a.mime || 'application/octet-stream' }));
      setUrl(made);
    });
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [a.id, a.mime, wanted]);
  return url;
}

export function ChatAttachment({ attachment: a, compact = false }: { attachment: Attachment; compact?: boolean }) {
  const media = a.kind === 'image' || a.kind === 'video';
  const url = useStoredUrl(a, media);
  const Icon = KIND_ICON[a.kind];

  if (a.kind === 'image' && url) {
    return (
      <figure className="max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={a.name} className={`${compact ? 'max-h-40' : 'max-h-80'} max-w-full rounded-lg border border-edge`} />
        <figcaption className="mt-1 truncate text-[10px] text-ink-muted">
          {a.name} · {size(a.bytes)}
        </figcaption>
      </figure>
    );
  }
  if (a.kind === 'video' && url) {
    return (
      <figure className="max-w-full">
        <video src={url} controls preload="metadata" className={`${compact ? 'max-h-40' : 'max-h-80'} max-w-full rounded-lg border border-edge bg-black`} />
        <figcaption className="mt-1 text-[10px] text-ink-muted">
          {a.name} · {size(a.bytes)} · shown for you; an assistant cannot watch a video
        </figcaption>
      </figure>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-edge bg-surface-raised px-2.5 py-1.5 text-left">
      <Icon size={14} className="shrink-0 text-ink-muted" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-ink">{a.name}</span>
        <span className="block text-[10px] text-ink-muted">
          {KIND_LABEL[a.kind]} · {size(a.bytes)}
        </span>
      </span>
    </span>
  );
}

function pretty(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value, null, 2) ?? '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function Block({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const long = text.length > 6000;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{title}</h5>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          aria-label={`Copy: ${title}`}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-surface-sunken p-2.5 font-mono text-[11px] leading-relaxed text-ink">
        {long ? `${text.slice(0, 6000)}\n… ${text.length - 6000} more characters. Copy gives all of it.` : text}
      </pre>
    </div>
  );
}

/** One use of a tool: what was asked, what came back, and what MCP carries for it. */
export function ChatToolCard({ tool, index }: { tool: ToolUse; index: number }) {
  const [open, setOpen] = useState(false);
  const [wire, setWire] = useState(false);
  const waiting = tool.result === undefined;
  const failed = tool.ok === false;
  const exchange = mcpExchange(index + 1, tool.name, tool.input, { ok: !failed, text: tool.result ?? '' });

  return (
    <div className="rounded-lg border border-edge bg-control/40">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        {open ? <ChevronDown size={13} className="shrink-0 text-ink-muted" /> : <ChevronRight size={13} className="shrink-0 text-ink-muted" />}
        <span className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Tool</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{toolDisplayName(tool.name)}</span>
        {waiting ? (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-muted">
            <LoaderCircle size={11} className="animate-spin" /> working
          </span>
        ) : failed ? (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink">
            <CircleAlert size={11} className="text-status-warning" /> could not answer
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-muted">
            <Check size={11} className="text-status-good" /> answered
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-edge p-2.5">
          {wire ? (
            <>
              <p className="text-[11px] leading-snug text-ink-muted">
                The two messages MCP carries for this: the assistant&apos;s request, and the tools server&apos;s answer.
                JSON-RPC 2.0, method <span className="font-mono">tools/call</span>.
              </p>
              <Block title="Request" text={pretty(exchange.request)} />
              {!waiting && <Block title="Response" text={pretty(exchange.response)} />}
            </>
          ) : (
            <>
              <Block title="What was asked" text={pretty(tool.input)} />
              {!waiting && <Block title="What came back" text={pretty(tool.result)} />}
            </>
          )}
          <button
            onClick={() => setWire(!wire)}
            className="text-[11px] font-medium text-secondary underline underline-offset-2"
          >
            {wire ? 'Show it plainly' : 'Show it as MCP carries it'}
          </button>
        </div>
      )}
    </div>
  );
}
