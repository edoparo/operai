/**
 * jsdom has no layout: ProseMirror asks for client rects when it scrolls the caret into view. Tests that drive
 * a RichTextEditor import this once; it gives every node and range an empty layout instead of a TypeError.
 */
const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect
const list = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList

export function stubLayoutForRichText(): void {
  if (typeof Range !== 'undefined') {
    Range.prototype.getClientRects ??= list
    Range.prototype.getBoundingClientRect ??= empty
  }
  if (typeof Element !== 'undefined') {
    Element.prototype.getClientRects ??= list
    Element.prototype.scrollIntoView ??= () => {}
  }
  if (typeof document !== 'undefined') {
    document.elementFromPoint ??= () => null
  }
}
