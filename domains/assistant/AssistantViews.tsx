// The Assistant screen's other three views:
//   AssistantLearn — what MCP is, in terms of this app, with a tool to try
//   AssistantSetup — giving an assistant on your own computer this app's tools
//   AssistantTools — every tool, what it reads, and whether it writes
'use client';
import { useState } from 'react';
import { ArrowDown, ArrowRight, Check, Copy, FileText, MessageCircle, Play, Radio, ServerCog } from 'lucide-react';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import { ADAPTERS } from '@/lib/assistant/adapters';
import { SHIPPED_SERVERS } from '@/lib/assistant/servers';
import { appTools, mcpExchange, runTool } from '@/lib/assistant/tools';
import type { AppTool } from '@/lib/assistant/types';
import { attachmentBytes, availabilityIn, useAssistantStore } from '@/stores/core/assistantStore';
import { useParamsStore } from '@/stores/domains/paramsStore';

const H2 = 'text-[11px] font-bold uppercase tracking-widest text-ink-muted';
const CARD = 'rounded-xl border border-edge bg-surface-raised p-4';

function Code({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-edge">
      <div className="flex items-center justify-between gap-2 border-b border-edge bg-control/60 px-3 py-1">
        <span className="truncate font-mono text-[11px] text-ink-muted">{label}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          aria-label={`Copy: ${label}`}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto bg-surface-sunken p-3 font-mono text-[11px] leading-relaxed text-ink">{text}</pre>
    </div>
  );
}

function Box({ icon: Icon, title, children }: { icon: typeof FileText; title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-edge bg-control/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <Icon size={14} className="shrink-0 text-secondary" /> {title}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-ink-muted">{children}</p>
    </div>
  );
}

function Arrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 px-1 text-[10px] text-ink-muted sm:w-24">
      <ArrowRight size={16} className="hidden sm:block" />
      <ArrowDown size={16} className="sm:hidden" />
      <span className="text-center leading-tight">{children}</span>
    </div>
  );
}

function useLocalTools(): AppTool[] {
  // the same tools the chat hands an assistant, looking at the same things
  return appTools({
    mission: () => null,
    parameters: () => ({ set: useParamsStore.getState().set, other: useParamsStore.getState().other }),
    reference: async () => {
      const s = useParamsStore.getState();
      if (!s.reference) await s.loadReference();
      return useParamsStore.getState().reference;
    },
    log: () => null,
    attachments: () => [],
    attachmentBytes,
    mayShowPlace: () => false,
  });
}

function TryATool() {
  const tools = useLocalTools();
  const [name, setName] = useState('COM_KILL_DISARM');
  const [shown, setShown] = useState<{ request: unknown; response: unknown; inside: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const input = { names: [name.trim()] };
    const result = await runTool(tools, 'explain_parameter', input);
    // the response is shown as the protocol carries it: the tool's answer is TEXT inside it
    setShown({ ...mcpExchange(1, 'explain_parameter', input, result), inside: result.text });
    setBusy(false);
  };
  return (
    <div className={`${CARD} space-y-3`}>
      <h3 className="text-sm font-semibold text-ink">Try it: one tool, by hand</h3>
      <p className="text-xs leading-snug text-ink-muted">
        You are the assistant. Type the name of a PX4 parameter and send the request. What comes back is what an
        assistant is given, and all it is given: it has no other way to know what the parameter is.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-64 max-w-full space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Parameter name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void go()}
            className={`${INPUT_CLASS} font-mono`}
            spellCheck={false}
          />
        </label>
        <button
          onClick={() => void go()}
          disabled={busy || name.trim() === ''}
          className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Play size={12} /> Send the request
        </button>
      </div>
      <p className="text-[11px] text-ink-muted">
        Then try <span className="font-mono">FRAME_CLASS</span>, which is an ArduPilot name, and a name you make up.
      </p>
      {shown && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Code label="request: assistant to tools server" text={JSON.stringify(shown.request, null, 2)} />
          <Code label="response: tools server to assistant" text={JSON.stringify(shown.response, null, 2)} />
          <div className="lg:col-span-2">
            <Code label='the "text" inside the response, as the assistant reads it' text={shown.inside} />
          </div>
        </div>
      )}
    </div>
  );
}

export function AssistantLearn() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-5">
        <section className="space-y-2">
          <h2 className={H2}>What MCP is</h2>
          <p className="text-sm leading-relaxed text-ink">
            An AI assistant knows what it was trained on and what is in the conversation. It does not know what is in
            your flight log, and it cannot open a file. <strong>MCP</strong>, the Model Context Protocol, is an agreed
            way to give an assistant <strong>tools</strong>: small jobs it can ask a program to do, such as &quot;read
            this log&quot; or &quot;say what this parameter is&quot;.
          </p>
          <p className="text-sm leading-relaxed text-ink">
            The program that offers the tools is an <strong>MCP server</strong>. The assistant asks; the server does
            the job and answers in text; the assistant reads the answer and carries on. Because the way of asking is
            agreed, one server works with any assistant that speaks MCP.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className={H2}>In this app</h2>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-stretch">
            <Box icon={MessageCircle} title="The assistant">
              Reads your question. Decides a tool would help. Asks for it by name, with the inputs the tool says it
              takes.
            </Box>
            <Arrow>asks, and is answered</Arrow>
            <Box icon={ServerCog} title="The tools server">
              This app&apos;s own functions: the same ones that draw the screens. It runs the tool and answers in
              text.
            </Box>
            <Arrow>reads</Arrow>
            <Box icon={FileText} title="Your files">
              A flight log, a mission, a parameter file, and PX4&apos;s own parameter reference. On this computer.
            </Box>
          </div>
          <p className="text-xs leading-snug text-ink-muted">
            This chain stops at files. The tools read files and explain them, and a file reaches an aircraft only
            when a person loads it in a ground station.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className={H2}>And the live aircraft</h2>
          <p className="text-sm leading-relaxed text-ink">
            A second server, the <strong>observer</strong>, is for the aircraft on the bench. It is optional and set
            up separately. QGroundControl is the only program that talks to the aircraft; it can send a{' '}
            <strong>copy</strong> of what it hears to a port on the same computer, and the observer listens there.
          </p>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-stretch">
            <Box icon={MessageCircle} title="The assistant">
              Asks: is it armed, is the GPS good, why will it not arm, what is this parameter set to.
            </Box>
            <Arrow>asks, and is answered</Arrow>
            <Box icon={ServerCog} title="The observer">
              Answers from what it has heard. It remembers; it does not ask the aircraft for anything.
            </Box>
            <Arrow>is sent a copy, one way</Arrow>
            <Box icon={Radio} title="QGroundControl, and the aircraft">
              A person makes every change here. Nothing comes back down this chain.
            </Box>
          </div>
          <p className="text-xs leading-snug text-ink-muted">
            The last arrow points one way only. In the observer, the code that would send is replaced with code that
            raises an error, and its self-test tries to send and checks that it is refused. An assistant can see what
            the aircraft says. It cannot say anything to the aircraft.
          </p>
        </section>

        <TryATool />

        <section className="space-y-2">
          <h2 className={H2}>What to notice</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink">
            <li>
              <strong>The assistant only gets text back.</strong> The answer to a tool is text inside the response,
              here a document in JSON. An assistant that says a parameter&apos;s default is 5 got the 5 from that text.
            </li>
            <li>
              <strong>A tool can say no.</strong> Ask for a name PX4 does not have and the answer says so, in words. A
              good assistant passes that on. One that makes up an answer instead is doing the thing this app is built
              to prevent.
            </li>
            <li>
              <strong>The tool decides what is possible.</strong> The assistant cannot do anything there is no tool
              for. That is why it matters which tools a server has, and why neither of these has one that sends.
            </li>
            <li>
              <strong>You can look.</strong> In the chat, every use of a tool is a card in the answer. Open it to see
              what was asked and what came back.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className={H2}>The words</h2>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            {[
              ['Host', 'The program a person talks to: Claude Code, or this app\'s chat.'],
              ['Server', 'The program that offers tools. This app ships one, in mcp/files/.'],
              ['Tool', 'One job, with a name, a description and a list of inputs. The description is written for the assistant: it is how it knows when to use the tool.'],
              ['tools/list', 'The message that asks a server what tools it has.'],
              ['tools/call', 'The message that asks for one tool to be run. You sent one above.'],
              ['JSON-RPC', 'The format of the messages: a request with an id, and a response with the same id.'],
              ['stdio', 'How this app\'s server is spoken to: the assistant starts it as a program and they write to each other directly. No network is used.'],
            ].map(([term, meaning]) => (
              <div key={term} className="contents">
                <dt className="font-mono text-xs font-semibold text-ink">{term}</dt>
                <dd className="text-xs leading-snug text-ink-muted">{meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-ink-muted">
            The protocol is open and its specification is at modelcontextprotocol.io.
          </p>
        </section>
      </div>
    </div>
  );
}

const MCP_JSON = `{
  "mcpServers": {
    "flight-companion": {
      "command": "node",
      "args": ["--no-warnings", "mcp/files/server.mjs"]
    }
  }
}`;

const OBSERVER_JSON = `{
  "mcpServers": {
    "flight-companion": {
      "command": "node",
      "args": ["--no-warnings", "mcp/files/server.mjs"]
    },
    "flight-companion-observer": {
      "command": "mcp/observer/.venv/Scripts/python.exe",
      "args": ["mcp/observer/server.py"],
      "env": { "QGC_FWD_PORT": "14445" }
    }
  }
}`;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className={`${CARD} space-y-2`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary/15 font-mono text-xs text-secondary">{n}</span>
        {title}
      </h3>
      <div className="space-y-2 text-xs leading-snug text-ink-muted">{children}</div>
    </li>
  );
}

export function AssistantSetup() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-5">
        <section className="space-y-2">
          <h2 className={H2}>Give your own assistant this app&apos;s tools</h2>
          <p className="text-sm leading-relaxed text-ink">
            If you use a coding assistant in a terminal, it can be given the same tools this chat has, and read your
            logs, missions and parameter files where they are on your disk. The steps are for Claude Code, which is
            the one this has been tried with. They need a copy of this app&apos;s folder on your computer and Node 22.18
            or newer.
          </p>
        </section>

        <ol className="space-y-3">
          <Step n={1} title="See that the server starts">
            <p>In a terminal, in the app&apos;s folder:</p>
            <Code label="terminal" text={'npm install\nnpm run verify:mcp'} />
            <p>
              It starts the server the way an assistant would, calls every tool, and ends with{' '}
              <span className="font-mono">0 failed</span>. If it does not, stop here and read the line that failed.
            </p>
          </Step>
          <Step n={2} title="Tell Claude Code about it">
            <p>
              Either put a file called <span className="font-mono">.mcp.json</span> in the app&apos;s folder, with this
              in it. The path is relative, so the file works wherever the folder is.
            </p>
            <Code label=".mcp.json" text={MCP_JSON} />
            <p>Or, in a terminal in the app&apos;s folder, let Claude Code write it:</p>
            <Code label="terminal" text="claude mcp add --scope project flight-companion -- node --no-warnings mcp/files/server.mjs" />
          </Step>
          <Step n={3} title="Start Claude Code in the app's folder, and say yes">
            <p>
              The first time, Claude Code asks whether to trust the server named in the file. It asks because a
              server is a program, and a folder you downloaded could name any program. This one is{' '}
              <span className="font-mono">mcp/files/server.mjs</span>: it can be read before it is trusted.
            </p>
            <p>
              Then type <span className="font-mono">/mcp</span>. <span className="font-mono">flight-companion</span>{' '}
              should be listed as connected, with thirteen tools.
            </p>
          </Step>
          <Step n={4} title="Ask it something only a tool can answer">
            <Code label="to Claude Code" text={'Use the flight-companion tools. Read the rules first.\nThen tell me what BAT_LOW_THR is, and its firmware default.'} />
            <p>
              The answer should say 0.15 and name PX4 v1.16.0. Claude Code shows the tool it used. If it answers
              without using one, ask it to use the tool: a default quoted from memory is a guess.
            </p>
          </Step>
        </ol>

        <section className="space-y-2 pt-2">
          <h2 className={H2}>The live observer, if you want it</h2>
          <p className="text-sm leading-relaxed text-ink">
            Optional. It lets the assistant see what an aircraft connected to QGroundControl is reporting right now.
            It needs Python 3.12, and it is set up after the files server. It listens and cannot send.
          </p>
        </section>

        <ol className="space-y-3">
          <Step n={1} title="Make its Python environment, and test it">
            <p>In a terminal, in the app&apos;s folder. On Windows:</p>
            <Code
              label="terminal"
              text={'python -m venv mcp\\observer\\.venv\nmcp\\observer\\.venv\\Scripts\\python.exe -m pip install -r mcp\\observer\\requirements.txt\nmcp\\observer\\.venv\\Scripts\\python.exe mcp\\observer\\selftest.py'}
            />
            <p>
              It ends with <span className="font-mono">41 passed, 0 failed</span>. Four of those checks try to send
              and are refused. The test needs no aircraft.
            </p>
          </Step>
          <Step n={2} title="Add it to .mcp.json">
            <p>
              Beside the files server&apos;s entry. On a Mac the command is{' '}
              <span className="font-mono">mcp/observer/.venv/bin/python</span>; that has not been tried.
            </p>
            <Code label=".mcp.json" text={OBSERVER_JSON} />
          </Step>
          <Step n={3} title="Switch on forwarding in QGroundControl">
            <p>
              Application Settings, MAVLink, tick <strong>Enable MAVLink forwarding</strong>, host{' '}
              <span className="font-mono">localhost:14445</span>. QGroundControl remembers it.
            </p>
          </Step>
          <Step n={4} title="Props off. Connect the aircraft. Ask for the status.">
            <Code label="to Claude Code" text={'Use the flight-companion-observer tools. What is the status of the aircraft?'} />
            <p>
              A vehicle with a type and a mode means the link is up. If it says no parameters are held, press Refresh
              in QGroundControl&apos;s Parameters view, with the USB cable in.
            </p>
            <p>
              Open <strong>one</strong> assistant session, not two: only one program can listen on the port, and the
              second hears nothing.
            </p>
          </Step>
        </ol>

        <section className={`${CARD} space-y-2`}>
          <h3 className="text-sm font-semibold text-ink">What the observer tells an assistant</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs leading-snug text-ink-muted">
            <li>
              <strong className="text-ink">Not where the aircraft is</strong>, unless you allow it by setting{' '}
              <span className="font-mono">FC_OBSERVER_PLACE</span> to <span className="font-mono">1</span> in the
              entry&apos;s <span className="font-mono">env</span>. Height is always given.
            </li>
            <li>
              <strong className="text-ink">The board&apos;s own identifier</strong>, if it is asked for the firmware
              version. It names that one board. Think before pasting it anywhere.
            </li>
            <li>Whatever an assistant is given goes to its maker, under your account with them.</li>
          </ul>
          <p className="text-xs leading-snug text-ink-muted">
            <span className="font-mono">mcp/observer/README.md</span> has the tools, the settings and what to do when
            it goes quiet. This copy of the observer has been tested with made-up messages on one computer. It has not
            yet been connected to a real aircraft.
          </p>
        </section>

        <section className={`${CARD} space-y-2`}>
          <h3 className="text-sm font-semibold text-ink">Other assistants</h3>
          <p className="text-xs leading-snug text-ink-muted">
            Any assistant that speaks MCP can use the server. Each has its own place to name one; what it needs to
            be told is the same: the command <span className="font-mono">node</span>, the arguments{' '}
            <span className="font-mono">--no-warnings mcp/files/server.mjs</span>, and the app&apos;s folder to start
            it in. Only Claude Code has been tried.
          </p>
        </section>

        <section className={`${CARD} space-y-2`}>
          <h3 className="text-sm font-semibold text-ink">What the files server can and cannot do</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs leading-snug text-ink-muted">
            <li>It reads files you name, anywhere on the computer that you can read.</li>
            <li>Three of its tools write a file. None writes over a file that is there, and none deletes.</li>
            <li>It opens no network connection and no port. It cannot reach an aircraft.</li>
            <li>A log brief holds no position unless the assistant asks for it, and its description tells it to ask you first.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

export function AssistantTools() {
  const tools = useLocalTools();
  const view = useAssistantStore((s) => s.setView);
  const desktop = useAssistantStore((s) => s.desktop);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-5">
        <section className="space-y-2">
          <h2 className={H2}>The tools this chat has</h2>
          <p className="text-xs leading-snug text-ink-muted">
            These run in this page, on what is open in the app and on what you attach. The description is what the
            assistant reads to decide whether to use the tool. None of them changes anything.
          </p>
          <ul className="space-y-2">
            {tools.map((t) => (
              <li key={t.name} className="rounded-lg border border-edge bg-surface-raised p-3">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xs font-semibold text-ink">{t.name}</span>
                  <span className="text-xs text-ink-muted">{t.title}</span>
                </p>
                <p className="mt-1 text-[11px] leading-snug text-ink-muted">{t.description}</p>
                {Object.keys(t.inputSchema.properties).length > 0 && (
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Takes:{' '}
                    {Object.keys(t.inputSchema.properties).map((k) => (
                      <span key={k} className="mr-1.5 font-mono text-ink">
                        {k}
                        {t.inputSchema.required?.includes(k) ? '' : '?'}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        {SHIPPED_SERVERS.map((server) => (
          <section key={server.name} className="space-y-2">
            <h2 className={H2}>
              {server.label}: for an assistant on your own computer
            </h2>
            <p className="text-xs leading-snug text-ink-muted">
              {server.about} Needs {server.needs}. In <span className="font-mono">{server.folder}/</span>; set up from
              the{' '}
              <button onClick={() => view('setup')} className="text-secondary underline underline-offset-2">
                Set up
              </button>{' '}
              view.
            </p>
            <div className="overflow-x-auto rounded-lg border border-edge">
              <table className="w-full min-w-[520px] border-separate border-spacing-0 text-xs">
                <caption className="sr-only">The tools of the {server.label.toLowerCase()}</caption>
                <tbody>
                  {server.tools.map((t) => (
                    <tr key={t.name}>
                      <td className="whitespace-nowrap border-b border-edge px-3 py-1.5 font-mono font-medium text-ink">{t.name}</td>
                      <td className="whitespace-nowrap border-b border-edge px-3 py-1.5 text-ink-muted">{t.writes ? 'writes a new file' : server.live ? 'listens' : 'reads'}</td>
                      <td className="border-b border-edge px-3 py-1.5 text-ink-muted">{t.does}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <section className="space-y-2">
          <h2 className={H2}>The assistants</h2>
          <ul className="space-y-2">
            {ADAPTERS.map((a) => {
              const here = availabilityIn(a, desktop);
              return (
                <li key={a.id} className="rounded-lg border border-edge bg-surface-raised p-3">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-semibold text-ink">{a.label}</span>
                    <span className="text-[11px] text-ink-muted">{here.ok ? 'can answer here' : 'cannot answer here'}</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-ink-muted">{a.about}</p>
                  {!here.ok && <p className="mt-1 text-[11px] leading-snug text-ink">{here.why}</p>}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] leading-snug text-ink-muted">
            An assistant is an adapter: a slot. More can be added without the chat changing. Planned and not built:
            one that uses an API key of your own, and one for a model at an address you give.{' '}
            <button onClick={() => view('setup')} className="text-secondary underline underline-offset-2">
              Giving your own assistant these tools
            </button>{' '}
            is a separate thing, and works today.
          </p>
        </section>
      </div>
    </div>
  );
}
