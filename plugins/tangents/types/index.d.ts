export type TangentMessage = {
  role: 'user' | 'assistant'
  text: string
  isError?: boolean
}

export type Tangent = {
  id: string
  /** The AssistantMessage instance the paragraph was drawn in. */
  requestId: string
  paragraph: string
  /** The whole text block the paragraph came from, to find it in the transcript. */
  block: string
  /** A short preview of the reply's opening, for the "from" note. */
  replyHint: string
  paragraphIndex: number
  paragraphCount: number
  createdAt: number
  messages: TangentMessage[]
  isPending: boolean
  isPromoting: boolean
  isPromoted: boolean
  /** Why the last promote did not land, shown in the sidebar until the next try. */
  promoteError?: string
}

export type TangentsView = 'tangent' | 'list'

declare module 'claude-code' {
  interface PluginState {
    'tangents': {
      tangents: Record<string, Tangent>
      openId: string | null
      view: TangentsView
    }
  }
}
