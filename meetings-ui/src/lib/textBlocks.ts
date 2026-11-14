/**
 * The paragraphs and lists inside a plain-text AI body (a summary section, an answer). The model writes plain text
 * (ADR 20261104-ai-output-structured-validated-plain-text); its lists are lines that start with "- ", "• ", "* " or "1. ". This only groups lines into blocks so the
 * UI can render a list as a list: no markup is interpreted, every item stays text.
 */
export type TextBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }

const BULLET = /^\s*[-•*]\s+(.*)$/
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/

export function textBlocks(body: string): TextBlock[] {
  const blocks: TextBlock[] = []
  let paragraph: string[] = []
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
    paragraph = []
  }
  for (const line of body.split(/\r?\n/)) {
    const bullet = BULLET.exec(line)
    const number = bullet ? null : NUMBER.exec(line)
    const item = bullet ?? number
    if (item) {
      endParagraph()
      const ordered = number !== null
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item[1]!)
      else blocks.push({ kind: 'list', ordered, items: [item[1]!] })
    } else if (line.trim() === '') {
      endParagraph()
    } else {
      // A line after a list item that is not an item of its own starts a paragraph: nothing is guessed to belong to it.
      paragraph.push(line)
    }
  }
  endParagraph()
  return blocks
}
