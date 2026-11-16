/**
 * The text a section's hand edit starts from (specs/20261115-crm-offer-wizard AC-5.1, AC-5.2; DD-30), and the
 * check the dialog runs before it saves.
 *
 * `resolveSectionForEdit` is the wizard's own text for one section — answers escaped exactly as in the document —
 * with every value still missing, and the offer reference not yet assigned, written as the visible token
 * "⟦Label⟧" (U+27E6/U+27E7: nothing else in the suite produces them and they are not printable, so a token can
 * never pass for document text). The one exception is the offer reference, which has no value until generation: in a
 * body it is written as the reference token (DD-52, `REFERENCE_TOKEN`), not listed in `tokens`, and filled when the
 * offer is generated. A section already edited by hand comes back as stored. `findTokens` finds the
 * brackets in a text: the dialog refuses to save while it finds any, whether or not the field has been filled
 * since — a hand-edited text no longer follows the answers, so a token left in it would print as it stands.
 *
 * Pure; no I/O, no clock.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.edit).
 */
// shared-copy:begin offerEngine.edit
import type { WizardAnswers, WizardContext } from "./answers";
import { REFERENCE_TOKEN } from "./markup";
import { resolveOffer, resolveSectionText, type SectionText } from "./resolve";
import type { TemplateAst } from "./syntax";

/**
 * One section as the hand-edit dialog opens it: `heading` plain text, `body` offer markup, `tokens` what the text
 * still lacks (each field once, in text order; the reference only when it sits in the heading). Null for a key the template does not
 * have, and for a section that does not print (its block is off).
 */
export function resolveSectionForEdit(ast: TemplateAst, answers: WizardAnswers, context: WizardContext, sectionKey: string): SectionText | null {
  const edit = answers.handEdits[sectionKey];
  if (edit) {
    const offer = resolveOffer(ast, answers, context);
    const printed = [...offer.sections, ...offer.annexes.flatMap((annex) => annex.sections)].some((section) => section.key === sectionKey);
    return printed ? { heading: edit.heading, body: edit.body, tokens: [] } : null;
  }
  return resolveSectionText(ast, answers, context, sectionKey);
}

/**
 * Every "⟦…⟧" in a text with its place (`start` inclusive, `end` exclusive, in string indices) and label (the
 * template's, markup escapes removed), and every bracket that has no partner — a lone "⟦" or "⟧" — as a one-character
 * entry with an empty label. In a body (the default) an exact reference token is skipped — never an entry, the same
 * left-to-right, non-overlapping match as `resolveOffer` and `checkAnswers` — and every other "⟪" or "⟫" is a
 * one-character entry with an empty label; in a heading every "⟪" and "⟫" is, since a heading never takes the token
 * (DD-52). In text order; linear in the text apart from the final sort.
 */
export function findTokens(text: string, where: "body" | "heading" = "body"): { start: number; end: number; label: string }[] {
  const found: { start: number; end: number; label: string }[] = [];
  let open = -1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (where === "body" && text.startsWith(REFERENCE_TOKEN, index)) {
      index += REFERENCE_TOKEN.length - 1;
    } else if (char === "⟪" || char === "⟫") {
      found.push({ start: index, end: index + 1, label: "" });
    } else if (char === "⟦") {
      if (open !== -1) found.push({ start: open, end: open + 1, label: "" });
      open = index;
    } else if (char === "⟧") {
      if (open === -1) {
        found.push({ start: index, end: index + 1, label: "" });
      } else {
        found.push({ start: open, end: index + 1, label: text.slice(open + 1, index).replace(/\\([\\[*_|{])/g, "$1") });
        open = -1;
      }
    }
  }
  if (open !== -1) found.push({ start: open, end: open + 1, label: "" });
  // a pair is recorded when it closes, after any bracket inside it
  return found.sort((a, b) => a.start - b.start);
}
// shared-copy:end offerEngine.edit
