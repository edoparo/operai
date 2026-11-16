/**
 * What the offer PDF can print (specs/20261115-crm-offer-wizard AC-3.2, DD-22): WinAnsi (the standard
 * Helvetica fonts, as `winAnsi` in the renderer) plus U+25A1 "□", which the renderer draws as a box;
 * everything else is "?". The wizard's preview maps its text through here BEFORE drawing it, so what
 * the person reads is what the PDF prints.
 *
 * Pure and deterministic — `normalize("NFC")` is the only built-in used, no `Intl`, no locale.
 * The marker characters (U+E000…U+E003) and the hand-edit token brackets (U+27E6/U+27E7) are not
 * printable either: map an answer BEFORE wrapping it in a marker run, never the finished markup. The same goes for the
 * reference-token brackets (U+27EA/U+27EB, DD-52): they print as "?" here, because a hand-edited body is split on the
 * exact reference token BEFORE any piece reaches this function, so only a stray bracket ever gets here.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.printable).
 */
// shared-copy:begin offerEngine.printable

const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** The ballot box the seeds use for an `option` line; drawn, not typeset. */
export const BALLOT_BOX = "□";

export function printable(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (char === "\n" || char === BALLOT_BOX || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char)) {
      out += char;
    } else if (char === "\t") {
      out += " ";
    } else {
      out += "?";
    }
  }
  return out;
}
// shared-copy:end offerEngine.printable
