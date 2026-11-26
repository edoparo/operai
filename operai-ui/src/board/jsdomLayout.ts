/**
 * For tests in jsdom only. jsdom lays nothing out, so a keyboard drag on a `Board` has no lanes to jump to: this gives
 * every lane a box side by side (300 px apart) and every card a small box inside its lane, the drag overlay sitting on
 * the focused card as in a browser. Returns the restore function (or let `vi.restoreAllMocks` undo it).
 */
export function stubLayoutForBoard(): () => void {
  const box = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    // The overlay renders outside the lanes; a browser places it over the dragged card, the focused element.
    const anchor = this.closest('.board-lane') ? this : document.activeElement
    const lane = anchor?.closest('.board-lane')
    if (!lane) return box(0, 0, 0, 0)
    const index = [...(lane.parentElement?.children ?? [])].indexOf(lane)
    return anchor === lane ? box(index * 300, 0, 280, 600) : box(index * 300 + 10, 100, 28, 28)
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}
