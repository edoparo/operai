/**
 * The document's numbering (specs/20261115-crm-offer-wizard AC-9.5, AC-3.2; DD-29), computed once so the preview
 * and the PDF print the same: section and sub-heading numbers, text-annex headings, the letters of the
 * effort-detail annex and of the deal PDFs (skipping every designation a text annex already uses), the
 * "Allegati:" list and the index. One numbering for a wizard offer and a legacy (018) snapshot alike — the
 * renderer reads this and computes nothing of its own.
 *
 *   sections      "1. HEADING", sub-headings "1.1 TEXT" depth-first in markup order, restarting in each section;
 *                 an annex's sections are numbered the same way within the annex
 *   annexes       text annexes in template order ("ALLEGATO SLA – TITLE"), then the effort-detail annex, then the
 *                 deal PDFs; letters A, B, … AA, AB, … taken in that order, skipping a designation in use
 *   index         only when the effort-detail annex prints (018 D-8): the sections, the text annexes, the annex
 *   annexList     one line per annex, "Allegato A - title" (a hyphen, as 018 draws it)
 *
 * Upper-casing is `toUpperCase` (never a locale variant) and the result goes through `printable`, so the
 * heading is what the PDF draws. Pure; no `Intl`, no clock.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.numbering).
 */
// shared-copy:begin offerEngine.numbering
import { parseMarkup, type Block } from "./markup";
import { printable } from "./printable";
import { words, type DocLanguage } from "./words";

export interface NumberingSection {
  key: string;
  /** Plain text, as written. */
  heading: string;
  /** 018 markup: its `###` lines are the sub-headings. */
  body: string;
}

/** The printed structure only: what the resolver (or a legacy snapshot) says prints. */
export interface NumberingInput {
  language: DocLanguage;
  sections: readonly NumberingSection[];
  /** Text annexes in template order. */
  annexes: readonly { designation: string; title: string; sections: readonly NumberingSection[] }[];
  /** The effort-detail annex (018 Annex A) prints. */
  effortAnnex: boolean;
  /** The deal PDFs appended, in order. */
  attachmentNames: readonly string[];
}

export interface NumberedSection {
  key: string;
  /** "2" */
  number: string;
  /** "2. OBJECT" */
  heading: string;
  /** "2.1 TEXT", in markup order. */
  subheadings: string[];
}

export interface NumberedOffer {
  sections: NumberedSection[];
  /** `heading` is "ALLEGATO A – TITLE". */
  annexes: { designation: string; heading: string; sections: NumberedSection[] }[];
  /** The next free letter after the text annexes' designations; null without the effort-detail annex. */
  effortAnnexLetter: string | null;
  attachmentLetters: string[];
  /** The lines under "Allegati:", in order. */
  annexList: string[];
  /** Entries `label` + `target` (a section key, `annex:<designation>` or `annex:effort`); null without the effort-detail annex. */
  index: { label: string; target: string }[] | null;
}

const upper = (text: string): string => printable(text.toUpperCase());

/** A, B, … Z, AA, AB, … */
function letterOf(index: number): string {
  const last = String.fromCharCode(65 + (index % 26));
  return index < 26 ? last : letterOf(Math.floor(index / 26) - 1) + last;
}

function headingsOf(blocks: readonly Block[], found: string[]): string[] {
  for (const block of blocks) {
    if (block.type === "heading") found.push(block.text);
    else if (block.type === "list") for (const item of block.items) headingsOf(item.children, found);
  }
  return found;
}

function numberSection(section: NumberingSection, number: number): NumberedSection {
  return {
    key: section.key,
    number: String(number),
    heading: upper(`${number}. ${section.heading}`),
    subheadings: headingsOf(parseMarkup(section.body), []).map((text, index) => upper(`${number}.${index + 1} ${text}`)),
  };
}

export function numberOffer(input: NumberingInput): NumberedOffer {
  const t = words(input.language);
  const sections = input.sections.map((section, index) => numberSection(section, index + 1));
  const annexes = input.annexes.map((annex) => ({
    designation: annex.designation,
    heading: upper(`${t.annex} ${annex.designation}${annex.title === "" ? "" : ` – ${annex.title}`}`),
    sections: annex.sections.map((section, index) => numberSection(section, index + 1)),
  }));

  const used = new Set(input.annexes.map((annex) => annex.designation));
  let cursor = 0;
  const nextLetter = (): string => {
    for (;;) {
      const letter = letterOf(cursor++);
      if (!used.has(letter)) {
        used.add(letter);
        return letter;
      }
    }
  };
  const effortAnnexLetter = input.effortAnnex ? nextLetter() : null;
  const attachmentLetters = input.attachmentNames.map(() => nextLetter());

  const annexList = [
    ...input.annexes.map((annex) => printable(`${t.annex} ${annex.designation}${annex.title === "" ? "" : ` - ${annex.title}`}`)),
    ...(effortAnnexLetter ? [`${t.annex} ${effortAnnexLetter} - ${t.annexTitle}`] : []),
    ...input.attachmentNames.map((name, index) => printable(`${t.annex} ${attachmentLetters[index]} - ${name}`)),
  ];

  const index = effortAnnexLetter
    ? [
        ...sections.map((section) => ({ label: section.heading, target: section.key })),
        ...annexes.map((annex) => ({ label: annex.heading, target: `annex:${annex.designation}` })),
        { label: t.annexHeading(effortAnnexLetter), target: "annex:effort" },
      ]
    : null;

  return { sections, annexes, effortAnnexLetter, attachmentLetters, annexList, index };
}
// shared-copy:end offerEngine.numbering
