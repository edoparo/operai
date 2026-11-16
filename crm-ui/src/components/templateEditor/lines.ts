/**
 * Line arithmetic of the template text box (specs/20261115-crm-offer-wizard T52; AC-8.3). The parser numbers lines
 * from 1 and a line ends at `\n`, so the editor reads positions the same way: "Line 12, column 4" and a problem's
 * `line` mean the same line, and selecting a problem selects exactly the text the parser read.
 */

/** The 1-based line and column of a caret index. */
export function caretPosition(text: string, index: number): { line: number; col: number } {
  const at = Math.max(0, Math.min(index, text.length))
  const before = text.slice(0, at)
  const lastBreak = before.lastIndexOf('\n')
  let line = 1
  for (let found = before.indexOf('\n'); found !== -1; found = before.indexOf('\n', found + 1)) line += 1
  // the first column follows the line break (or the start of the text)
  return { line, col: at - lastBreak }
}

/** The index range of a 1-based line, without its line break; a line past the end gives the end of the text. */
export function lineRange(text: string, line: number): [number, number] {
  let start = 0
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', start)
    if (next === -1) return [text.length, text.length]
    start = next + 1
  }
  const end = text.indexOf('\n', start)
  return [start, end === -1 ? text.length : end]
}

/**
 * Selects `[start, end)` in the box and scrolls it to the middle of the window. A browser does not reliably scroll
 * a programmatic selection into view, and the text wraps, so a line's height is not a line count: the box is
 * measured instead, by letting it hold only the text up to the end of the range for a moment.
 */
export function revealRange(box: HTMLTextAreaElement, start: number, end: number): void {
  const full = box.value
  box.value = full.slice(0, end)
  const bottom = box.scrollHeight
  box.value = full
  box.setSelectionRange(start, end)
  box.scrollTop = Math.max(0, bottom - box.clientHeight / 2)
}
