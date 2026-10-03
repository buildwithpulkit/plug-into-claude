// Pure helpers: splitting replies into paragraphs, naming tangents, and
// building the prompts a tangent sends. No `$` in here, so tests reach it whole.

import type { SessionMessage } from 'claude-code'

import type { Tangent } from '../types'

/** How much of the main conversation a tangent question carries, newest kept. */
export const MAX_CONTEXT_CHARS = 240_000

/** Markdown elements draw at most 10000 characters. */
export const MAX_MARKDOWN_CHARS = 9_900

const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * Splits a reply's markdown into paragraphs on blank lines, keeping fenced
 * code blocks whole even when they hold blank lines.
 */
export function splitParagraphs(markdown: string): string[] {
  const paragraphs: string[] = []
  let current: string[] = []
  let fence: string | null = null

  const flush = () => {
    const text = current.join('\n').trim()
    if (text !== '') paragraphs.push(text)
    current = []
  }

  for (const line of markdown.split('\n')) {
    const marker = FENCE.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === null) fence = marker[0]!.repeat(marker.length)
      else if (marker.startsWith(fence)) fence = null
    }
    if (fence === null && marker === undefined && line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  flush()

  return paragraphs
}

export function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** One tangent per paragraph of one reply: the reply's id and the paragraph's text. */
export function tangentIdFor(requestId: string, paragraph: string): string {
  return `${requestId}:${hash(normalize(paragraph))}`
}

/** Plain text of markdown, shortened to `max` characters on one line. */
export function preview(markdown: string, max: number): string {
  const plain = normalize(
    markdown
      .replace(/```[\s\S]*?```/g, ' [code] ')
      .replace(/[`*_#>]+/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'),
  )

  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The number a paragraph's badge shows: every message in its tangent. */
export function replyCount(tangent: Tangent | undefined): number {
  return tangent?.messages.length ?? 0
}

/**
 * The main conversation up to and including the reply the paragraph came
 * from, as plain text. The reply is found by its text block (or, failing
 * that, the paragraph); when neither is found the whole transcript is used.
 */
export function transcriptUpTo(
  messages: readonly SessionMessage[],
  block: string,
  paragraph: string,
): string {
  const wantBlock = normalize(block)
  const wantParagraph = normalize(paragraph)
  let end = messages.length - 1
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role !== 'assistant') continue
    const text = normalize(message.text)
    if (text.includes(wantBlock) || text.includes(wantParagraph)) {
      end = i
      break
    }
  }

  const lines: string[] = []
  for (const message of messages.slice(0, end + 1)) {
    const who = message.role === 'user' ? 'User' : 'Claude'
    const parts: string[] = []
    if (message.text.trim() !== '') parts.push(message.text.trim())
    for (const use of message.toolUses) parts.push(`[used tool ${use.tool}]`)
    if (message.toolResults?.length) parts.push(`[${message.toolResults.length} tool result(s)]`)
    if (parts.length > 0) lines.push(`${who}: ${parts.join('\n')}`)
  }

  const text = lines.join('\n\n')

  return text.length > MAX_CONTEXT_CHARS
    ? `[earlier conversation omitted]\n\n${text.slice(text.length - MAX_CONTEXT_CHARS)}`
    : text
}

export const TANGENT_SYSTEM = [
  'You are Claude, answering inside a tangent of a Claude Code session.',
  'The user picked one paragraph of your earlier reply and is asking about it here.',
  'This tangent is separate from the main conversation: you cannot run tools or change files from it.',
  'Answer the newest question directly and concisely, in markdown, staying on the paragraph unless asked otherwise.',
].join(' ')

function tangentSoFar(tangent: Tangent): string {
  return tangent.messages
    .filter(message => !message.isError)
    .map(message => `${message.role === 'user' ? 'User' : 'You'}: ${message.text}`)
    .join('\n\n')
}

export function tangentPrompt(context: string, tangent: Tangent, question: string): string {
  const history = tangentSoFar(tangent)

  return [
    '<main_conversation>',
    context === '' ? '(empty)' : context,
    '</main_conversation>',
    '',
    'The user opened a tangent on this paragraph of your reply:',
    '<paragraph>',
    tangent.paragraph,
    '</paragraph>',
    '',
    ...(history === '' ? [] : ['<tangent_so_far>', history, '</tangent_so_far>', '']),
    'The user asks in the tangent:',
    '<question>',
    question,
    '</question>',
  ].join('\n')
}

export const SUMMARY_SYSTEM =
  'You summarize a short side discussion for the record. Reply with exactly two lines and nothing else.'

export function summaryPrompt(tangent: Tangent): string {
  return [
    'A user discussed this paragraph of an assistant reply in a tangent:',
    '<paragraph>',
    tangent.paragraph,
    '</paragraph>',
    '<tangent>',
    tangentSoFar(tangent),
    '</tangent>',
    '',
    'Write exactly two lines:',
    'Asked: <what the user asked, one or two sentences>',
    'Concluded: <what was concluded or decided, two to four sentences>',
  ].join('\n')
}

export type Summary = { asked: string; concluded: string }

/** The model's two lines, or a summary made from the tangent itself. */
export function parseSummary(text: string | undefined, tangent: Tangent): Summary {
  const asked = text?.match(/^\s*Asked:\s*(.+)$/im)?.[1]?.trim()
  const concluded = text?.match(/^\s*Concluded:\s*([\s\S]+)$/im)?.[1]?.trim()
  if (asked && concluded) return { asked, concluded }

  const questions = tangent.messages.filter(m => m.role === 'user').map(m => m.text)
  const answers = tangent.messages.filter(m => m.role === 'assistant' && !m.isError)

  return {
    asked: clip(normalize(questions.join(' / ')), 400),
    concluded: clip(normalize(answers.at(-1)?.text ?? 'No answer was reached.'), 800),
  }
}

export function promotedNote(tangent: Tangent, summary: Summary): string {
  const quoted = clip(tangent.paragraph, 1200).replace(/^/gm, '> ')

  return [
    '[Tangent promoted by the user]',
    'The user discussed this paragraph of your earlier reply in a tangent:',
    quoted,
    '',
    `Asked: ${summary.asked}`,
    `Concluded: ${summary.concluded}`,
  ].join('\n')
}
