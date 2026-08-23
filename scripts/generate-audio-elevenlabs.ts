import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import { z } from "zod";
import { LessonSchema, VoicesSchema, AudioManifestSchema } from "../src/lib/content/schema";
import type {
  Lesson,
  Sentence,
  Voices,
  AudioManifest,
  AudioManifestEntry,
} from "../src/lib/content/schema";

// One request per sentence, one mp3 per sentence. Sentence boundaries are then the
// file boundaries, so the player never has to infer them — the whole-scene approach
// this replaces inferred them from the model's character alignment, which drifted by
// up to 0.7s late in a lesson. Delivery tags come from
// content/<lang>/audio-scripts/<lessonId>.md.
//
// Cross-sentence continuity is off by default because eleven_v3 — the only model that
// renders the scripts' [bracketed] tags — rejects previous_text/next_text AND
// previous_request_ids/next_request_ids outright ("not yet supported with the
// 'eleven_v3' model"). --context exists for a model that does support them, at the
// cost of the tags. Per-sentence delivery therefore rests on the tags alone.
const CONTENT_ROOT = path.join(process.cwd(), "content");
const AUDIO_DIR = "audio";
const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const REQUEST_DELAY_MS = 250;
const MAX_ATTEMPTS = 5;
// ElevenLabs returns mp3 bytes directly; a JSON error body is far smaller than any clip.
const MIN_MP3_BYTES = 1_000;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

export class AuthError extends Error {}
// Plan and credit limits do not clear within a run, so there is nothing to retry.
export class PlanError extends Error {}
// The model rejected the request as malformed — retrying sends the same thing.
export class RequestError extends Error {}

const ScriptLineSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().min(1),
  text: z.string().min(1),
});

export type ScriptLine = z.infer<typeof ScriptLineSchema>;

export interface Job {
  sentenceId: string;
  filename: string;
  speaker: string;
  voiceId: string;
  /** Tagged text — what actually gets sent and billed. */
  text: string;
  previousText: string | null;
  nextText: string | null;
}

// --- Script parsing ---------------------------------------------------------

/** `s12 | Anna | [surprised] Ko?` — speaker and tags live here, never in lesson JSON. */
export function parseScript(markdown: string): ScriptLine[] {
  return markdown
    .split("\n")
    .filter((line) => /^s\d+\s*\|/.test(line))
    .map((line) => {
      const [id, speaker, ...rest] = line.split("|");
      return ScriptLineSchema.parse({
        id: id.trim(),
        speaker: speaker?.trim() ?? "",
        text: rest.join("|").trim(),
      });
    });
}

export function stripTags(text: string): string {
  return text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

// The script exists only to add delivery tags. If it has drifted from the lesson —
// reordered, reworded, re-punctuated — a clip would carry text the learner is not
// reading, so the mismatch has to stop the run. Case is exempt: SHOUTING a word is a
// delivery instruction to the model, like a tag, and the lesson keeps normal case.
export function checkScriptAgainstLesson(
  script: ScriptLine[],
  sentences: Sentence[]
): string[] {
  const problems: string[] = [];
  if (script.length !== sentences.length) {
    problems.push(
      `script has ${script.length} line(s), lesson has ${sentences.length} sentence(s)`
    );
  }
  sentences.forEach((sentence, i) => {
    const line = script[i];
    if (!line) {
      problems.push(`${sentence.id}: missing from script`);
      return;
    }
    if (line.id !== sentence.id) {
      problems.push(`position ${i + 1}: script has ${line.id}, lesson has ${sentence.id}`);
      return;
    }
    if (line.speaker !== sentence.speaker) {
      problems.push(
        `${sentence.id}: speaker "${line.speaker}" but lesson says "${sentence.speaker}"`
      );
    }
    const stripped = stripTags(line.text);
    if (stripped.toLowerCase() !== sentence.target.toLowerCase()) {
      problems.push(
        `${sentence.id}: text differs from target (case aside)\n      script: ${JSON.stringify(stripped)}\n      target: ${JSON.stringify(sentence.target)}`
      );
    }
  });
  return problems;
}

// --- Jobs -------------------------------------------------------------------

/**
 * Context stops at section edges: a drill line is not the answer to the dialogue
 * turn above it, and telling the model otherwise would colour the delivery wrongly.
 */
export function buildJobs(lesson: Lesson, script: ScriptLine[], voices: Voices): Job[] {
  const byId = new Map(script.map((line) => [line.id, line]));
  const missing = [...new Set(script.map((l) => l.speaker))].filter(
    (speaker) => !voices.speakers[speaker]
  );
  if (missing.length > 0) {
    throw new Error(
      `no voice id in content/lv/voices.json for speaker(s): ${missing.join(", ")}\n` +
        `  mapped speakers: ${Object.keys(voices.speakers).join(", ")}`
    );
  }

  const jobs: Job[] = [];
  for (const section of lesson.sections) {
    section.sentences.forEach((sentence, i) => {
      const line = byId.get(sentence.id);
      if (!line) throw new Error(`${sentence.id} is missing from the audio script`);
      const previous = section.sentences[i - 1];
      const next = section.sentences[i + 1];
      jobs.push({
        sentenceId: sentence.id,
        filename: sentence.audio,
        speaker: line.speaker,
        voiceId: voices.speakers[line.speaker],
        text: line.text,
        previousText: previous ? (byId.get(previous.id)?.text ?? null) : null,
        nextText: next ? (byId.get(next.id)?.text ?? null) : null,
      });
    });
  }
  return jobs;
}

export function selectJobs(
  jobs: Job[],
  filters: { sentenceIds?: string[] | null; speaker?: string | null }
): Job[] {
  return jobs.filter((job) => {
    if (filters.sentenceIds && !filters.sentenceIds.includes(job.sentenceId)) return false;
    if (filters.speaker && job.speaker !== filters.speaker) return false;
    return true;
  });
}

export function buildBody(job: Job, voices: Voices, withContext: boolean): string {
  return JSON.stringify({
    text: job.text,
    model_id: voices.model,
    ...(withContext && job.previousText ? { previous_text: job.previousText } : {}),
    ...(withContext && job.nextText ? { next_text: job.nextText } : {}),
  });
}

// Context is deliberately left out of the hash. It shapes delivery, but a clip
// generated against an older neighbour is still correct audio for its own sentence,
// and rehashing on it would silently invalidate clips Christian has already approved.
// Use --force when a neighbour's rewrite is worth re-spending on.
export function inputHash(job: Job, voices: Voices): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        model: voices.model,
        outputFormat: voices.outputFormat,
        voiceId: job.voiceId,
        text: job.text,
      })
    )
    .digest("hex");
}

export function shouldRegenerate(
  entry: AudioManifestEntry | undefined,
  hash: string,
  fileExists: boolean,
  force: boolean
): boolean {
  if (force) return true;
  if (!entry || !fileExists) return true;
  return entry.hash !== hash;
}

// A 401/402 body explains a plan or credit problem far better than the status alone.
export function planMessage(status: number, body: string): string {
  const message = (() => {
    try {
      const detail = (JSON.parse(body) as { detail?: { message?: string } }).detail;
      return detail?.message ?? "";
    } catch {
      return "";
    }
  })();
  const hint = /library voices/i.test(message)
    ? "This voice comes from the ElevenLabs Voice Library, which needs a paid plan. Either check the subscription or switch voices.json to a premade voice."
    : /credits remaining|quota of/i.test(message)
      ? "The API key has no credits left — raise its credit limit (or the plan's) in the ElevenLabs dashboard."
      : "Check the subscription and the API key's credit limit in the ElevenLabs dashboard.";
  return `HTTP ${status}: ${message || body.slice(0, 200)}\n  ${hint}`;
}

// --- Duration ---------------------------------------------------------------

export function requireFfprobe(): void {
  const probe = spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      "ffprobe is not on PATH; it is needed to read clip durations. Install with: brew install ffmpeg"
    );
  }
}

export function probeDurationSeconds(filePath: string): number {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" }
  );
  const duration = Number.parseFloat((probe.stdout ?? "").trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe could not read a duration from ${path.basename(filePath)}`);
  }
  return Math.round(duration * 1000) / 1000;
}

// Written to a temp path and moved only on success, so a rejected request can never
// leave a JSON error body sitting on disk named as an mp3.
export function writeAudio(destination: string, mp3: Buffer): number {
  if (mp3.length < MIN_MP3_BYTES) {
    throw new Error(`response was only ${mp3.length} bytes — too small to be audio`);
  }
  const temp = `${destination}.part.mp3`;
  try {
    fs.writeFileSync(temp, mp3);
    const duration = probeDurationSeconds(temp);
    fs.renameSync(temp, destination);
    return duration;
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// --- Synthesis --------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function synthesize(
  job: Job,
  voices: Voices,
  withContext: boolean,
  apiKey: string
): Promise<Buffer> {
  const url = `${API_BASE}/${job.voiceId}?output_format=${voices.outputFormat}`;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: buildBody(job, voices, withContext),
    });

    if (response.ok) return Buffer.from(await response.arrayBuffer());

    const body = (await response.text()).slice(0, 800);

    if (response.status === 402 || /credits remaining|quota of/i.test(body)) {
      throw new PlanError(planMessage(response.status, body));
    }
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(
        `${planMessage(response.status, body)}\n  Verify ELEVENLABS_API_KEY in .env.local (it must start with "sk_") and its permissions.`
      );
    }
    if (response.status !== 429 && response.status < 500) {
      const aboutContext = /previous_text|next_text|previous_request_ids|next_request_ids/i.test(body);
      throw new RequestError(
        `request failed (HTTP ${response.status}): ${body}` +
          (aboutContext
            ? `\n  ${voices.model} does not accept neighbour context — drop --context (the tags carry delivery instead).`
            : "")
      );
    }

    lastError = `HTTP ${response.status}: ${body}`;
    if (attempt < MAX_ATTEMPTS) {
      const backoff = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      console.log(
        yellow(
          `    retrying in ${(backoff / 1000).toFixed(1)}s (attempt ${attempt}/${MAX_ATTEMPTS})`
        )
      );
      await sleep(backoff);
    }
  }

  throw new Error(`request failed after ${MAX_ATTEMPTS} attempts — ${lastError}`);
}

// --- Loading ----------------------------------------------------------------

function fail(message: string): never {
  console.error(red(message));
  process.exit(1);
}

function loadJson<T>(filePath: string, schema: z.ZodType<T>, label: string): T {
  if (!fs.existsSync(filePath)) fail(`${label} not found at ${filePath}`);
  const result = schema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  if (!result.success) fail(`${label} schema error: ${result.error.message}`);
  return result.data;
}

export function loadManifest(manifestPath: string): AudioManifest {
  if (!fs.existsSync(manifestPath)) return {};
  const result = AudioManifestSchema.safeParse(
    JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
  );
  if (!result.success) fail(`audio manifest schema error: ${result.error.message}`);
  return result.data;
}

export function writeManifest(manifestPath: string, manifest: AudioManifest): void {
  const sorted = Object.fromEntries(
    Object.keys(manifest)
      .sort()
      .map((key) => [key, manifest[key]])
  );
  fs.writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
}

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i !== -1 ? (argv[i + 1] ?? null) : null;
}

// --- Main -------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const lessonId = flag(argv, "--lesson");
  const all = argv.includes("--all");
  const sentenceArg = flag(argv, "--sentence");
  const speaker = flag(argv, "--speaker");
  const force = argv.includes("--force");
  const dryRun = argv.includes("--dry-run");
  const withContext = argv.includes("--context");

  if (!lessonId && !all) {
    fail(
      "usage: npm run audio -- --lesson <lessonId> | --all\n" +
        "  [--sentence s1,s2] [--speaker Anna] [--force] [--dry-run] [--context]"
    );
  }
  if (sentenceArg && !lessonId) fail("--sentence needs --lesson");

  const langDir = path.join(CONTENT_ROOT, "lv");
  const audioDir = path.join(langDir, AUDIO_DIR);
  const manifestPath = path.join(audioDir, "manifest.json");
  const voices = loadJson(path.join(langDir, "voices.json"), VoicesSchema, "voices.json");

  const lessonIds = lessonId
    ? [lessonId]
    : fs
        .readdirSync(path.join(langDir, "lessons"))
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => path.basename(f, ".json"));

  const sentenceIds = sentenceArg ? sentenceArg.split(",").map((s) => s.trim()) : null;

  const planned: { lesson: string; jobs: Job[] }[] = [];
  for (const id of lessonIds) {
    const lesson = loadJson(
      path.join(langDir, "lessons", `${id}.json`),
      LessonSchema,
      `lesson ${id}`
    );
    const scriptPath = path.join(langDir, "audio-scripts", `${id}.md`);
    if (!fs.existsSync(scriptPath)) fail(`audio script not found at ${scriptPath}`);
    const script = parseScript(fs.readFileSync(scriptPath, "utf-8"));
    const sentences = lesson.sections.flatMap((section) => section.sentences);
    const problems = checkScriptAgainstLesson(script, sentences);
    if (problems.length > 0) {
      fail(`audio script does not match ${id}:\n  ${problems.join("\n  ")}`);
    }
    planned.push({ lesson: id, jobs: selectJobs(buildJobs(lesson, script, voices), { sentenceIds, speaker }) });
  }

  console.log(
    bold(
      `\nElevenLabs per-sentence — model ${voices.model}, format ${voices.outputFormat}` +
        `${withContext ? ", neighbour context on" : ", no context"}`
    )
  );

  fs.mkdirSync(audioDir, { recursive: true });
  const manifest = loadManifest(manifestPath);

  let generated = 0;
  let skipped = 0;
  let characters = 0;
  let contextCharacters = 0;
  const failures: string[] = [];

  if (!dryRun) {
    requireFfprobe();
    if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!dryRun && !apiKey) fail("ELEVENLABS_API_KEY is not set — add it to .env.local");

  for (const { lesson, jobs } of planned) {
    console.log(bold(`\n=== ${lesson} — ${jobs.length} sentence(s) selected ===`));

    for (const job of jobs) {
      const destination = path.join(audioDir, job.filename);
      const hash = inputHash(job, voices);
      const existing = manifest[job.filename];

      if (!shouldRegenerate(existing, hash, fs.existsSync(destination), force)) {
        skipped++;
        console.log(`  skip     ${job.filename} (${existing!.durationSeconds}s, unchanged)`);
        continue;
      }

      const context = withContext
        ? (job.previousText?.length ?? 0) + (job.nextText?.length ?? 0)
        : 0;

      if (dryRun) {
        console.log(
          `  would    ${job.filename} — ${job.speaker}, ${job.text.length} chars` +
            (context ? ` (+${context} context)` : "")
        );
        characters += job.text.length;
        contextCharacters += context;
        generated++;
        continue;
      }

      try {
        const mp3 = await synthesize(job, voices, withContext, apiKey!);
        const durationSeconds = writeAudio(destination, mp3);
        characters += job.text.length;
        contextCharacters += context;
        manifest[job.filename] = {
          hash,
          voice: job.voiceId,
          durationSeconds,
          generatedAt: new Date().toISOString(),
        };
        writeManifest(manifestPath, manifest);
        generated++;
        console.log(
          green(`  wrote    ${job.filename} (${durationSeconds}s, ${job.speaker}, ${mp3.length} bytes)`)
        );
      } catch (error) {
        if (error instanceof AuthError || error instanceof PlanError) {
          console.error(red(`\n  ${error.message}`));
          console.error(red("\nAborting: every remaining request would fail the same way."));
          process.exit(1);
        }
        if (error instanceof RequestError) {
          console.error(red(`\n  ${job.filename} — ${error.message}`));
          console.error(red("\nAborting: the request shape is wrong, so the rest would fail too."));
          process.exit(1);
        }
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${job.filename}: ${message}`);
        console.error(red(`  FAILED   ${job.filename} — ${message}`));
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  const clips = fs.readdirSync(audioDir).filter((f) => f.endsWith(".mp3"));
  const totalBytes = clips.reduce((sum, f) => sum + fs.statSync(path.join(audioDir, f)).size, 0);

  console.log(bold("\n=== Summary ==="));
  console.log(`  ${dryRun ? "would generate" : "generated"}: ${generated}`);
  console.log(`  skipped:   ${skipped}`);
  if (!dryRun) console.log(`  failed:    ${failures.length}`);
  console.log(`  sentence characters: ${characters}`);
  if (contextCharacters > 0) {
    console.log(
      `  neighbour context characters: ${contextCharacters} — unknown whether ElevenLabs bills these; check the dashboard after this run`
    );
  }
  console.log(`  audio dir: ${clips.length} mp3, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (failures.length > 0) {
    console.log(red("\n  failures:"));
    failures.forEach((f) => console.log(red(`    ${f}`)));
    process.exit(1);
  }
  if (!dryRun && generated > 0) {
    console.log("\n  audioApproved stays false — Christian listens before approval.\n");
  }
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/generate-audio-elevenlabs.ts") ||
    process.argv[1].endsWith("/generate-audio-elevenlabs.js"));

if (isMain) {
  main().catch((error) => {
    console.error(red(`\n${error instanceof Error ? error.stack : String(error)}`));
    process.exit(1);
  });
}
