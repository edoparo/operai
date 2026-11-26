/**
 * `@operai/ui/board` — the board (cards in lanes, moved by dragging), in an entry of its own (not `@operai/ui`): it needs
 * `@dnd-kit/core`, which only an app that uses it installs. Such an app adds, next to the main alias (README § Board):
 * the `@operai/ui/board` alias, `@dnd-kit/core` as a dependency (the version this library's devDependencies pin), and
 * `@dnd-kit/core` to `resolve.dedupe` and to tsconfig `paths`.
 */
export { Board, laneCoordinates } from './board/Board'
export type { BoardCopy, BoardLane, BoardProps, BoardStaticCardProps } from './board/Board'
/** For tests in jsdom only: lanes and cards with a layout, so a keyboard drag can move between lanes. */
export { stubLayoutForBoard } from './board/jsdomLayout'
