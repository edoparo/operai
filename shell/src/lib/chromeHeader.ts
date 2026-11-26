/**
 * The shell's header height as the CSS custom property `--chrome-header` on the document, so a library drawer's
 * header (operai-ui `.drawer-header`) is as tall as it and their bottom rules line up.
 */
export const CHROME_HEADER_PROPERTY = '--chrome-header'

export function publishChromeHeaderHeight(height: number, root: HTMLElement = document.documentElement): void {
  if (height > 0) root.style.setProperty(CHROME_HEADER_PROPERTY, `${height}px`)
}
