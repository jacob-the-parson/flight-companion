# flight-companion-files — the MCP server

Gives an assistant (Claude Code, or any other that speaks MCP) thirteen tools over this
app's own functions: read a flight log, a mission or a parameter file, compare two
parameter files, and look a parameter up in PX4's own reference.

The Assistant screen in the app has the same guide with more explanation: **Assistant,
How it works** and **Assistant, Set up**.

## Set up, for Claude Code

From the app's folder. Needs Node 22.18 or newer.

```bash
npm install
npm run verify:mcp        # starts the server as an assistant would and calls every tool
```

Then either copy `mcp/files/mcp.example.json` to the app's folder as `.mcp.json`, or:

```bash
claude mcp add --scope project flight-companion -- node --no-warnings mcp/files/server.mjs
```

Start Claude Code in the app's folder, say yes when it asks whether to trust the server,
and type `/mcp`: `flight-companion` should be connected, with thirteen tools.

## The tools

| tool | reads or writes | what it is for |
|---|---|---|
| `rules` | reads | the rules that bind an assistant here. Read first |
| `read_flight_log` | reads | a `.ulg`: numbers, findings, modes, messages. No position unless asked |
| `read_mission` | reads | a mission in any format: items in words, checks, what each format would drop |
| `check_mission` | reads | the checks only |
| `read_parameters` | reads | a parameter file: findings, and the parameters asked for, each explained |
| `compare_parameters` | reads | what differs between two parameter files |
| `explain_parameter` | reads | PX4 v1.16.0's own description of a parameter |
| `search_parameters` | reads | a parameter by what it does |
| `list_formats` | reads | every format, what it holds, where its definition came from |
| `list_examples` | reads | the examples the app teaches with |
| `convert_mission` | **writes** | a mission as a new file in another format |
| `convert_parameters` | **writes** | parameters as a new file in another format |
| `write_examples` | **writes** | every example, as files, into a new folder |

## What it can and cannot do

- It reads the files it is told to, anywhere the person running it can read.
- The three tools that write make a NEW file. None writes over a file that is there, and
  none deletes.
- It speaks over standard input and output. It opens no port and no network connection.
- It has no tool that sends, uploads, arms or sets, and it cannot reach an aircraft. A
  mission or a parameter file reaches one only when a person loads it in a ground station.

To let an assistant see an aircraft that is connected to QGroundControl, there is a
second, separate server: `mcp/observer/`. It listens and cannot send.

`npm run verify:mcp` checks each of those: by the tools' names, by the modules the source
imports, and by trying to write over a file.

## Every tool is a command

`bin/commands.mjs` holds the functions. `node bin/fc.mjs <command>` runs them from a
terminal and this server offers them as tools. `docs/FOR-ASSISTANTS.md` describes the
documents they return.

## What has been checked

- 45 checks by a real MCP client (`@modelcontextprotocol/sdk`).
- Used from Claude Code 2.1.285, non-interactively, under the login it already had, with
  no other tool allowed: it called `explain_parameter` and answered from the result.
  `npm run verify:assistant -- --live` repeats that; it uses your own Claude Code account.
- **Not checked:** any other assistant. macOS and Linux.
