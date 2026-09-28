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
import os from "os";
import crypto from "crypto";
import { spawn, spawnSync } from "child_process";
import { z } from "zod";
import {
  AudioTimingsSchema,
  DialogueVoicesSchema,
  LessonSchema,
  TimingEditsSchema,
} from "../src/lib/content/schema";
import type {
  AudioTimings,
  DialogueVoices,
  Lesson,
  Sentence,
  TimingEdits,
} from "../src/lib/content/schema";
import { parseScript, stripTags } from "./generate-dialogue-audio";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const AUDIO_DIR_NAME = "audio";
const DEFAULT_PORT = 4321;
const DEFAULT_NOISE = "-30dB";
const DEFAULT_SILENCE_DURATION = "0.12";
// A single-sentence take, unlike a full-scene take, has no neighbouring dialogue
// filling the space around it, so ElevenLabs pads it with silence that must be
// trimmed before splicing it in.
const REGEN_TRIM_PAD_SECONDS = 0.02;
const REGEN_API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps";
const REGEN_OUTPUT_FORMAT = "mp3_44100_128";
const REGEN_MIN_MP3_BYTES = 1_000;

export const round = (t: number) => Math.round(t * 1000) / 1000;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export interface Silence {
  start: number;
  end: number;
}

interface SentenceRow {
  id: string;
  speaker: string;
  target: string;
  scriptText: string | null;
  start: number;
  end: number;
  generatedStart: number;
  generatedEnd: number;
  edited: boolean;
}

interface EditorData {
  lessonId: string;
  title: string;
  audio: string;
  duration: number;
  noise: string;
  silenceDuration: string;
  sentences: SentenceRow[];
  silences: Silence[];
}

function fail(message: string): never {
  console.error(red(message));
  process.exit(1);
}

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i !== -1 ? (argv[i + 1] ?? null) : null;
}

// Lets `npm run timings lv-a1-02` work with no `--` and no `--lesson` label;
// `--lesson <id>` still works for scripts/muscle memory that expect a flag.
function firstPositional(argv: string[]): string | null {
  const arg = argv[0];
  return arg && !arg.startsWith("-") ? arg : null;
}

function insertSilence(
  audioPath: string,
  outputPath: string,
  atSeconds: number,
  silenceSeconds: number
): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sveiki-silence-"));
  const tempPath = path.join(tempDir, "audio.mp3");
  const filter =
    `[0:a]atrim=start=0:end=${atSeconds},asetpts=PTS-STARTPTS[before];` +
    `anullsrc=r=44100:cl=stereo:d=${silenceSeconds}[pause];` +
    `[0:a]atrim=start=${atSeconds},asetpts=PTS-STARTPTS[after];` +
    `[before][pause][after]concat=n=3:v=0:a=1[out]`;
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-i", audioPath, "-filter_complex", filter, "-map", "[out]", "-codec:a", "libmp3lame", "-b:a", "128k", tempPath],
    { encoding: "utf-8" }
  );
  if (result.error || result.status !== 0 || !fs.existsSync(tempPath)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fail(`ffmpeg could not insert silence: ${(result.stderr ?? "").slice(-800)}`);
  }
  fs.renameSync(tempPath, outputPath);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

export function shiftTimingsAfter(
  timings: AudioTimings,
  sentenceIds: string[],
  afterId: string,
  seconds: number
): AudioTimings {
  const index = sentenceIds.indexOf(afterId);
  if (index === -1) fail(`unknown sentence id: ${afterId}`);
  const shifted = Object.fromEntries(
    Object.entries(timings.sentences).map(([id, range]) => {
      const sentenceIndex = sentenceIds.indexOf(id);
      return [
        id,
        sentenceIndex > index
          ? { start: range.start + seconds, end: range.end + seconds }
          : range,
      ];
    })
  );
  return { ...timings, sentences: shifted };
}

// The regenerated sentence's own boundary is known exactly — the splice point is
// unchanged, and its duration comes straight from the trimmed replacement clip —
// while everything after it shifts by the resulting delta, positive or negative.
export function applyRegeneratedDuration(
  timings: AudioTimings,
  sentenceIds: string[],
  sentenceId: string,
  oldStart: number,
  oldEnd: number,
  newDuration: number
): AudioTimings {
  const delta = newDuration - (oldEnd - oldStart);
  const shifted = shiftTimingsAfter(timings, sentenceIds, sentenceId, delta);
  return {
    ...shifted,
    sentences: {
      ...roundAll(shifted.sentences),
      [sentenceId]: { start: round(oldStart), end: round(oldStart + newDuration) },
    },
  };
}

function roundAll(sentences: Record<string, { start: number; end: number }>): Record<string, { start: number; end: number }> {
  return Object.fromEntries(
    Object.entries(sentences).map(([id, range]) => [id, { start: round(range.start), end: round(range.end) }])
  );
}

// A prior hand correction for the regenerated sentence itself is void — the audio
// under it just changed — so it is dropped rather than shifted like everything after it.
export function dropRegeneratedEdit(
  edits: TimingEdits,
  sentenceIds: string[],
  sentenceId: string,
  oldStart: number,
  oldEnd: number,
  newDuration: number,
  audioName: string
): TimingEdits {
  const delta = newDuration - (oldEnd - oldStart);
  const shifted = roundAll(
    shiftTimingsAfter({ audio: audioName, sentences: edits.sentences }, sentenceIds, sentenceId, delta).sentences
  );
  const { [sentenceId]: _dropped, ...rest } = shifted;
  return { sentences: rest };
}

// Trims leading/trailing silence ElevenLabs adds around a single-sentence take so the
// splice doesn't insert a dead-air gap the full-scene original never had.
export function regenTrimBounds(
  duration: number,
  silences: Silence[],
  pad = REGEN_TRIM_PAD_SECONDS
): { start: number; end: number } {
  let start = 0;
  let end = duration;
  const leading = silences.find((s) => s.start <= 0.0005);
  if (leading) start = round(Math.min(duration, Math.max(0, leading.end - pad)));
  const trailing = [...silences].reverse().find((s) => duration - s.end <= 0.0005);
  if (trailing) end = round(Math.max(start, Math.min(duration, trailing.start + pad)));
  return { start, end };
}

export interface SpliceSegment {
  source: "original" | "candidate";
  start?: number;
  end?: number;
}

// Whatever sits strictly before/after the regenerated sentence in the *original* file
// carries over untouched; only the middle segment is the freshly generated clip.
export function buildSpliceSegments(
  oldStart: number,
  oldEnd: number,
  totalDuration: number
): SpliceSegment[] {
  const segments: SpliceSegment[] = [];
  if (oldStart > 0.0005) segments.push({ source: "original", start: 0, end: oldStart });
  segments.push({ source: "candidate" });
  if (totalDuration - oldEnd > 0.0005) {
    segments.push({ source: "original", start: oldEnd, end: totalDuration });
  }
  return segments;
}

export function buildConcatFilter(segments: SpliceSegment[]): string {
  const parts: string[] = [];
  const labels: string[] = [];
  segments.forEach((segment, i) => {
    const label = `s${i}`;
    if (segment.source === "candidate") {
      parts.push(`[1:a]asetpts=PTS-STARTPTS[${label}]`);
    } else {
      parts.push(`[0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[${label}]`);
    }
    labels.push(`[${label}]`);
  });
  parts.push(`${labels.join("")}concat=n=${segments.length}:v=0:a=1[out]`);
  return parts.join(";");
}

const RegenAlignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});

const RegenTtsResponseSchema = z.object({
  audio_base64: z.string().min(1),
  alignment: RegenAlignmentSchema.nullable().optional(),
});

async function synthesizeSentence(
  text: string,
  voiceId: string,
  voices: DialogueVoices,
  apiKey: string
): Promise<Buffer> {
  const response = await fetch(REGEN_API_URL.replace("{voice_id}", voiceId), {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: voices.model_id,
      language_code: voices.language_code,
      voice_settings: voices.settings,
      output_format: REGEN_OUTPUT_FORMAT,
    }),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs request failed (HTTP ${response.status}): ${(await response.text()).slice(0, 800)}`);
  }
  const parsed = RegenTtsResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`unexpected ElevenLabs response shape: ${parsed.error.message}`);
  const audio = Buffer.from(parsed.data.audio_base64, "base64");
  if (audio.length < REGEN_MIN_MP3_BYTES) throw new Error(`generated audio is only ${audio.length} bytes`);
  return audio;
}

function runFfmpeg(args: string[], label: string): void {
  const result = spawnSync("ffmpeg", args, { encoding: "utf-8" });
  if (result.error || result.status !== 0) {
    throw new Error(`ffmpeg could not ${label}: ${(result.stderr ?? "").slice(-800)}`);
  }
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

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const argv = process.argv.slice(2);
  const lessonId = firstPositional(argv) ?? flag(argv, "--lesson");
  if (!lessonId) {
    fail(
      "usage: npm run timings <lessonId>\n" +
        `  [--port ${DEFAULT_PORT}] [--noise ${DEFAULT_NOISE}] [--silence-duration ${DEFAULT_SILENCE_DURATION}] [--no-open]`
    );
  }

  requireFfmpeg();

  const lang = lessonId.split("-")[0];
  const langDir = path.join(CONTENT_ROOT, lang);
  const audioDir = path.join(langDir, AUDIO_DIR_NAME);
  const lessonPath = path.join(langDir, "lessons", `${lessonId}.json`);
  const lesson = readJson(lessonPath, LessonSchema, `lesson ${lessonId}`);
  const timingsPath = path.join(audioDir, `${lessonId}.timings.json`);
  let timings = readJson(timingsPath, AudioTimingsSchema, `timings for ${lessonId}`);
  const editsPath = path.join(audioDir, `${lessonId}.timings.edits.json`);
  let edits: TimingEdits = fs.existsSync(editsPath)
    ? readJson(editsPath, TimingEditsSchema, `edits for ${lessonId}`)
    : { sentences: {} };

  const audioPath = path.join(audioDir, timings.audio);
  if (!fs.existsSync(audioPath)) fail(`audio not found at ${audioPath}`);

  const orderedIds = lessonSentences(lesson).map((sentence) => sentence.id);
  const sentenceById = new Map(lessonSentences(lesson).map((sentence) => [sentence.id, sentence]));

  // The regenerate feature (single-sentence take -> spliced back in) is optional:
  // it needs the audio script and voice map, but plain boundary editing does not,
  // so their absence only blocks regeneration, not the whole editor.
  const audioScriptPath = path.join(langDir, "audio-scripts", `${lessonId}.md`);
  const scriptById = new Map(
    (fs.existsSync(audioScriptPath) ? parseScript(fs.readFileSync(audioScriptPath, "utf-8")) : []).map(
      (line) => [line.id, line]
    )
  );
  const voicesPath = path.join(langDir, "voices.json");
  const voices: DialogueVoices | null = fs.existsSync(voicesPath)
    ? DialogueVoicesSchema.parse(JSON.parse(fs.readFileSync(voicesPath, "utf-8")))
    : null;
  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const apiKey = process.env.ELEVENLABS_API_KEY ?? null;

  const regenTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sveiki-regen-"));
  interface Candidate {
    sentenceId: string;
    filePath: string;
    duration: number;
  }
  const candidates = new Map<string, Candidate>();

  const port = Number.parseInt(flag(argv, "--port") ?? String(DEFAULT_PORT), 10);
  const noise = flag(argv, "--noise") ?? DEFAULT_NOISE;
  const silenceDuration = flag(argv, "--silence-duration") ?? DEFAULT_SILENCE_DURATION;

  const insertAfter = flag(argv, "--insert-silence-after");
  const insertSeconds = flag(argv, "--seconds");
  if (insertAfter || insertSeconds) {
    if (!insertAfter || !insertSeconds) {
      fail("both --insert-silence-after <sentenceId> and --seconds <positive number> are required");
    }
    const seconds = Number.parseFloat(insertSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) fail("--seconds must be a positive number");
    const current = edits.sentences[insertAfter] ?? timings.sentences[insertAfter];
    if (!current) fail(`no timing found for ${insertAfter}`);
    const updated = shiftTimingsAfter(timings, orderedIds, insertAfter, seconds);
    insertSilence(audioPath, audioPath, current.end, seconds);
    writeJson(timingsPath, updated);
    if (Object.keys(edits.sentences).length > 0) {
      writeJson(editsPath, {
        sentences: shiftTimingsAfter(
          { audio: timings.audio, sentences: edits.sentences },
          orderedIds,
          insertAfter,
          seconds
        ).sentences,
      });
    }
    console.log(
      green(`inserted ${seconds.toFixed(3)}s of silence after ${insertAfter}; shifted later timings in ${path.basename(timingsPath)}`)
    );
    return;
  }

  // Recomputed after every save (cheap: no ffmpeg) and after every silence
  // insertion (which also re-probes duration and re-detects silences, since
  // the audio file itself changed).
  let duration = 0;
  let silences: Silence[] = [];
  let sentences: SentenceRow[] = [];
  let data: EditorData;

  function rebuildSentenceRows(): void {
    sentences = lessonSentences(lesson)
      .filter((sentence) => timings.sentences[sentence.id])
      .map((sentence) => {
        const generated = timings.sentences[sentence.id];
        const edited = edits.sentences[sentence.id];
        return {
          id: sentence.id,
          speaker: sentence.speaker ?? "",
          target: sentence.target,
          scriptText: scriptById.get(sentence.id)?.text ?? null,
          start: (edited ?? generated).start,
          end: (edited ?? generated).end,
          generatedStart: generated.start,
          generatedEnd: generated.end,
          edited: Boolean(edited),
        };
      });
    data = {
      lessonId: lessonId as string,
      title: lesson.title,
      audio: timings.audio,
      duration,
      noise,
      silenceDuration,
      sentences,
      silences,
    };
  }

  function refreshAfterAudioChange(): void {
    duration = probeDuration(audioPath);
    silences = detectSilences(audioPath, noise, silenceDuration, duration);
    rebuildSentenceRows();
  }

  refreshAfterAudioChange();

  // Regenerates one sentence via single-voice Text-to-Speech (Text-to-Dialogue can't
  // usefully redo just one line — no scene context, and v3 doesn't support stitching
  // requests) and returns a trimmed candidate clip for the browser to audition before
  // committing. Does not touch any file.
  async function handleRegenerate(sentenceId: string) {
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set — add it to .env.local");
    if (!voices) throw new Error(`voices.json not found for ${lang}`);
    const sentence = sentenceById.get(sentenceId);
    if (!sentence) throw new Error(`unknown sentence id: ${sentenceId}`);
    const line = scriptById.get(sentenceId);
    if (!line) throw new Error(`${sentenceId} is missing from ${path.basename(audioScriptPath)}`);
    const stripped = stripTags(line.text);
    if (stripped.toLowerCase() !== sentence.target.toLowerCase()) {
      throw new Error(
        `${sentenceId}: audio script text differs from the lesson target — fix the drift before regenerating ` +
          `(script: ${JSON.stringify(stripped)}, target: ${JSON.stringify(sentence.target)})`
      );
    }
    const voiceId = voices.speakers[line.speaker];
    if (!voiceId) throw new Error(`no voice_id in voices.json for speaker "${line.speaker}"`);

    const current = edits.sentences[sentenceId] ?? timings.sentences[sentenceId];
    if (!current) throw new Error(`no timing found for ${sentenceId}`);
    const isEdited = Boolean(edits.sentences[sentenceId]);

    const rawAudio = await synthesizeSentence(line.text, voiceId, voices, apiKey);
    const stamp = Date.now();
    const rawPath = path.join(regenTmpDir, `${sentenceId}-${stamp}-raw.mp3`);
    fs.writeFileSync(rawPath, rawAudio);
    const rawDuration = probeDuration(rawPath);
    const rawSilences = detectSilences(rawPath, noise, silenceDuration, rawDuration);
    const { start, end } = regenTrimBounds(rawDuration, rawSilences);

    const trimmedPath = path.join(regenTmpDir, `${sentenceId}-${stamp}-trimmed.mp3`);
    runFfmpeg(
      [
        "-y", "-i", rawPath,
        "-af", `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS`,
        "-codec:a", "libmp3lame", "-b:a", "128k", trimmedPath,
      ],
      "trim the candidate clip"
    );
    const trimmedDuration = probeDuration(trimmedPath);

    const candidateId = crypto.randomUUID();
    candidates.set(candidateId, { sentenceId, filePath: trimmedPath, duration: trimmedDuration });

    return {
      candidateId,
      text: line.text,
      oldStart: current.start,
      oldEnd: current.end,
      oldDuration: round(current.end - current.start),
      newDuration: round(trimmedDuration),
      edited: isEdited,
    };
  }

  // Splices a previously generated candidate into the audio in place, shifts every
  // later boundary by the exact duration delta, and drops any stale hand correction
  // for the patched sentence itself (the audio under it just changed).
  function handleRegenerateCommit(sentenceId: string, candidateId: string, confirmed: boolean): void {
    const candidate = candidates.get(candidateId);
    if (!candidate || candidate.sentenceId !== sentenceId) {
      throw new Error("candidate not found or does not match this sentence — regenerate again");
    }
    const current = edits.sentences[sentenceId] ?? timings.sentences[sentenceId];
    if (!current) throw new Error(`no timing found for ${sentenceId}`);
    const isEdited = Boolean(edits.sentences[sentenceId]);
    if (!isEdited && !confirmed) {
      throw new Error(`${sentenceId}'s boundary has never been human-reviewed. Type "y" to proceed anyway.`);
    }

    const totalDuration = probeDuration(audioPath);
    const segments = buildSpliceSegments(current.start, current.end, totalDuration);
    const outPath = path.join(regenTmpDir, `${lessonId}-spliced-${Date.now()}.mp3`);
    runFfmpeg(
      [
        "-y", "-i", audioPath, "-i", candidate.filePath,
        "-filter_complex", buildConcatFilter(segments),
        "-map", "[out]", "-codec:a", "libmp3lame", "-b:a", "128k", outPath,
      ],
      "splice the replacement in"
    );

    // Rolling backups: only the most recent regeneration is undoable, which is
    // enough for "that take was worse, put the old one back."
    fs.copyFileSync(audioPath, `${audioPath}.bak`);
    fs.copyFileSync(timingsPath, `${timingsPath}.bak`);
    if (fs.existsSync(editsPath)) fs.copyFileSync(editsPath, `${editsPath}.bak`);

    fs.copyFileSync(outPath, audioPath);

    timings = applyRegeneratedDuration(timings, orderedIds, sentenceId, current.start, current.end, candidate.duration);
    writeJson(timingsPath, timings);

    const nextEdits = dropRegeneratedEdit(
      edits, orderedIds, sentenceId, current.start, current.end, candidate.duration, timings.audio
    );
    if (Object.keys(nextEdits.sentences).length > 0) {
      edits = nextEdits;
      writeJson(editsPath, edits);
    } else if (fs.existsSync(editsPath)) {
      fs.rmSync(editsPath);
      edits = { sentences: {} };
    }

    const sentence = sentenceById.get(sentenceId)!;
    if (sentence.audioApproved) {
      sentence.audioApproved = false;
      writeJson(lessonPath, lesson);
      console.log(yellow(`  ${sentenceId} was marked audioApproved — reset to false, needs a fresh native-speaker check`));
    }

    candidates.delete(candidateId);
    refreshAfterAudioChange();
    const delta = candidate.duration - (current.end - current.start);
    console.log(
      green(
        `  regenerated ${sentenceId}: ${(current.end - current.start).toFixed(3)}s -> ` +
          `${candidate.duration.toFixed(3)}s (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(3)}s)`
      )
    );
    console.log(
      yellow(
        `  re-check ${sentenceId} by ear (and anything shifted after it) — ` +
          `${lessonId}.alignment.json is now stale from here on`
      )
    );
  }

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
            edits = { sentences: {} };
            console.log(dim("  all corrections cleared — edits file removed"));
          } else {
            fs.writeFileSync(editsPath, `${JSON.stringify({ sentences: ordered }, null, 2)}\n`);
            edits = { sentences: ordered };
            console.log(
              green(`  saved ${Object.keys(ordered).length} corrected boundary set(s) to ${path.basename(editsPath)}`)
            );
          }
          rebuildSentenceRows();
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

    if (request.method === "POST" && url === "/insert-silence") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          const afterId = typeof body.afterId === "string" ? body.afterId : "";
          const seconds = Number(body.seconds);
          if (!afterId) throw new Error("afterId is required");
          if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("seconds must be a positive number");

          const current = edits.sentences[afterId] ?? timings.sentences[afterId];
          if (!current) throw new Error(`no timing found for ${afterId}`);

          timings = shiftTimingsAfter(timings, orderedIds, afterId, seconds);
          insertSilence(audioPath, audioPath, current.end, seconds);
          writeJson(timingsPath, timings);

          if (Object.keys(edits.sentences).length > 0) {
            edits = {
              sentences: shiftTimingsAfter(
                { audio: timings.audio, sentences: edits.sentences },
                orderedIds,
                afterId,
                seconds
              ).sentences,
            };
            writeJson(editsPath, edits);
          }

          refreshAfterAudioChange();
          console.log(green(`  inserted ${seconds.toFixed(3)}s of silence after ${afterId}`));
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true, data }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(red(`  insert-silence rejected — ${message}`));
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: message }));
        }
      });
      return;
    }

    if (request.method === "POST" && url === "/regenerate") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        (async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            const sentenceId = typeof body.sentenceId === "string" ? body.sentenceId : "";
            if (!sentenceId) throw new Error("sentenceId is required");
            const result = await handleRegenerate(sentenceId);
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ ok: true, result }));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(red(`  regenerate rejected — ${message}`));
            response.writeHead(400, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ ok: false, error: message }));
          }
        })();
      });
      return;
    }

    if (request.method === "POST" && url === "/regenerate-commit") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          const sentenceId = typeof body.sentenceId === "string" ? body.sentenceId : "";
          const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
          const confirmed = body.confirmed === true;
          if (!sentenceId || !candidateId) throw new Error("sentenceId and candidateId are required");
          handleRegenerateCommit(sentenceId, candidateId, confirmed);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true, data }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(red(`  regenerate-commit rejected — ${message}`));
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: message }));
        }
      });
      return;
    }

    if (request.method === "GET" && url.startsWith("/regenerate-original.mp3")) {
      try {
        const sentenceId = new URL(url, "http://localhost").searchParams.get("sentenceId") ?? "";
        const current = edits.sentences[sentenceId] ?? timings.sentences[sentenceId];
        if (!current) throw new Error(`no timing found for ${sentenceId}`);
        const slicePath = path.join(regenTmpDir, `${sentenceId}-slice-${Date.now()}.mp3`);
        runFfmpeg(
          ["-y", "-ss", String(current.start), "-to", String(current.end), "-i", audioPath, "-c", "copy", slicePath],
          "extract the current slice"
        );
        const stat = fs.statSync(slicePath);
        response.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": stat.size, "Cache-Control": "no-store" });
        fs.createReadStream(slicePath).pipe(response);
      } catch (error) {
        response.writeHead(400);
        response.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (request.method === "GET" && url.startsWith("/regenerate-candidate.mp3")) {
      const candidateId = new URL(url, "http://localhost").searchParams.get("candidateId") ?? "";
      const candidate = candidates.get(candidateId);
      if (!candidate) {
        response.writeHead(404);
        response.end("candidate not found");
        return;
      }
      const stat = fs.statSync(candidate.filePath);
      response.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": stat.size, "Cache-Control": "no-store" });
      fs.createReadStream(candidate.filePath).pipe(response);
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
      response.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
      });
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
      spawn("open", ["-a", "Google Chrome", url], { stdio: "ignore", detached: true }).unref();
    }
  });
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/edit-timings.ts") || process.argv[1].endsWith("/edit-timings.js"));

if (isMain) main();
