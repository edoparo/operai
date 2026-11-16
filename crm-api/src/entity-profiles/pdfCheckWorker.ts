/**
 * The child process of `isolatedPdfCheck.ts` (security round 10, ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse,
 * amendment of 2026-11-16): reads ONE uploaded PDF from stdin, runs the check named by argv[2], prints one JSON verdict line on
 * stdout and exits. It imports only the pure checks (pdf-lib, node:zlib): no database, no environment, no storage, no secrets, and
 * it is started with an empty environment. A file that makes it loop or allocate is killed by the parent and never answers.
 *
 *   letterhead  `checkLetterhead` (bounds, pdf-lib load, A4, form graph, embed probe)
 *   bound       `boundPdf` (the decoded-size bound alone: a deal PDF attachment)
 */

import { checkLetterhead } from "./letterhead";
import { boundPdf } from "./pdfBounds";

const mode = process.argv[2];
const bytes = new Uint8Array(await Bun.stdin.arrayBuffer());
let verdict: unknown;
if (mode === "letterhead") verdict = await checkLetterhead(bytes);
else if (mode === "bound") verdict = await boundPdf(bytes);
else {
  console.error("unknown mode");
  process.exit(2);
}
// One line, then out: nothing a file did can keep the process alive.
await Bun.write(Bun.stdout, `${JSON.stringify(verdict)}\n`);
process.exit(0);
