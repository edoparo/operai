/**
 * The Operai email layout: one frame every template renders into, in the suite's look (operai-ui tokens: the dark ink
 * header, the DM Sans / Syne type, the indigo accent) on a light card, because mail clients render light reliably and
 * invert dark unpredictably.
 *
 * EMAIL-SAFE BY CONSTRUCTION
 * - Tables and inline styles only (Outlook, Gmail strip `<style>` blocks and ignore flex/grid); widths in attributes too.
 * - No external request of any kind: no image, no web font, no tracking pixel. The wordmark is text; DM Sans and
 *   Syne are used when the reader has them and fall back to the system sans. (A web font or a logo URL would make every
 *   opened email call a third party.)
 * - The button is a "bulletproof" table cell, so it stays a button where CSS on `<a>` is ignored.
 *
 * ESCAPING STAYS WITH THE TEMPLATES. Every helper here takes text it ESCAPES itself (`text` arguments), or HTML a
 * helper of this module produced (`Html` arguments). A template never passes caller data as `Html`.
 */

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);

/**
 * HTML produced by this module. An object, not a string: caller text can never be mistaken for markup, because only
 * this module constructs one (`instanceof`), and everything else is escaped.
 */
export class SafeHtml {
  private constructor(readonly html: string) {}
  /** @internal this module only. */
  static of(html: string): SafeHtml {
    return new SafeHtml(html);
  }
}
const safe = (html: string): SafeHtml => SafeHtml.of(html);
const out = (part: string | SafeHtml): string => (part instanceof SafeHtml ? part.html : escapeHtml(part));

/** The operai-ui tokens an email uses (light card on the ink header). Text colours meet WCAG AA on their background. */
export const EMAIL_COLORS = {
  page: "#ececf2", // --paper-head
  ink: "#0d0d14", // --ink: the header band
  inkText: "#ddddf0", // --text on ink
  inkSoft: "#8888aa", // --soft on ink
  accent: "#8b96ff", // --acc-hi: the wordmark's mark, on ink
  card: "#fdfdfb", // --paper
  cardRule: "#d6d6de", // --paper-rule
  text: "#15151d", // --paper-ink
  muted: "#4b4b5f", // --paper-soft
  button: "#4f5ef0", // --acc-solid (white text 4.9:1)
  link: "#4453e0", // --acc-solid-hi on paper
} as const;

const FONT_BODY = "'DM Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_DISPLAY = "'Syne', 'DM Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO = "'DM Mono', SFMono-Regular, Menlo, Consolas, monospace";

export type Tone = "neutral" | "success" | "danger";

/** A thin bar on top of the card and a badge: the outcome at a glance. Badge text is dark on a light tint (AA). */
const TONES: Record<Tone, { bar: string; badgeBg: string; badgeText: string }> = {
  neutral: { bar: "#5b6af7", badgeBg: "#e8eaff", badgeText: "#3340c4" },
  success: { bar: "#2ec27e", badgeBg: "#e1f5ea", badgeText: "#14663f" },
  danger: { bar: "#f55a5a", badgeBg: "#fde7e7", badgeText: "#a12828" },
};

// ─── Blocks ──────────────────────────────────────────────────────────────────

export const heading = (text: string): SafeHtml =>
  safe(
    `<h1 style="margin: 0 0 16px; font-family: ${FONT_DISPLAY}; font-size: 22px; line-height: 1.3; font-weight: 700; color: ${EMAIL_COLORS.text};">${escapeHtml(text)}</h1>`,
  );

/** A paragraph of escaped text, optionally with inline `Html` parts (`strong`, `link`) interleaved. */
export const paragraph = (parts: readonly (string | SafeHtml)[] | string, options: { muted?: boolean; small?: boolean } = {}): SafeHtml => {
  const list = typeof parts === "string" ? [parts] : parts;
  const content = list.map(out).join("");
  const color = options.muted ? EMAIL_COLORS.muted : EMAIL_COLORS.text;
  const size = options.small ? "13px" : "15px";
  return safe(`<p style="margin: 0 0 16px; font-family: ${FONT_BODY}; font-size: ${size}; line-height: 1.6; color: ${color};">${content}</p>`);
};

/** Marks a piece of escaped text as bold inside a `paragraph`. */
export const strong = (text: string): SafeHtml => safe(`<strong style="font-weight: 700;">${escapeHtml(text)}</strong>`);

/** An inline text link. */
export const link = (href: string, text: string): SafeHtml =>
  safe(`<a href="${escapeHtml(href)}" style="color: ${EMAIL_COLORS.link}; text-decoration: underline;">${escapeHtml(text)}</a>`);

/** The call to action: a bulletproof button, then the address in small print for clients that block buttons. */
export const button = (href: string, label: string): SafeHtml => {
  const url = escapeHtml(href);
  return safe(
    [
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 20px;">',
      "<tr>",
      `<td align="center" bgcolor="${EMAIL_COLORS.button}" style="border-radius: 8px; background: ${EMAIL_COLORS.button};">`,
      `<a href="${url}" style="display: inline-block; padding: 12px 22px; font-family: ${FONT_BODY}; font-size: 15px; font-weight: 600; line-height: 1; color: #ffffff; text-decoration: none; border-radius: 8px;">${escapeHtml(label)}</a>`,
      "</td>",
      "</tr>",
      "</table>",
    ].join(""),
  );
};

/** Label/value rows (a batch's reference, a request's total). Values are escaped text or module `Html`. */
export const facts = (rows: readonly (readonly [label: string, value: string | SafeHtml])[]): SafeHtml => {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding: 8px 12px 8px 0; font-family: ${FONT_BODY}; font-size: 13px; color: ${EMAIL_COLORS.muted}; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}</td>` +
        `<td style="padding: 8px 0; font-family: ${FONT_MONO}; font-size: 14px; color: ${EMAIL_COLORS.text}; vertical-align: top;">${out(value)}</td></tr>`,
    )
    .join("");
  return safe(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 20px; border-top: 1px solid ${EMAIL_COLORS.cardRule}; border-bottom: 1px solid ${EMAIL_COLORS.cardRule};">${cells}</table>`,
  );
};

/** Several values in one fact cell, one per line. */
export const lines = (values: readonly string[]): SafeHtml => safe(values.map(escapeHtml).join("<br />"));

export const badge = (text: string, tone: Tone): SafeHtml => {
  const t = TONES[tone];
  return safe(
    `<span style="display: inline-block; margin: 0 0 12px; padding: 3px 10px; border-radius: 999px; background: ${t.badgeBg}; font-family: ${FONT_BODY}; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: ${t.badgeText};">${escapeHtml(text)}</span>`,
  );
};

export const divider = (): SafeHtml => safe(`<hr style="margin: 24px 0; border: 0; border-top: 1px solid ${EMAIL_COLORS.cardRule};" />`);

/** A small language tag above one language's part of a bilingual email. */
export const languageTag = (text: string): SafeHtml =>
  safe(
    `<p style="margin: 0 0 8px; font-family: ${FONT_MONO}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: ${EMAIL_COLORS.muted};">${escapeHtml(text)}</p>`,
  );

// ─── The frame ───────────────────────────────────────────────────────────────

export interface EmailFrame {
  /** `<html lang>`: the email's language (`en` when bilingual, the invitation family names both). */
  readonly lang: "en" | "it";
  /** The subject, used as the document title. */
  readonly title: string;
  /** The inbox preview line (hidden in the body). */
  readonly preheader: string;
  /** The tool that sends it, beside the wordmark ("CRM", "Refund"); none for the suite itself. */
  readonly tool?: string | undefined;
  readonly tone?: Tone;
  readonly body: readonly SafeHtml[];
  /** Footer lines (escaped text or module `Html`), above the fixed brand line. */
  readonly footer: readonly (string | SafeHtml)[];
}

export const TAGLINE = "AI tools built by craftspeople, for craftspeople.";

export function renderFrame(frame: EmailFrame): string {
  const tone = TONES[frame.tone ?? "neutral"];
  const tool = frame.tool
    ? `<td align="right" style="font-family: ${FONT_MONO}; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: ${EMAIL_COLORS.inkSoft};">${escapeHtml(frame.tool)}</td>`
    : "";
  const footer = frame.footer
    .map(
      (line) =>
        `<p style="margin: 0 0 6px; font-family: ${FONT_BODY}; font-size: 12px; line-height: 1.5; color: ${EMAIL_COLORS.muted};">${out(line)}</p>`,
    )
    .join("");

  return [
    "<!DOCTYPE html>",
    `<html lang="${frame.lang}">`,
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light" />',
    '<meta name="supported-color-schemes" content="light" />',
    `<title>${escapeHtml(frame.title)}</title>`,
    "</head>",
    `<body style="margin: 0; padding: 0; background: ${EMAIL_COLORS.page}; -webkit-text-size-adjust: 100%;">`,
    // The preview line an inbox shows under the subject; never displayed in the message.
    `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: ${EMAIL_COLORS.page};">${escapeHtml(frame.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLORS.page}" style="background: ${EMAIL_COLORS.page};">`,
    '<tr><td align="center" style="padding: 32px 16px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px;">',
    // Header band: the wordmark on ink, the tool on the right.
    `<tr><td bgcolor="${EMAIL_COLORS.ink}" style="background: ${EMAIL_COLORS.ink}; border-radius: 12px 12px 0 0; padding: 18px 28px;">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td style="font-family: ${FONT_DISPLAY}; font-size: 20px; font-weight: 800; letter-spacing: -0.01em; color: ${EMAIL_COLORS.inkText};">Operai<span style="color: ${EMAIL_COLORS.accent};">.</span></td>`,
    tool,
    "</tr></table>",
    "</td></tr>",
    // The tone bar, then the card.
    `<tr><td height="4" bgcolor="${tone.bar}" style="background: ${tone.bar}; font-size: 0; line-height: 0;">&nbsp;</td></tr>`,
    `<tr><td bgcolor="${EMAIL_COLORS.card}" style="background: ${EMAIL_COLORS.card}; border: 1px solid ${EMAIL_COLORS.cardRule}; border-top: 0; border-radius: 0 0 12px 12px; padding: 32px 28px 12px;">`,
    ...frame.body.map((block) => block.html),
    "</td></tr>",
    // Footer, outside the card.
    '<tr><td style="padding: 20px 28px 0;">',
    footer,
    `<p style="margin: 12px 0 0; font-family: ${FONT_BODY}; font-size: 12px; line-height: 1.5; color: ${EMAIL_COLORS.muted};">Operai by wellD &middot; ${escapeHtml(TAGLINE)}</p>`,
    "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}
