# tangents

Go off on a tangent about any paragraph of Claude's replies in
[Claude Code](https://claude.com/claude-code). Dig into it in a sidebar without
cluttering the main conversation, and promote a summary back when you're done.

## Installing

This plugin ships in the [plug-into-claude](../../README.md) marketplace. In
Claude Code, run:

```text
/plugin marketplace add buildwithpulkit/plug-into-claude
/plugin install tangents@plug-into-claude
/reload-plugins
```

The plugin starts when you reload. If it doesn't show up, restart Claude Code.

From a terminal instead:

```sh
claude plugin marketplace add buildwithpulkit/plug-into-claude
claude plugin install tangents@plug-into-claude --scope user
```

A plugin is code that runs inside Claude Code on your machine, with the same
access Claude Code has. This one is written by me, not by Anthropic. Read the
code first, as you would with any package.

## Using it

- **Hover a paragraph** of any Claude reply. `↳ Tangent` appears in a narrow
  column to its right, clear of the text. When you're not hovering, that column
  is empty.
- **Click it** to open the **Tangent** sidebar. It shows the paragraph (dimmed),
  which reply it came from, the tangent so far and an input at the bottom.
- **Paragraphs with a tangent** always show a `💬 N` badge. Click the badge to
  reopen that tangent.
- **Esc** returns focus to the main prompt. The sidebar and the tangent stay.
- **⇪ Promote to main** adds a short summary to the main conversation: the
  quoted paragraph, what you asked and what you concluded. Claude sees it on
  the next turn, and the tangent is marked **Promoted ✓**.
- **All tangents** lists this session's tangents with a preview, reply count and
  promoted state. Pick one to open it (keys `1` to `9` work too).
- **Close** closes the sidebar. Click any `💬 N` badge to bring it back.

The plugin adds no slash commands. Everything is in the sidebar and on the
replies themselves.

## How context stays isolated

Each question is a separate, tool-less `$.model.complete` call on the session's
model. The call carries the main conversation up to and including the reply
the paragraph came from, then the paragraph, then this tangent's history.
Neither the questions nor the answers are appended to the session, so the main
context window doesn't grow. Only promote writes to the main conversation:
one `$.session.append` user row holding the summary. The summary is written by
`haiku`; if that call fails, it is built from the tangent itself.

Tangents live in the session's plugin state (`$.state`), so they survive a plugin
reload. A tangent is keyed by the reply's id plus the paragraph's text, so
every paragraph has its own tangent.

## What the hooks do

The plugin hooks four events. None of them touches permissions, settings,
files, agents or commands.

| Hook | What it does |
| --- | --- |
| `session.start` | Settles any tangent request a reload interrupted. Passes the event on with `next(e)`. |
| `ui.close` | When the Tangent sidebar closes, forgets which tangent was open. Passes every close on with `next(e)`. |
| `ui.render` on `AssistantMessage` | Draws each paragraph of a reply (with Claude Code's own renderer in the terminal, as `Markdown` on the desktop and other surfaces) and adds the hover button or `💬 N` badge in a column beside each paragraph. The stored message is untouched. |
| `ui.render` on this mod's `Pane` | Draws the Tangent sidebar and the tangent list. |

The mod's calls: `$.model.complete` answers tangent questions (and writes the
promote summary with `haiku`), `$.session.messages` reads the conversation for
context, and `$.session.append` adds the summary when you promote, and only then.

## Compared with the built-in `/btw`

Claude Code (checked on 2.1.288) has a built-in `/btw` command: "Ask a quick
side question without interrupting the main conversation." It covers the
isolated side question. This plugin adds tangents tied to paragraphs, keeps
them for the session, and lets you promote one into the main conversation.

| | Built-in `/btw` | This plugin |
| --- | --- | --- |
| Ask without adding to the main context | Yes | Yes |
| Works while Claude is mid-turn | Yes | Yes |
| No tools in the side answer | Yes | Yes |
| Follow-up questions | Yes | Yes |
| Tied to a specific paragraph | No, it's about the conversation as a whole | Yes, the paragraph is quoted and in the prompt |
| Context cut off at that reply | No, it appears to use the whole conversation | Yes, the conversation up to and including that reply |
| Hover button on each paragraph | No | Yes |
| One saved tangent per paragraph, `💬 N` badges | No | Yes |
| A list to reopen any tangent | No | Yes |
| Promote a summary into the main conversation | No | Yes |
| Sidebar | No, a temporary answer | Yes |
| Reuses the main conversation's prompt cache | Yes | No, each question resends the conversation in full |

The `/btw` column comes from its definition and text in the CLI, not from
using it side by side.

## Developing

Run it from a local checkout, without installing:

```sh
claude --plugin-dir /path/to/plug-into-claude/plugins/tangents
```

Check and test it, from this directory:

```sh
claude plugin validate ../..                        # the marketplace
claude plugin validate .claude-plugin/plugin.json   # the plugin
claude plugin test .
```

- `hooks/register.tsx`: the hooks (reply rendering, sidebar, promote).
- `hooks/tangents.ts`: pure helpers (paragraph split, transcript cut, prompts).
- `types/index.d.ts`: the `$.state` contract.

## Privacy

The plugin collects nothing and has no server. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
