// Obsidian inline syntax that CommonMark doesn't know (dialect §5): `==highlight==` and
// inline `%%comment%%`. Both are single-line constructs. Like wikilinks and tags (S1 F1/F2),
// they must be syntax nodes, or re-rendering an edited block escapes or drops them (S2).
// Limitation: text inside a highlight is not parsed for nested formatting (kept as text).

import type { CompileContext, Extension as FromMarkdownExtension, Token } from 'mdast-util-from-markdown'
import type { Options as ToMarkdownExtension, State as ToMarkdownState, Info } from 'mdast-util-to-markdown'
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from 'micromark-util-types'
import type { Parents, PhrasingContent, Text } from 'mdast'

export interface HighlightNode {
  type: 'highlight'
  children: PhrasingContent[]
  position?: import('unist').Position
}

export interface CommentNode {
  type: 'comment'
  value: string // text between the %% markers
  position?: import('unist').Position
}

declare module 'mdast' {
  interface PhrasingContentMap { highlight: HighlightNode; comment: CommentNode }
  interface RootContentMap { highlight: HighlightNode; comment: CommentNode }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    highlight: 'highlight'; highlightMarker: 'highlightMarker'; highlightData: 'highlightData'
    comment: 'comment'; commentMarker: 'commentMarker'; commentData: 'commentData'
  }
}

/** A `XXcontentXX` construct where X is `marker` (one line, non-empty content). */
function delimited(marker: number, names: { node: 'highlight' | 'comment'; marker: 'highlightMarker' | 'commentMarker'; data: 'highlightData' | 'commentData' }): Construct {
  function tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    let size = 0
    return open

    function open(code: Code): State | undefined {
      if (code !== marker) return nok(code)
      effects.enter(names.node)
      effects.enter(names.marker)
      effects.consume(code)
      return openSecond
    }
    function openSecond(code: Code): State | undefined {
      if (code !== marker) return nok(code)
      effects.consume(code)
      effects.exit(names.marker)
      effects.enter(names.data)
      return data
    }
    function data(code: Code): State | undefined {
      if (code === null || code < 0) return nok(code) // no line endings
      if (code === marker) return effects.check({ tokenize: closing, partial: true }, close, inside)(code)
      size++
      effects.consume(code)
      return data
    }
    function inside(code: Code): State | undefined {
      size++
      effects.consume(code)
      return data
    }
    function close(code: Code): State | undefined {
      if (size === 0) return nok(code)
      effects.exit(names.data)
      effects.enter(names.marker)
      effects.consume(code)
      return closeSecond
    }
    function closeSecond(code: Code): State | undefined {
      effects.consume(code)
      effects.exit(names.marker)
      effects.exit(names.node)
      return ok
    }
  }
  function closing(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    return (code: Code) => {
      if (code !== marker) return nok(code)
      effects.consume(code)
      return (next: Code) => (next === marker ? ok(next) : nok(next))
    }
  }
  return { name: names.node, tokenize }
}

const EQUALS = 61
const PERCENT = 37

export const inlineSyntax: Extension = {
  text: {
    [EQUALS]: delimited(EQUALS, { node: 'highlight', marker: 'highlightMarker', data: 'highlightData' }),
    [PERCENT]: delimited(PERCENT, { node: 'comment', marker: 'commentMarker', data: 'commentData' }),
  },
}

export const inlineFromMarkdown: FromMarkdownExtension = {
  enter: {
    highlight(this: CompileContext, token: Token) {
      this.enter({ type: 'highlight', children: [] } as never, token)
    },
    comment(this: CompileContext, token: Token) {
      this.enter({ type: 'comment', value: '' } as never, token)
    },
  },
  exit: {
    highlightData(this: CompileContext, token: Token) {
      const node = this.stack[this.stack.length - 1] as unknown as HighlightNode
      const text: Text = {
        type: 'text',
        value: this.sliceSerialize(token),
        position: { start: { ...token.start }, end: { ...token.end } },
      }
      node.children.push(text)
    },
    highlight(this: CompileContext, token: Token) {
      this.exit(token)
    },
    commentData(this: CompileContext, token: Token) {
      ;(this.stack[this.stack.length - 1] as unknown as CommentNode).value = this.sliceSerialize(token)
    },
    comment(this: CompileContext, token: Token) {
      this.exit(token)
    },
  },
}

export const inlineToMarkdown: ToMarkdownExtension = {
  // Literal `==` / `%%` typed as text must be escaped, or they'd read back as a highlight or a
  // comment (found by S2's read-back check: `==>word$==` became a highlight on reload).
  unsafe: [
    { character: '=', after: '=', inConstruct: 'phrasing' },
    { character: '%', after: '%', inConstruct: 'phrasing' },
    // Any literal `$` could open inline math (`$*word$` would read back as math), so escape all.
    { character: '$', inConstruct: 'phrasing' },
  ],
  handlers: {
    highlight: (node: HighlightNode, _parent: Parents | undefined, state: ToMarkdownState, info: Info) =>
      '==' + state.containerPhrasing(node as never, { ...info, before: '=', after: '=' }) + '==',
    comment: (node: CommentNode) => `%%${node.value}%%`,
  } as never,
}

// ---------------------------------------------------------------- inline math

declare module 'micromark-util-types' {
  interface TokenTypeMap { obsidianMath: 'obsidianMath'; obsidianMathMarker: 'obsidianMathMarker'; obsidianMathData: 'obsidianMathData' }
}

const DOLLAR = 36
const BACKSLASH = 92
const isSpace = (code: Code) => code === null || code < 0 || code === 32 || code === 9
const isDigit = (code: Code) => code !== null && code >= 48 && code <= 57

/**
 * `$math$` with Obsidian's rules (QA review of S2): the opening `$` is followed by a non-space,
 * the closing `$` is preceded by a non-space and not followed by a digit, one line only.
 * So `Paid $5 for [[Lunch]] and $3` is text (its link and tags count), `$e^{i\pi}$` is math.
 * `micromark-extension-math` would take any `$…$`; it is used for `$$` only.
 */
const obsidianMath: Construct = {
  name: 'obsidianMath',
  tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    let previous: Code = null
    return start

    function start(code: Code): State | undefined {
      if (code !== DOLLAR) return nok(code)
      effects.enter('obsidianMath')
      effects.enter('obsidianMathMarker')
      effects.consume(code)
      effects.exit('obsidianMathMarker')
      return afterOpen
    }
    function afterOpen(code: Code): State | undefined {
      if (isSpace(code) || code === DOLLAR) return nok(code) // `$ x` or `$$` (left to the $$ extension)
      effects.enter('obsidianMathData')
      return data(code)
    }
    function data(code: Code): State | undefined {
      if (code === null || code < 0) return nok(code)
      if (code === DOLLAR && !isSpace(previous) && previous !== BACKSLASH) { // `\$` is a literal dollar
        return effects.check({ tokenize: closing, partial: true }, close, inside)(code)
      }
      return inside(code)
    }
    function inside(code: Code): State | undefined {
      previous = code
      effects.consume(code)
      return data
    }
    function close(code: Code): State | undefined {
      effects.exit('obsidianMathData')
      effects.enter('obsidianMathMarker')
      effects.consume(code)
      effects.exit('obsidianMathMarker')
      effects.exit('obsidianMath')
      return ok
    }
  },
}

function closing(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return (code: Code) => {
    effects.consume(code) // the `$`
    return (next: Code) => (isDigit(next) ? nok(next) : ok(next))
  }
}

export const mathSyntax: Extension = { text: { [DOLLAR]: obsidianMath } }

export const mathFromMarkdownObsidian: FromMarkdownExtension = {
  enter: {
    obsidianMath(this: CompileContext, token: Token) {
      this.enter({ type: 'inlineMath', value: '' } as never, token)
    },
  },
  exit: {
    obsidianMathData(this: CompileContext, token: Token) {
      ;(this.stack[this.stack.length - 1] as unknown as { value: string }).value = this.sliceSerialize(token)
    },
    obsidianMath(this: CompileContext, token: Token) {
      this.exit(token)
    },
  },
}
