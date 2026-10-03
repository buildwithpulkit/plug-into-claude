import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseSummary, promotedNote, splitParagraphs, transcriptUpTo } from '../hooks/tangents'
import type { Tangent } from '../types'

const PLUGIN = 'tangents'
const PANE = 'tangents'
const REPLY_ID = 'msg_reply_1'
const BLOCK = [
  'The cache is keyed by user id.',
  '',
  'Eviction runs every five minutes, which is why stale reads last that long.',
  '',
  '```ts',
  'evict()',
  '',
  'log()',
  '```',
].join('\n')

const PANE_PROPS = {
  title: 'Tangent',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

/**
 * Stands in for the engine beneath the plugin: drawing, model, session, panes.
 * These hooks run in an environment of their own, so they report what they saw
 * through what they answer: the model's reply text, and the append's verdict.
 */
function engine(on: On) {
  mock.clock(on, { now: 1000 })
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.text}</Text>
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.scroll', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'How does the cache work?', toolUses: [] },
      { role: 'assistant' as const, text: BLOCK, toolUses: [] },
      { role: 'user' as const, text: 'LATER QUESTION', toolUses: [] },
      { role: 'assistant' as const, text: 'LATER ANSWER', toolUses: [] },
    ],
  }))
  on('model.complete', (_$, e) => {
    const isSummary = e.prompt.includes('Asked: <')
    const hasContext =
      e.prompt.includes('How does the cache work?') &&
      e.prompt.includes('<paragraph>\nEviction runs every five minutes') &&
      e.prompt.includes('Why five minutes?')
    const text = isSummary
      ? 'Asked: Why stale reads last five minutes.\nConcluded: Eviction is periodic; lowering the interval fixes it.'
      : e.prompt.includes('LATER')
        ? 'LEAKED: saw the conversation past the reply'
        : hasContext
          ? 'Because eviction is periodic, not on write.'
          : 'MISSING: the conversation, paragraph or question'

    return {
      value: {
        isAnswered: true as const,
        text,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  // No stub for session.append: nothing beneath a test can store a row (an
  // answer without `next` is skipped), so a promote's append surfaces as the
  // engine's 'no implementation' error, which proves the append was attempted.
}

describe('helpers', () => {
  test('splits on blank lines and keeps code fences whole', () => {
    const paragraphs = splitParagraphs(BLOCK)
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[2]).toContain('evict()\n\nlog()')
  })

  test('cuts the transcript after the reply the paragraph came from', () => {
    const context = transcriptUpTo(
      [
        { role: 'user', text: 'first', toolUses: [] },
        { role: 'assistant', text: BLOCK, toolUses: [] },
        { role: 'user', text: 'after', toolUses: [] },
      ],
      BLOCK,
      'Eviction runs every five minutes',
    )
    expect(context).toContain('first')
    expect(context).not.toContain('after')
  })

  test('the promoted note quotes the paragraph, the question and the conclusion', () => {
    const tangent: Tangent = {
      id: 't',
      requestId: 'r',
      paragraph: 'Eviction runs every five minutes.',
      block: BLOCK,
      replyHint: 'The cache',
      paragraphIndex: 1,
      paragraphCount: 3,
      createdAt: 0,
      messages: [
        { role: 'user', text: 'Why five minutes?' },
        { role: 'assistant', text: 'Because eviction is periodic.' },
      ],
      isPending: false,
      isPromoting: false,
      isPromoted: false,
    }
    const fromModel = parseSummary('Asked: Why five.\nConcluded: It is periodic.', tangent)
    expect(fromModel).toEqual({ asked: 'Why five.', concluded: 'It is periodic.' })
    const fallback = parseSummary(undefined, tangent)
    expect(fallback).toEqual({ asked: 'Why five minutes?', concluded: 'Because eviction is periodic.' })
    const note = promotedNote(tangent, fromModel)
    expect(note).toContain('[Tangent promoted by the user]')
    expect(note).toContain('> Eviction runs every five minutes.')
    expect(note).toContain('Asked: Why five.')
    expect(note).toContain('Concluded: It is periodic.')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: tangent, isolated answer, badge, promote, list`, { timeoutMs: 15000 }, async ($, on) => {
    engine(on)

    const reply = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'AssistantMessage',
      requestId: REPLY_ID,
      props: { text: BLOCK, isFirstOfReply: true },
    })
    // One hover-revealed button per paragraph, hidden at rest; no badges yet.
    expect(await reply.findAll({ type: 'Button', text: '↳ Tangent' })).toHaveLength(3)
    expect(await reply.find({ type: 'Button', text: /💬/ })).toBeUndefined()
    const hidden = await reply.findAll({ type: 'Box' })
    expect(hidden.filter(box => box.props.display === 'none')).toHaveLength(3)
    // Off the terminal every paragraph is its own Markdown, not one of several
    // engine drawings, of which the desktop draws only the first.
    if (surface !== 'terminal') {
      expect(await reply.findAll({ type: 'Markdown' })).toHaveLength(3)
      expect(await reply.find({ type: 'Markdown', text: /Eviction runs every five minutes/ })).toBeDefined()
    }

    await reply.press({ key: 'reply1' })

    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: 'Tangent' })).toBeDefined()
    expect(await pane.find({ type: 'Markdown', text: /Eviction runs every five minutes/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /paragraph 2 of 3/ })).toBeDefined()

    await pane.input({ key: 'ask0', text: 'Why five minutes?' })

    // The tangent question carries the conversation up to the reply, not past it.
    // The question carried the conversation up to the reply and no further.
    expect(await pane.find({ type: 'Markdown', text: /LEAKED|MISSING/ })).toBeUndefined()
    expect(await pane.find({ type: 'Markdown', text: /eviction is periodic/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Promoted ✓' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /session\.append/ })).toBeUndefined()

    await reply.redraw()
    expect((await reply.find({ type: 'Button', key: 'badge1' }))?.text).toBe('💬 2')
    expect(await reply.find({ type: 'Button', key: 'badge0' })).toBeUndefined()

    await pane.press({ key: 'promote' })
    // Promote, and only promote, reaches the main conversation.
    expect(await pane.find({ type: 'Text', text: /session\.append/ })).toBeDefined()

    await pane.press({ key: 'all' })
    expect(await pane.find({ type: 'Text', text: 'Tangents' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /2 replies/ })).toBeDefined()
    await pane.press({ key: 'pick0' })
    expect(await pane.find({ type: 'Text', text: /paragraph 2 of 3/ })).toBeDefined()

    await reply.unmount()
    await pane.unmount()
  })
}
