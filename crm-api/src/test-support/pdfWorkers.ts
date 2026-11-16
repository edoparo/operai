/**
 * A stand-in for `entity-profiles/pdfCheckWorker.ts`, run as a child process by `isolatedPdfCheck.test.ts`: what a check that a static
 * bound missed does to its process. The behaviour is the text it is given on stdin: `spin` loops forever (one synchronous task, as
 * the 95 s probe of security M-12 did), `alloc` grows its memory until killed, `chatty` prints without end, `crash` dies, `garbage`
 * answers with something that is not a verdict, `ok` answers like the real worker.
 */

import { armSelfDeadline } from "../entity-profiles/selfDeadline";

armSelfDeadline(Number(process.argv[3])); // like the real worker: a child that loops still ends at its own deadline
const what = (await Bun.stdin.text()).trim();
const hold: Uint8Array[] = [];
if (what === "spin") {
  for (;;) Math.sqrt(Math.random());
} else if (what === "alloc") {
  for (;;) {
    const block = new Uint8Array(32 * 1024 * 1024);
    block.fill(1); // touched, so it is resident
    hold.push(block);
    await Bun.sleep(5);
  }
} else if (what === "chatty") {
  for (;;) process.stdout.write("x".repeat(65_536));
} else if (what === "crash") {
  process.exit(3);
} else if (what === "envsize") {
  // How many environment variables the child holds (security L-12): a bound verdict that carries the count, which the parent passes through.
  const verdict = { ok: true, decodedBytes: 0, nonImageBytes: 0, objects: 0, streams: 0, imagePixels: 0, envSize: Object.keys(process.env).length };
  await Bun.write(Bun.stdout, `${JSON.stringify(verdict)}\n`);
} else if (what === "garbage") {
  await Bun.write(Bun.stdout, "not json\n");
} else {
  await Bun.write(Bun.stdout, `${JSON.stringify(process.argv[2] === "bound" ? { ok: true, decodedBytes: 0, nonImageBytes: 0, objects: 0, streams: 0, imagePixels: 0 } : { ok: true })}\n`);
}
process.exit(0);
