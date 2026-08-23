// A local waveform editor for sentence boundaries. Not part of the app: it starts a
// throwaway server on localhost, opens a page, and writes the corrections back to
// <lessonId>.timings.edits.json. Ctrl-C when done.
//
// It exists because the model's character alignment drifts against the audio it
// describes — up to 0.7s late in a long lesson — so the boundaries need an ear and a
// pair of eyes, not a better guess.
import fs from "fs";
import path from "path";
import http from "http";
import { spawn, spawnSync } from "child_process";
import { LessonSchema, TimingEditsSchema, AudioTimingsSchema } from "../src/lib/content/schema";
import type { Lesson, Sentence } from "../src/lib/content/schema";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const AUDIO_DIR_NAME = "audio-elevenlabs";
const DEFAULT_PORT = 4321;
const DEFAULT_NOISE = "-30dB";
const DEFAULT_SILENCE_DURATION = "0.12";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export interface Silence {
  start: number;
  end: number;
}

function fail(message: string): never {
  console.error(red(message));
  process.exit(1);
}

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i !== -1 ? (argv[i + 1] ?? null) : null;
}

/**
 * ffmpeg reports silences on stderr as `silence_start: 12.34` / `silence_end: 12.9`.
 * A silence still open at the end of the file has no silence_end line, so it is closed
 * at the file duration by the caller.
 */
export function parseSilences(stderr: string, duration: number): Silence[] {
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split("\n")) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      open = Math.max(0, Number.parseFloat(start[1]));
      continue;
    }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (end && open !== null) {
      silences.push({ start: open, end: Number.parseFloat(end[1]) });
      open = null;
    }
  }
  if (open !== null) silences.push({ start: open, end: duration });
  return silences;
}

function requireFfmpeg(): void {
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    fail("ffmpeg is not on PATH; it is needed for silence detection. Install with: brew install ffmpeg");
  }
}

function probeDuration(audioPath: string): number {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath],
    { encoding: "utf-8" }
  );
  const duration = Number.parseFloat((probe.stdout ?? "").trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    fail(`ffprobe could not read a duration from ${path.basename(audioPath)}`);
  }
  return duration;
}

function detectSilences(audioPath: string, noise: string, minDuration: string, duration: number): Silence[] {
  const result = spawnSync(
    "ffmpeg",
    ["-i", audioPath, "-af", `silencedetect=noise=${noise}:d=${minDuration}`, "-f", "null", "-"],
    { encoding: "utf-8" }
  );
  return parseSilences(result.stderr ?? "", duration);
}

function lessonSentences(lesson: Lesson): Sentence[] {
  return lesson.sections.flatMap((section) => section.sentences);
}

function readJson<T>(filePath: string, schema: { parse: (v: unknown) => T }, label: string): T {
  if (!fs.existsSync(filePath)) fail(`${label} not found at ${filePath}`);
  return schema.parse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
}

function main() {
  const argv = process.argv.slice(2);
  const lessonId = flag(argv, "--lesson");
  if (!lessonId) {
    fail(
      "usage: npm run timings -- --lesson <lessonId>\n" +
        `  [--port ${DEFAULT_PORT}] [--noise ${DEFAULT_NOISE}] [--silence-duration ${DEFAULT_SILENCE_DURATION}] [--no-open]`
    );
  }

  requireFfmpeg();

  const lang = lessonId.split("-")[0];
  const audioDir = path.join(CONTENT_ROOT, lang, AUDIO_DIR_NAME);
  const lesson = readJson(
    path.join(CONTENT_ROOT, lang, "lessons", `${lessonId}.json`),
    LessonSchema,
    `lesson ${lessonId}`
  );
  const timingsPath = path.join(audioDir, `${lessonId}.timings.json`);
  const timings = readJson(timingsPath, AudioTimingsSchema, `timings for ${lessonId}`);
  const editsPath = path.join(audioDir, `${lessonId}.timings.edits.json`);
  const edits = fs.existsSync(editsPath)
    ? readJson(editsPath, TimingEditsSchema, `edits for ${lessonId}`)
    : { sentences: {} };

  const audioPath = path.join(audioDir, timings.audio);
  if (!fs.existsSync(audioPath)) fail(`audio not found at ${audioPath}`);

  const port = Number.parseInt(flag(argv, "--port") ?? String(DEFAULT_PORT), 10);
  const noise = flag(argv, "--noise") ?? DEFAULT_NOISE;
  const silenceDuration = flag(argv, "--silence-duration") ?? DEFAULT_SILENCE_DURATION;

  const duration = probeDuration(audioPath);
  const silences = detectSilences(audioPath, noise, silenceDuration, duration);

  const sentences = lessonSentences(lesson)
    .filter((sentence) => timings.sentences[sentence.id])
    .map((sentence) => {
      const generated = timings.sentences[sentence.id];
      const edited = edits.sentences[sentence.id];
      return {
        id: sentence.id,
        speaker: sentence.speaker ?? "",
        target: sentence.target,
        start: (edited ?? generated).start,
        end: (edited ?? generated).end,
        generatedStart: generated.start,
        generatedEnd: generated.end,
        edited: Boolean(edited),
      };
    });

  const data = {
    lessonId,
    title: lesson.title,
    audio: timings.audio,
    duration,
    noise,
    silenceDuration,
    sentences,
    silences,
  };

  const htmlPath = path.join(process.cwd(), "scripts", "timings-editor.html");
  if (!fs.existsSync(htmlPath)) fail(`editor page not found at ${htmlPath}`);

  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";

    if (request.method === "POST" && url === "/save") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          const parsed = TimingEditsSchema.parse(body);
          const known = new Set(sentences.map((s) => s.id));
          const unknown = Object.keys(parsed.sentences).filter((id) => !known.has(id));
          if (unknown.length > 0) throw new Error(`unknown sentence id(s): ${unknown.join(", ")}`);
          for (const [id, range] of Object.entries(parsed.sentences)) {
            if (range.end <= range.start) throw new Error(`${id}: end is not after start`);
            if (range.end > duration + 0.01) throw new Error(`${id}: end is past the audio`);
          }
          const ordered = Object.fromEntries(
            sentences.filter((s) => parsed.sentences[s.id]).map((s) => [s.id, parsed.sentences[s.id]])
          );
          if (Object.keys(ordered).length === 0) {
            fs.rmSync(editsPath, { force: true });
            console.log(dim("  all corrections cleared — edits file removed"));
          } else {
            fs.writeFileSync(editsPath, `${JSON.stringify({ sentences: ordered }, null, 2)}\n`);
            console.log(
              green(`  saved ${Object.keys(ordered).length} corrected boundary set(s) to ${path.basename(editsPath)}`)
            );
          }
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(red(`  save rejected — ${message}`));
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: message }));
        }
      });
      return;
    }

    if (url === "/" || url.startsWith("/?")) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fs.readFileSync(htmlPath));
      return;
    }
    if (url === "/data.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(data));
      return;
    }
    if (url === "/audio.mp3") {
      const stat = fs.statSync(audioPath);
      response.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": stat.size });
      fs.createReadStream(audioPath).pipe(response);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}/`;
    console.log(bold(`\n${lessonId} — ${sentences.length} sentences, ${duration.toFixed(2)}s audio`));
    console.log(`  ${silences.length} silences at noise=${noise}, d=${silenceDuration}`);
    console.log(
      `  ${Object.keys(edits.sentences).length} boundary set(s) already corrected in ${path.basename(editsPath)}`
    );
    console.log(bold(`\n  ${url}`));
    console.log(dim("  Ctrl-C when finished\n"));
    if (!argv.includes("--no-open") && process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    }
  });
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/edit-timings.ts") || process.argv[1].endsWith("/edit-timings.js"));

if (isMain) main();
