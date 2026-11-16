/** The marker characters of the engine's plain surfaces (markup.ts). */
const MISSING_OPEN = ''
const MISSING_CLOSE = ''
const PENDING_OPEN = ''
const PENDING_CLOSE = ''

export type Piece =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'missing'; readonly label: string }
  | { readonly kind: 'pending'; readonly label: string }

/**
 * A PLAIN surface of the engine (a heading, an annex title, a cost description, a total label) split on the four
 * marker characters (DD-47): text as it is, the label of a missing value, the label of the pending reference.
 * Never `parseInline` — a value `**x**` on such a surface is the literal characters. An opener without its closer
 * and a closer without its opener are dropped, as the markup reader does.
 */
export function splitMarked(source: string): Piece[] {
  const pieces: Piece[] = []
  let text = ''
  const flush = () => {
    if (text !== '') pieces.push({ kind: 'text', text })
    text = ''
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    if (char === MISSING_OPEN || char === PENDING_OPEN) {
      const close = source.indexOf(char === MISSING_OPEN ? MISSING_CLOSE : PENDING_CLOSE, index + 1)
      if (close !== -1) {
        flush()
        pieces.push({ kind: char === MISSING_OPEN ? 'missing' : 'pending', label: source.slice(index + 1, close) })
        index = close
      }
    } else if (char !== MISSING_CLOSE && char !== PENDING_CLOSE) {
      text += char
    }
  }
  flush()
  return pieces
}
