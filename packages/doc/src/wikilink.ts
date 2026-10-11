// Obsidian wikilinks and embeds as real Markdown syntax (dialect §5).
// Without this, micromark sees `[[Note]]` as plain text and mdast-util-to-markdown
// escapes it to `\[\[Note]]` when an edited block is re-rendered, breaking every
// link in that block (finding from S1). The node keeps the inner text verbatim,
// so alias, #heading, #^block, |size and `\|` survive unchanged.

import type { CompileContext, Extension as FromMarkdownExtension, Token } from 'mdast-util-from-markdown'
import type { Options as ToMarkdownExtension } from 'mdast-util-to-markdown'
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from 'micromark-util-types'

export interface WikiLinkNode {
  type: 'wikiLink'
  embed: boolean
  value: string // inner text between [[ and ]]
  position?: import('unist').Position
}

declare module 'mdast' {
  interface PhrasingContentMap { wikiLink: WikiLinkNode }
  interface RootContentMap { wikiLink: WikiLinkNode }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    wikiLink: 'wikiLink'
    wikiLinkEmbedMarker: 'wikiLinkEmbedMarker'
    wikiLinkMarker: 'wikiLinkMarker'
    wikiLinkData: 'wikiLinkData'
  }
}

const EXCLAMATION = 33
const LEFT_BRACKET = 91
const RIGHT_BRACKET = 93

const wikiLinkConstruct: Construct = { name: 'wikiLink', tokenize }

function tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let size = 0
  return start

  function start(code: Code): State | undefined {
    effects.enter('wikiLink')
    if (code === EXCLAMATION) {
      effects.enter('wikiLinkEmbedMarker')
      effects.consume(code)
      effects.exit('wikiLinkEmbedMarker')
      return openFirst
    }
    return openFirst(code)
  }

  function openFirst(code: Code): State | undefined {
    if (code !== LEFT_BRACKET) return nok(code)
    effects.enter('wikiLinkMarker')
    effects.consume(code)
    return openSecond
  }

  function openSecond(code: Code): State | undefined {
    if (code !== LEFT_BRACKET) return nok(code)
    effects.consume(code)
    effects.exit('wikiLinkMarker')
    effects.enter('wikiLinkData')
    return data
  }

  function data(code: Code): State | undefined {
    // No line endings (negative codes), no EOF, no nested `[`.
    if (code === null || code < 0 || code === LEFT_BRACKET) return nok(code)
    if (code === RIGHT_BRACKET) {
      if (size === 0) return nok(code)
      effects.exit('wikiLinkData')
      effects.enter('wikiLinkMarker')
      effects.consume(code)
      return closeSecond
    }
    size++
    effects.consume(code)
    return data
  }

  function closeSecond(code: Code): State | undefined {
    if (code !== RIGHT_BRACKET) return nok(code)
    effects.consume(code)
    effects.exit('wikiLinkMarker')
    effects.exit('wikiLink')
    return ok
  }
}

/** micromark syntax extension: `[[…]]` and `![[…]]` in text. Tried before links and images. */
export const wikiLinkSyntax: Extension = {
  text: { [LEFT_BRACKET]: wikiLinkConstruct, [EXCLAMATION]: wikiLinkConstruct },
}

/** mdast-util-from-markdown extension: builds `wikiLink` nodes. */
export const wikiLinkFromMarkdown: FromMarkdownExtension = {
  enter: {
    wikiLink(this: CompileContext, token: Token) {
      this.enter({ type: 'wikiLink', embed: false, value: '' } as never, token)
    },
  },
  exit: {
    wikiLinkEmbedMarker(this: CompileContext) {
      ;(this.stack[this.stack.length - 1] as unknown as WikiLinkNode).embed = true
    },
    wikiLinkData(this: CompileContext, token: Token) {
      ;(this.stack[this.stack.length - 1] as unknown as WikiLinkNode).value = this.sliceSerialize(token)
    },
    wikiLink(this: CompileContext, token: Token) {
      this.exit(token)
    },
  },
}

/** mdast-util-to-markdown extension: writes the link back verbatim, never escaped. */
export const wikiLinkToMarkdown: ToMarkdownExtension = {
  handlers: {
    wikiLink: (node: WikiLinkNode) => `${node.embed ? '!' : ''}[[${node.value}]]`,
  } as never,
}
