import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { TangentsView, Tangent, TangentMessage } from '../types'
import {
  MAX_MARKDOWN_CHARS,
  SUMMARY_SYSTEM,
  TANGENT_SYSTEM,
  clip,
  parseSummary,
  preview,
  promotedNote,
  replyCount,
  splitParagraphs,
  summaryPrompt,
  tangentIdFor,
  tangentPrompt,
  transcriptUpTo,
} from './tangents'

const PANE = 'tangents'

// The hover label, and the width of the column beside each paragraph that holds
// it or the `💬 N` badge: wide enough for the label, so neither covers the text.
const START_LABEL = '↳ Tangent'
const CONTROL_COLUMNS = START_LABEL.length

// The sidebar quotes the paragraph as a short plain-text excerpt: the whole of
// it is in the reply beside the pane, and a long one would push the tangent down.
const QUOTE_CHARS = 280

// The session state this mod keeps (types/index.d.ts). Each is read and written
// with $.state.get and $.state.set; a get while drawing subscribes the drawing.
const TANGENTS = { plugin: 'tangents', key: 'tangents' } as const
const OPEN_ID = { plugin: 'tangents', key: 'openId' } as const
const VIEW = { plugin: 'tangents', key: 'view' } as const

// Named types, so every function that takes $ has a plain one-line signature:
// the Claude directory follows $ only into functions declared that simply.
type TangentMap = Record<string, Tangent>
type TangentMapEdit = (all: TangentMap) => TangentMap
type TangentEdit = (tangent: Tangent) => Tangent
type OpenId = string | null
type Paragraphs = readonly string[]

/** Read, change and write the tangents, again on a version miss, so two writes both land. */
async function updateTangents($: EngineInterface, fn: TangentMapEdit) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const held = await $.state.get(TANGENTS)
    const written = await $.state.set(TANGENTS, fn(held.value ?? {}), { ifVersion: held.version })
    if (written.isSet) return
  }
}

async function setOpenId($: EngineInterface, id: OpenId) {
  await $.state.set(OPEN_ID, id)
}

async function setView($: EngineInterface, view: TangentsView) {
  await $.state.set(VIEW, view)
}

async function patch($: EngineInterface, id: string, fn: TangentEdit) {
  await updateTangents($, all => {
    const tangent = all[id]

    return tangent === undefined ? all : { ...all, [id]: fn(tangent) }
  })
}

async function show($: EngineInterface, mode: TangentsView, id: OpenId) {
  if (id !== null) await setOpenId($, id)
  await setView($, mode)
  const opened = await $.ui.open({ id: PANE, title: 'Tangent', focus: true })
  if (!opened.isPlaced) $.ui.toast('tangents: widen the window to see the tangent')
}

async function scrollToEnd($: EngineInterface) {
  try {
    await $.ui.scroll({ in: PANE, to: 'end' })
  } catch {
    // Scrolling is a nicety: a pane not on screen has nothing to scroll.
  }
}

async function openTangent($: EngineInterface, requestId: string, block: string, paragraphs: Paragraphs, index: number) {
  const paragraph = paragraphs[index]!
  const id = tangentIdFor(requestId, paragraph)
  const now = await $.clock.now()
  await updateTangents($, all =>
    all[id] !== undefined
      ? all
      : {
          ...all,
          [id]: {
            id,
            requestId,
            paragraph,
            block,
            replyHint: preview(paragraphs[0]!, 48),
            paragraphIndex: index,
            paragraphCount: paragraphs.length,
            createdAt: now,
            messages: [],
            isPending: false,
            isPromoting: false,
            isPromoted: false,
          },
        },
  )
  await show($, 'tangent', id)
}

function failure(result: { reason: string; status?: number | null }): string {
  if (result.reason === 'api-error') return `The tangent request failed (API error ${result.status ?? 'no response'}). Ask again to retry.`
  if (result.reason === 'aborted') return 'The tangent request was cut short. Ask again to retry.'

  return 'Claude returned no text. Ask again to retry.'
}

async function ask($: EngineInterface, id: string, question: string) {
  const text = question.trim()
  const held = await $.state.get(TANGENTS)
  const all = held.value ?? {}
  const tangent = all[id]
  if (text === '' || tangent === undefined || tangent.isPending) return

  await patch($, id, t => ({
    ...t,
    isPending: true,
    messages: [...t.messages, { role: 'user', text }],
  }))
  await scrollToEnd($)

  let reply: TangentMessage
  try {
    // Built fresh per question: the main conversation up to the reply, the
    // paragraph, and this tangent so far. Nothing here is appended anywhere.
    const transcript = await $.session.messages()
    const context = transcriptUpTo(Array.isArray(transcript) ? transcript : [], tangent.block, tangent.paragraph)
    const model = await $.session.model()
    const result = await $.model.complete({
      model,
      system: TANGENT_SYSTEM,
      prompt: tangentPrompt(context, tangent, text),
      maxTokens: 4096,
      timeoutMs: 300_000,
    })
    reply = result.isAnswered
      ? { role: 'assistant', text: result.text }
      : { role: 'assistant', text: failure(result), isError: true }
  } catch (error) {
    reply = { role: 'assistant', text: `The tangent request was refused: ${String(error)}`, isError: true }
  }

  await patch($, id, t => ({ ...t, isPending: false, messages: [...t.messages, reply] }))
  await scrollToEnd($)
}

async function promote($: EngineInterface, id: OpenId) {
  const held = await $.state.get(TANGENTS)
  const all = held.value ?? {}
  const tangent = id === null ? undefined : all[id]
  if (tangent === undefined) return $.ui.toast('No tangent is open to promote.')
  if (tangent.isPromoted) return $.ui.toast('This tangent is already promoted.')
  if (tangent.isPromoting) return
  if (tangent.isPending) return $.ui.toast('Wait for the tangent reply before promoting.')
  if (!tangent.messages.some(m => m.role === 'assistant' && !m.isError)) {
    return $.ui.toast('Nothing to promote yet: ask something in the tangent first.')
  }

  await patch($, tangent.id, t => ({ ...t, isPromoting: true, promoteError: undefined }))
  try {
    let written: string | undefined
    try {
      const result = await $.model.complete({
        model: 'haiku',
        system: SUMMARY_SYSTEM,
        prompt: summaryPrompt(tangent),
        maxTokens: 400,
        effort: 'low',
        timeoutMs: 60_000,
      })
      if (result.isAnswered) written = result.text
    } catch {
      // No summary model: parseSummary builds one from the tangent itself.
    }
    const summary = parseSummary(written, tangent)
    const appended = await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: promotedNote(tangent, summary) }] },
    })
    if (appended.deny !== undefined) {
      await patch($, tangent.id, t => ({ ...t, isPromoting: false, promoteError: `Promote refused: ${appended.deny}` }))

      return
    }
    await patch($, tangent.id, t => ({ ...t, isPromoting: false, isPromoted: true }))
    $.ui.toast('Tangent promoted: Claude will see its summary on the next turn.')
  } catch (error) {
    await patch($, tangent.id, t => ({ ...t, isPromoting: false, promoteError: `Promote failed: ${String(error)}` }))
  }
}

async function close($: EngineInterface) {
  await setOpenId($, null)
  await $.ui.close({ id: PANE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A reload drops the module's in-flight requests: settle what they left.
    await updateTangents($, all =>
      Object.fromEntries(
        Object.entries(all).map(([id, t]) => [
          id,
          t.isPending || t.isPromoting
            ? {
                ...t,
                isPromoting: false,
                isPending: false,
                messages: t.isPending
                  ? [...t.messages, { role: 'assistant' as const, text: 'Interrupted by a reload. Ask again to retry.', isError: true }]
                  : t.messages,
              }
            : t,
        ]),
      ),
    )

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await setOpenId($, null)

    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const block = e.props.text
    const paragraphs = splitParagraphs(block)
    if (paragraphs.length === 0) return next(e)

    // Off the terminal one reply holds one engine drawing: the desktop draws the
    // first `next` and drops the rest, so there each paragraph is a Markdown,
    // and a paragraph too long for one leaves the reply to the engine.
    const isTerminal = e.surface === 'terminal'
    if (!isTerminal && paragraphs.some(p => p.length > MAX_MARKDOWN_CHARS)) return next(e)

    const held = await $.state.get(TANGENTS)
    const all = held.value ?? {}
    const { Box, Button, Markdown } = $.ui.resolve(e)

    // Each paragraph is drawn as a reply is, so it looks as it always does; the
    // controls sit in a narrow column to its right, so they never cover its
    // text, and revealing one on hover moves nothing.
    const drawn: RenderElement[] = []
    for (const [index, text] of paragraphs.entries()) {
      drawn.push(
        isTerminal
          ? await next({
              ...e,
              props: { ...e.props, text, isFirstOfReply: e.props.isFirstOfReply && index === 0 },
            })
          : <Markdown text={text} />,
      )
    }

    // Each Markdown trims its own outer margins, so off the terminal the
    // paragraphs would touch; a row between them restores the reply's spacing.
    return (
      <Box flexDirection="column" rowGap={isTerminal ? 0 : 1}>
        {paragraphs.map((paragraph, index) => {
          const count = replyCount(all[tangentIdFor(e.requestId, paragraph)])
          const open = () => openTangent($, e.requestId, block, paragraphs, index)

          return (
            <Box key={`p${index}`} flexDirection="row">
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                {drawn[index]}
              </Box>
              <Box width={CONTROL_COLUMNS} flexShrink={0} marginLeft={1}>
                {count > 0 ? (
                  <Box position="absolute" top={0} right={0}>
                    <Button key={`badge${index}`} plain label={`💬 ${count}`} onPress={open} />
                  </Box>
                ) : (
                  <Box position="absolute" top={0} right={0} display="none" hover={{ display: 'flex' }}>
                    <Button key={`reply${index}`} plain dimColor label={START_LABEL} onPress={open} />
                  </Box>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = table
    const heldTangents = await $.state.get(TANGENTS)
    const heldOpenId = await $.state.get(OPEN_ID)
    const heldView = await $.state.get(VIEW)
    const all = heldTangents.value ?? {}
    const id = heldOpenId.value ?? null
    const tangent = id === null ? undefined : all[id]

    if (heldView.value === 'list' || tangent === undefined) {
      const listed = Object.values(all)
        .filter(t => t.messages.length > 0 || t.isPromoted)
        .sort((a, b) => b.createdAt - a.createdAt)
      const width = Math.max(20, e.props.bodyColumns - 24)

      return (
        <Box flexDirection="column">
          <Text bold>Tangents</Text>
          {listed.length === 0 && (
            <Text dimColor>No tangents yet. Hover a paragraph of Claude's reply and pick {START_LABEL}.</Text>
          )}
          {listed.map((t, index) => (
            <Box key={`row${index}`} flexDirection="row" marginTop={index === 0 ? 1 : 0}>
              <Button
                key={`pick${index}`}
                plain
                hotkey={index < 9 ? String(index + 1) : undefined}
                label={preview(t.paragraph, width)}
                onPress={() => show($, 'tangent', t.id)}
              />
              <Text dimColor>
                {' '}· {t.messages.length} {t.messages.length === 1 ? 'reply' : 'replies'}
                {t.isPromoted ? ' · Promoted ✓' : ''}
              </Text>
            </Box>
          ))}
        </Box>
      )
    }

    // Mobile draws no Input: the tangent is read-only there.
    const Input = 'Input' in table ? table.Input : undefined
    const status = tangent.isPromoted ? 'Promoted ✓' : tangent.isPromoting ? 'Promoting…' : undefined
    // A desktop row of margin is a thin gap; two give the sections room.
    const gap = e.surface === 'terminal' ? 1 : 2

    // The pane's own title already reads "Tangent", so the body opens on the
    // hint. It fills the pane's height, so the input and the buttons sit at its
    // bottom with the conversation above them.
    return (
      <Box flexDirection="column" minHeight={e.props.scroll.bodyRows}>
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Box flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                From Claude's reply “{tangent.replyHint}” · paragraph {tangent.paragraphIndex + 1} of {tangent.paragraphCount}
              </Text>
            </Box>
            {status !== undefined && (
              <Box flexShrink={0}>
                <Text color={tangent.isPromoted ? 'green' : undefined} dimColor={!tangent.isPromoted}>{status}</Text>
              </Box>
            )}
          </Box>
          <Box marginTop={gap}>
            <Markdown dimColor text={`> ${preview(tangent.paragraph, QUOTE_CHARS)}`} />
          </Box>
          {tangent.messages.map((message, index) => (
            <Box key={`m${index}`} flexDirection="column" marginTop={gap}>
              <Text bold color={message.role === 'assistant' ? 'cyan' : undefined}>
                {message.role === 'user' ? 'You' : 'Claude'}
              </Text>
              {message.isError ? (
                <Text color="red">{message.text}</Text>
              ) : (
                <Markdown text={clip(message.text, MAX_MARKDOWN_CHARS)} />
              )}
            </Box>
          ))}
          {tangent.isPending && (
            <Box marginTop={gap}>
              <Text dimColor>Claude is thinking…</Text>
            </Box>
          )}
          {tangent.promoteError !== undefined && (
            <Box marginTop={gap}>
              <Text color="red">{tangent.promoteError}</Text>
            </Box>
          )}
        </Box>
        <Box marginTop={gap} flexDirection="column">
          {Input === undefined ? (
            <Text dimColor>Reply from the terminal or desktop.</Text>
          ) : (
            // Input takes no width of its own: a growing cell in a full-width
            // row asks the surface to stretch the field across the pane.
            <Box flexDirection="row" width="100%">
              <Box flexGrow={1} flexShrink={1}>
                <Input
                  key={`ask${tangent.messages.length}`}
                  placeholder={tangent.isPending ? 'Waiting for the reply…' : 'Ask about this paragraph…'}
                  submitLabel="send"
                  autoFocus
                  onSubmit={value => ask($, tangent.id, value)}
                />
              </Box>
            </Box>
          )}
          <Box flexDirection="row" gap={1} marginTop={1}>
            {!tangent.isPromoted && (
              <Button key="promote" variant="primary" label="⇪ Promote to main" onPress={() => promote($, tangent.id)} />
            )}
            <Button key="all" label="All tangents" onPress={() => show($, 'list', null)} />
            <Button key="close" role="dismiss" label="Close" onPress={() => close($)} />
          </Box>
        </Box>
      </Box>
    )
  })
}
