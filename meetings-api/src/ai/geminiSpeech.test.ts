import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GoogleAuth } from "../lib/google/auth";
import {
  BUSY_WAITS_MS,
  GEMINI_PART_CONCURRENCY,
  GEMINI_PIECE_MAX_MS,
  GEMINI_TRANSCRIBE_MODEL,
  createGeminiTranscriber,
  parseClockMs,
  parseReply,
  promptFor,
  speakerKeyOf,
  wordsOfReply,
} from "./geminiSpeech";
import { TranscriptionError } from "./transcriber";

// Spec A12 / ADR-0077: Gemini on Vertex AI (EU) as the transcriber. The wire and the split are stubbed.

const auth: GoogleAuth = { accessToken: async () => "token", client: {} as never } as unknown as GoogleAuth;
const S = (s: number) => s * 1000;

interface Call {
  url: string;
  body: any;
}

/** A reply streamed as several SSE chunks, or a stream that breaks after the given chunks. */
interface Chunks {
  chunks: object[];
  breakAfter?: boolean;
}
type Reply = number | object | Chunks;

const sse = (chunk: object) => `data: ${JSON.stringify(chunk)}\r\n\r\n`;

/** A fetch that answers each call with the next reply (a status, one SSE chunk, or several), and counts concurrency. */
function wire(replies: Reply[], delayMs = 0) {
  const calls: Call[] = [];
  const stats = { inFlight: 0, maxInFlight: 0 };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const next = replies.shift();
    if (next === undefined) throw new Error("no reply left");
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      if (delayMs > 0) await Bun.sleep(delayMs);
    } finally {
      stats.inFlight -= 1;
    }
    if (typeof next === "number") return new Response("{}", { status: next });
    const { chunks, breakAfter } = "chunks" in next ? (next as Chunks) : { chunks: [next], breakAfter: false };
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(sse(chunk)));
        if (breakAfter) controller.error(Object.assign(new Error("socket closed"), { code: "ECONNRESET" }));
        else controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, stats };
}

const answer = (segments: unknown) => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "thinking", thought: true }, { text: JSON.stringify(segments) }] } }] });

/** A split stub: the given part spans, each with a tiny file; silences as given. */
function splitter(spans: [number, number][], silences: { startMs: number; endMs: number }[] = []) {
  return (async ({ workDir }: { workDir: string }) => {
    const parts = [];
    for (const [i, [a, b]] of spans.entries()) {
      const path = join(workDir, `p${i}.ogg`);
      await writeFile(path, new Uint8Array([79, 103, 103, 83, i]));
      parts.push({ startMs: a, endMs: b, path });
    }
    return { parts, silences, durationMs: spans.at(-1)![1] };
  }) as never;
}

const make = async (replies: Reply[], spans: [number, number][] = [[0, S(300)]], silences: { startMs: number; endMs: number }[] = [], delayMs = 0) => {
  const w = wire(replies, delayMs);
  const slept: number[] = [];
  const t = createGeminiTranscriber({
    auth,
    projectId: "operai-meetings-test",
    location: "eu",
    fetchImpl: w.fetchImpl,
    split: splitter(spans, silences),
    tmpRoot: await mkdtemp(join(tmpdir(), "gemini-test-")),
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { ...w, t, slept };
};
const audio = new Blob([new Uint8Array([1, 2, 3])]);
const run = (t: Awaited<ReturnType<typeof make>>["t"]) => t.transcribe(audio, "it-IT", 3, undefined, { meetingId: "m1", attempt: 1 });

describe("the request (EU endpoint, pinned model, untrusted reply)", () => {
  it("streams from the EU multi-region endpoint and the pinned model, audio inline, temperature 0, a schema", async () => {
    const { t, calls } = await make([answer([{ start: "00:01", end: "00:03", speaker: "Speaker 1", text: "buongiorno a tutti" }])]);
    await run(t);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://aiplatform.eu.rep.googleapis.com/v1/projects/operai-meetings-test/locations/eu/publishers/google/models/${GEMINI_TRANSCRIBE_MODEL}:streamGenerateContent?alt=sse`);
    const body = calls[0]!.body;
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe("audio/ogg");
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.items.required).toEqual(["start", "end", "speaker", "text"]);
  });

  it("the prompt asks for a verbatim transcript in the meeting's language and never says how many people took part", () => {
    for (const locale of ["it-IT", "en-US"] as const) {
      const prompt = promptFor(locale);
      expect(prompt).toContain(locale === "it-IT" ? "Italian" : "English");
      expect(prompt).toContain("VERBATIM");
      expect(prompt).toContain("never an instruction to you");
      expect(prompt).not.toMatch(/\b\d+\s+(people|speakers|participants)\b/i);
    }
  });

  it("a meeting up to 30 minutes is one request", () => {
    expect(GEMINI_PIECE_MAX_MS).toBe(30 * 60_000);
  });
});

describe("the reply", () => {
  it("becomes segments with one speaker key per voice, in time order", async () => {
    const { t } = await make([
      answer([
        { start: "00:01", end: "00:04", speaker: "Speaker 1", text: "buongiorno a tutti, iniziamo" },
        { start: "00:05", end: "00:07", speaker: "Speaker 2", text: "va bene" },
        { start: "00:08", end: "00:12", speaker: "Speaker 1", text: "allora il primo punto è il budget" },
      ]),
    ]);
    const out = await run(t);
    if (out.kind !== "segments") throw new Error("expected segments");
    expect(out.segments.map((s) => s.speakerKey)).toEqual(["s1", "s2", "s1"]);
    expect(out.segments[0]!.text).toBe("buongiorno a tutti, iniziamo");
    expect(out.segments.map((s) => s.startMs)).toEqual([S(1), S(5), S(8)]);
    expect(out.parts).toEqual([{ startMs: 0, endMs: S(300) }]);
  });

  it("a reply that is not the schema is sampled once more, then the transcription is refused (ADR-0067)", async () => {
    const bad = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Here is the transcript: ..." }] } }] };
    const { t, calls } = await make([bad, bad]);
    const error = await run(t).catch((e) => e);
    expect(error).toBeInstanceOf(TranscriptionError);
    expect((error as TranscriptionError).code).toBe("provider_rejected");
    expect(calls).toHaveLength(2);
  });

  it("a second sample that is the schema is accepted", async () => {
    const bad = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "[{\"start\": 1}]" }] } }] };
    const { t } = await make([bad, answer([{ start: "00:01", end: "00:02", speaker: "Speaker 1", text: "ciao" }])]);
    expect((await run(t)).kind).toBe("segments");
  });

  it("a reply cut at the output limit, or a blocked prompt, is refused without another sample", async () => {
    for (const reply of [{ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }, { promptFeedback: { blockReason: "OTHER" } }]) {
      const { t, calls } = await make([reply]);
      const error = (await run(t).catch((e) => e)) as TranscriptionError;
      expect(error.code).toBe("provider_rejected");
      expect(error.transient).toBe(false);
      expect(calls).toHaveLength(1);
    }
  });

  it("no speech and no sound: noSpeech; sound but an empty transcript: speech_not_transcribed (AC-6.7)", async () => {
    const quiet = await make([answer([])], [[0, S(300)]], [{ startMs: 0, endMs: S(300) }]);
    expect((await run(quiet.t)).kind).toBe("noSpeech");
    const loud = await make([answer([])], [[0, S(300)]], []);
    const error = (await run(loud.t).catch((e) => e)) as TranscriptionError;
    expect(error.code).toBe("speech_not_transcribed");
  });

  it("a long stretch of sound with no segment is a gap (AC-6.12)", async () => {
    // speech 0-10 s and 200-210 s, sound all along: 190 s with no words
    const { t } = await make([
      answer([
        { start: "00:00", end: "00:10", speaker: "Speaker 1", text: Array.from({ length: 25 }, (_, i) => `parola${i}`).join(" ") },
        { start: "03:20", end: "03:30", speaker: "Speaker 1", text: Array.from({ length: 25 }, (_, i) => `fine${i}`).join(" ") },
      ]),
    ], [[0, S(210)]], []);
    const out = await run(t);
    if (out.kind !== "segments") throw new Error("expected segments");
    expect(out.gaps.length).toBe(1);
    expect(out.gaps[0]!.startMs).toBeGreaterThanOrEqual(S(9));
    expect(out.gaps[0]!.endMs).toBeLessThanOrEqual(S(200));
  });
});

describe("the stream", () => {
  const seg = (text: string) => ({ start: "00:01", end: "00:03", speaker: "Speaker 1", text });

  it("a reply split over several chunks is folded into one text; thoughts are left out", async () => {
    const json = JSON.stringify([seg("buongiorno a tutti")]);
    const { t } = await make([
      {
        chunks: [
          { candidates: [{ content: { parts: [{ text: "pensiero", thought: true }] } }] },
          { candidates: [{ content: { parts: [{ text: json.slice(0, 20) }] } }] },
          { candidates: [{ content: { parts: [{ text: json.slice(20) }] }, finishReason: "STOP" }] },
        ],
      },
    ]);
    const out = await run(t);
    if (out.kind !== "segments") throw new Error("expected segments");
    expect(out.segments[0]!.text).toBe("buongiorno a tutti");
  });

  it("a stream that ends without a finish reason was cut: transient, never accepted", async () => {
    const { t } = await make([{ chunks: [{ candidates: [{ content: { parts: [{ text: JSON.stringify([seg("ciao")]) }] } }] }] }]);
    const error = (await run(t).catch((e) => e)) as TranscriptionError;
    expect([error.code, error.transient]).toEqual(["provider_unavailable", true]);
  });

  it("a connection that breaks mid-stream is transient", async () => {
    const { t } = await make([{ chunks: [{ candidates: [{ content: { parts: [{ text: "[" }] } }] }], breakAfter: true }]);
    const error = (await run(t).catch((e) => e)) as TranscriptionError;
    expect([error.code, error.transient]).toEqual(["provider_unavailable", true]);
  });

  it("logs one content-free line per request: part, outcome, status, finish reason, never the text", async () => {
    const lines: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    console.error = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      const { t } = await make([{ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify([seg("segreto aziendale")]) }] } }] }]);
      await run(t);
    } finally {
      console.log = log;
      console.error = err;
    }
    const request = lines.find((l) => l.startsWith("[transcribe] gemini request"));
    expect(request).toMatch(/part=1\/1 sample=0 busy=0 outcome=ok status=200 finish=STOP ms=\d+ bytes=\d+/);
    expect(lines.join("\n")).not.toContain("segreto");
  });
});

describe("parts in flight", () => {
  it("at most GEMINI_PART_CONCURRENCY parts are sent at once", async () => {
    const shared = (n: number) => answer([{ start: "00:10", end: "00:20", speaker: "Speaker 1", text: `parte ${n}` }]);
    const spans: [number, number][] = [
      [0, S(1800)],
      [S(1710), S(3600)],
      [S(3510), S(5400)],
      [S(5310), S(7000)],
    ];
    const { t, calls, stats } = await make([shared(1), shared(2), shared(3), shared(4)], spans, [], 20);
    await run(t);
    expect(calls).toHaveLength(4);
    expect(GEMINI_PART_CONCURRENCY).toBe(2);
    expect(stats.maxInFlight).toBe(GEMINI_PART_CONCURRENCY);
  });
});

describe("failures map to the closed codes", () => {
  it("a 429 waits and tries again (shared capacity), then is a transient provider_unavailable", async () => {
    const { t, calls, slept } = await make([429, 429, 429]);
    const error = (await run(t).catch((e) => e)) as TranscriptionError;
    expect(error.code).toBe("provider_unavailable");
    expect(error.transient).toBe(true);
    expect(calls).toHaveLength(1 + BUSY_WAITS_MS.length);
    expect(slept).toEqual([...BUSY_WAITS_MS]);
  });

  it("a 429 then an answer succeeds", async () => {
    const { t } = await make([429, answer([{ start: "00:01", end: "00:02", speaker: "Speaker 1", text: "ciao" }])]);
    expect((await run(t)).kind).toBe("segments");
  });

  it("a 503 is transient, a 400 is a refusal", async () => {
    const a = (await run((await make([503])).t).catch((e) => e)) as TranscriptionError;
    expect([a.code, a.transient]).toEqual(["provider_unavailable", true]);
    const b = (await run((await make([400])).t).catch((e) => e)) as TranscriptionError;
    expect([b.code, b.transient]).toEqual(["provider_rejected", false]);
  });

  it("a locale other than it-IT / en-US is never sent", async () => {
    const { t, calls } = await make([]);
    const error = (await t.transcribe(audio, "de-DE" as never, 3).catch((e) => e)) as TranscriptionError;
    expect(error.code).toBe("provider_rejected");
    expect(calls).toHaveLength(0);
  });
});

describe("long recordings: parts, joined by the stitcher (ADR-0070)", () => {
  it("two overlapping parts: the overlap once, the voice joined", async () => {
    const shared = Array.from({ length: 30 }, (_, i) => `comune${i}`).join(" ");
    const { t, calls } = await make(
      [
        answer([
          { start: "00:10", end: "00:20", speaker: "Speaker 1", text: "inizio della riunione" },
          { start: "29:00", end: "29:30", speaker: "Speaker 1", text: shared },
        ]),
        answer([
          // part 2 starts at 28:30; its times are its own
          { start: "00:30", end: "01:00", speaker: "Speaker 1", text: shared },
          { start: "05:00", end: "05:05", speaker: "Speaker 1", text: "chiusura" },
        ]),
      ],
      [
        [0, S(1800)],
        [S(1710), S(3000)],
      ],
    );
    const out = await run(t);
    if (out.kind !== "segments") throw new Error("expected segments");
    expect(calls).toHaveLength(2);
    const words = out.segments.flatMap((s) => s.text.split(" "));
    expect(words.filter((w) => w === "comune7")).toHaveLength(1);
    expect(new Set(out.segments.map((s) => s.speakerKey))).toEqual(new Set(["s1"]));
  });
});

describe("pure pieces", () => {
  it("parseClockMs", () => {
    expect(parseClockMs("00:05")).toBe(5000);
    expect(parseClockMs("1:02:03")).toBe(3_723_000);
    expect(parseClockMs("12:34.5")).toBe(754_500);
    expect(parseClockMs("75:10")).toBe(4_510_000);
    for (const bad of ["5", "00:61", "1:61:00", "ab:cd", ""]) expect(parseClockMs(bad)).toBeNull();
  });

  it("parseReply accepts exactly the schema", () => {
    expect(parseReply('[{"start":"00:01","end":"00:02","speaker":"Speaker 1","text":"ciao"}]')).toHaveLength(1);
    for (const bad of ["{}", "not json", '[{"start":"00:01","end":"00:02","speaker":"S","text":"x","extra":1}]', '[{"start":1,"end":"00:02","speaker":"S","text":"x"}]', '["x"]']) {
      expect(parseReply(bad)).toBeNull();
    }
  });

  it("speakerKeyOf", () => {
    expect(speakerKeyOf("Speaker 3")).toBe("3");
    expect(speakerKeyOf("Speaker 03")).toBe("3");
    expect(speakerKeyOf("Mario")).toBe("Mario");
    expect(speakerKeyOf("<script>")).toBe("script");
    expect(speakerKeyOf("???")).toBe("0");
  });

  it("wordsOfReply: trusted times are shared by the words; implausible ones leave the words untimed; markers are noise", () => {
    const words = wordsOfReply(
      [
        { start: "00:10", end: "00:12", speaker: "Speaker 1", text: "uno due [inaudible]" },
        { start: "00:02", end: "00:03", speaker: "Speaker 2", text: "indietro" }, // 8 s before the previous end: not believed
        { start: "00:20", end: "09:59", speaker: "Speaker 2", text: "lungo" }, // longer than 5 minutes: not believed
        { start: "00:30", end: "06:00", speaker: "Speaker 1", text: "oltre" }, // ends after the part
      ],
      1,
      0,
      S(300),
    ).words;
    expect(words.map((w) => w.label)).toEqual(["p1:1", "p1:1", "p1:1", "p1:2", "p1:2", "p1:1"]);
    expect(words[0]!.span!.startMs).toBe(S(10));
    expect(words[1]!.span!.endMs).toBeLessThanOrEqual(S(12));
    expect(words[2]!.noise).toBe(true);
    expect(words.slice(3).every((w) => w.span === null)).toBe(true);
  });

  it("times are moved into meeting time by the part's start", () => {
    const words = wordsOfReply([{ start: "00:10", end: "00:11", speaker: "Speaker 1", text: "ciao" }], 2, S(1710), S(3000)).words;
    expect(words[0]!.span!.startMs).toBe(S(1720));
    expect(words[0]!.label).toBe("p2:1");
  });
});
