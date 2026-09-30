# Chat

The conversation, as drawn. Used by the Assistant screen and by the widget; both read
`stores/core/assistantStore`.

| component | job |
|---|---|
| `ChatThread` | the messages, oldest first. Follows the answer as it is written, unless the reader has scrolled up |
| `ChatInput` | the box: text, the paperclip, drop, paste, Send and Stop |
| `ChatMarkdown` | an answer's text |
| `ChatAttachment` | a picture, a video with a player, or a chip for any other file |
| `ChatToolCard` | one use of a tool: what was asked, what came back, and the same as MCP carries it |

```tsx
<ChatThread empty={<Welcome />} />
<ChatInput />
// the widget's size
<ChatThread compact empty={...} />
<ChatInput compact />
```

## Rules

- **The chat does not know which assistant answers.** It shows `AssistantEvent`s from
  whatever adapter is chosen. Nothing here names Claude Code.
- **Every use of a tool is a card, and the card can be opened.** What an assistant says
  can always be checked against what it was given.
- **No HTML is taken from an answer**, and **no picture is fetched from the internet.**
  An address in an answer is chosen by whatever wrote the answer; fetching it would tell
  a stranger's server that this page is open, and what is in the address. A remote
  picture is shown as its link. Pictures from this browser's own storage (`blob:`) and
  pictures written into the answer itself (`data:image/`) are shown.
- **Links open in a new tab** with `noopener noreferrer nofollow`.
- **A video is for the person.** Its caption says an assistant cannot watch it.
- **An assistant that is not an AI says so**, beside its name, on every answer.
- **Enter sends; Shift and Enter makes a new line.** While an answer is being written,
  Send becomes Stop.
- **An attached file is kept in IndexedDB** (`fc-chat-file:<id>`), shown through an
  address made when it comes on screen and given back when it leaves. It is deleted with
  its conversation. 200 MB at most, twelve files to a message.
- **Status is an icon and a word**: working, answered, could not answer.
