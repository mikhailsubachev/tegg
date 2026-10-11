// Inline `#tags` as real Markdown syntax (FR-FMT-10, dialect §5 "Tags").
// Without this, a tag at the start of a line is escaped to `\#tag` when an edited
// paragraph is re-rendered, and the tag disappears (finding from S1).

import type { CompileContext, Extension as FromMarkdownExtension, Token } from 'mdast-util-from-markdown'
import type { Options as ToMarkdownExtension } from 'mdast-util-to-markdown'
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from 'micromark-util-types'

export interface TagNode {
  type: 'tag'
  value: string // without '#'
  position?: import('unist').Position
}

declare module 'mdast' {
  interface PhrasingContentMap { tag: TagNode }
  interface RootContentMap { tag: TagNode }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap { tag: 'tag'; tagMarker: 'tagMarker'; tagName: 'tagName' }
}

const HASH = 35
const LEFT_PAREN = 40
const TAG_CHAR = /[\p{L}\p{M}\p{N}_\-/]/u
const NON_DIGIT = /[\p{L}\p{M}_\-/]/u

const tagConstruct: Construct = { name: 'tag', tokenize, previous }

// A tag starts at line start, after whitespace, or after '(' (dialect §5).
function previous(this: TokenizeContext, code: Code): boolean {
  return code === null || code < 0 || code === 32 || code === LEFT_PAREN
}

function tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let size = 0
  let hasNonDigit = false
  return start

  function start(code: Code): State | undefined {
    if (code !== HASH) return nok(code)
    effects.enter('tag')
    effects.enter('tagMarker')
    effects.consume(code)
    effects.exit('tagMarker')
    effects.enter('tagName')
    return name
  }

  function name(code: Code): State | undefined {
    const ch = code !== null && code >= 0 ? String.fromCharCode(code) : ''
    if (ch && TAG_CHAR.test(ch)) {
      if (NON_DIGIT.test(ch)) hasNonDigit = true
      size++
      effects.consume(code)
      return name
    }
    if (size === 0 || !hasNonDigit) return nok(code)
    effects.exit('tagName')
    effects.exit('tag')
    return ok(code)
  }
}

export const tagSyntax: Extension = { text: { [HASH]: tagConstruct } }

export const tagFromMarkdown: FromMarkdownExtension = {
  enter: {
    tag(this: CompileContext, token: Token) {
      this.enter({ type: 'tag', value: '' } as never, token)
    },
  },
  exit: {
    tagName(this: CompileContext, token: Token) {
      ;(this.stack[this.stack.length - 1] as unknown as TagNode).value = this.sliceSerialize(token)
    },
    tag(this: CompileContext, token: Token) {
      this.exit(token)
    },
  },
}

export const tagToMarkdown: ToMarkdownExtension = {
  handlers: { tag: (node: TagNode) => `#${node.value}` } as never,
}
