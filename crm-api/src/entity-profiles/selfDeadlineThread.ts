/** The watchdog thread of `selfDeadline.ts`: waits for the deadline in ms, then ends the whole process. Imports nothing. */

declare const self: Worker;

self.onmessage = (event: MessageEvent<number>) => {
  setTimeout(() => process.kill(process.pid, "SIGKILL"), event.data);
};
