import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawnSync } from "child_process";
import {
  LessonSchema,
  ElevenVoicesSchema,
  AudioManifestSchema,
} from "../src/lib/content/schema";
import type {
  Lesson,
  Sentence,
  ElevenVoice,
  ElevenVoices,
  AudioManifest,
  AudioManifestEntry,
} from "../src/lib/content/schema";

// Deliberately standalone rather than sharing helpers with
// generate-dialogue-audio.ts: per-sentence and whole-scene generation are being
// compared and either may be dropped.
const CONTENT_ROOT = path.join(process.cwd(), "content");
const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const REQUEST_DELAY_MS = 250;
const MAX_ATTEMPTS = 5;
// ElevenLabs returns mp3 directly; a JSON error body is far smaller than any clip.
const MIN_MP3_BYTES = 1_000;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

export class AuthError extends Error {}
// Plan and credit limits do not clear within a run, so there is nothing to retry.
export class PlanError extends Error {}

export function resolveVoice(
  voices: ElevenVoices,
  speaker: string | undefined
): { voice: ElevenVoice; mapped: boolean } {
  const mapping = speaker === undefined ? undefined : voices.speakers[speaker];
  return mapping ? { voice: mapping, mapped: true } : { voice: voices.fallback, mapped: false };
}

// target is sent verbatim: no v3 audio tags, no punctuation or number rewriting.
export function buildBody(target: string, model: string): string {
  return JSON.stringify({ text: target, model_id: model });
}

export function inputHash(
  target: string,
  voice: ElevenVoice,
  model: string,
  outputFormat: string
): string {
  const inputs = JSON.stringify({ model, outputFormat, voiceId: voice.voiceId, target });
  return crypto.createHash("sha256").update(inputs).digest("hex");
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

export function expectedAudioName(lessonId: string, sentenceId: string): string {
  return `${lessonId}-${sentenceId}.mp3`;
}

export function lessonSentences(lesson: Lesson): Sentence[] {
  return lesson.sections.flatMap((section) => section.sentences);
}

export function unmappedSpeakers(
  lessons: Lesson[],
  voices: ElevenVoices
): { speaker: string; count: number; examples: string[] }[] {
  const found = new Map<string, string[]>();
  for (const lesson of lessons) {
    for (const sentence of lessonSentences(lesson)) {
      const key = sentence.speaker ?? "(no speaker)";
      if (sentence.speaker !== undefined && voices.speakers[sentence.speaker]) continue;
      if (!found.has(key)) found.set(key, []);
      found.get(key)!.push(`${lesson.lessonId}/${sentence.id}`);
    }
  }
  return [...found.entries()]
    .map(([speaker, where]) => ({ speaker, count: where.length, examples: where.slice(0, 3) }))
    .sort((a, b) => b.count - a.count);
}

// A 402/401 body explains a plan or credit problem far better than the status alone.
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
    ? "This voice comes from the ElevenLabs Voice Library, which the free plan cannot use via the API. Either upgrade the subscription or switch voices-elevenlabs.json to a premade voice."
    : /credits remaining|quota of/i.test(message)
      ? "The API key has no credits left — raise its credit limit (or the plan's) in the ElevenLabs dashboard."
      : "Check the subscription and the API key's credit limit in the ElevenLabs dashboard.";
  return `HTTP ${status}: ${message || body.slice(0, 200)}\n  ${hint}`;
}

// --- ffprobe ----------------------------------------------------------------

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

// Written to a temp path and moved only on success, so a rejected request can
// never leave a JSON error body sitting on disk named as an mp3.
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
  target: string,
  voice: ElevenVoice,
  model: string,
  outputFormat: string,
  apiKey: string
): Promise<Buffer> {
  const url = `${API_BASE}/${voice.voiceId}?output_format=${outputFormat}`;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: buildBody(target, model),
    });

    if (response.ok) return Buffer.from(await response.arrayBuffer());

    const body = (await response.text()).slice(0, 800);

    // 401 covers both a bad key and an exhausted credit allowance.
    if (response.status === 402 || /credits remaining|quota of/i.test(body)) {
      throw new PlanError(planMessage(response.status, body));
    }
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(
        `${planMessage(response.status, body)}\n  Verify ELEVENLABS_API_KEY in .env.local (it must start with "sk_") and its permissions.`
      );
    }
    if (response.status === 422) {
      throw new Error(`request rejected (HTTP 422): ${body}`);
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`request failed (HTTP ${response.status}): ${body}`);
    }

    lastError = `HTTP ${response.status}: ${body}`;
    if (attempt < MAX_ATTEMPTS) {
      const backoff = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      console.log(
        yellow(`    retrying in ${(backoff / 1000).toFixed(1)}s (attempt ${attempt}/${MAX_ATTEMPTS})`)
      );
      await sleep(backoff);
    }
  }

  throw new Error(`request failed after ${MAX_ATTEMPTS} attempts — ${lastError}`);
}

// --- Loading ----------------------------------------------------------------

function loadVoices(langDir: string): ElevenVoices {
  const voicesPath = path.join(langDir, "voices-elevenlabs.json");
  if (!fs.existsSync(voicesPath)) {
    console.error(red(`voices-elevenlabs.json not found at ${voicesPath}`));
    process.exit(1);
  }
  const result = ElevenVoicesSchema.safeParse(JSON.parse(fs.readFileSync(voicesPath, "utf-8")));
  if (!result.success) {
    console.error(red(`voices-elevenlabs.json schema error: ${result.error.message}`));
    process.exit(1);
  }
  return result.data;
}

export function loadManifest(manifestPath: string): AudioManifest {
  if (!fs.existsSync(manifestPath)) return {};
  const result = AudioManifestSchema.safeParse(JSON.parse(fs.readFileSync(manifestPath, "utf-8")));
  if (!result.success) {
    console.error(red(`audio manifest schema error: ${result.error.message}`));
    process.exit(1);
  }
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

function loadLessons(lessonsDir: string): Lesson[] {
  return fs
    .readdirSync(lessonsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const filePath = path.join(lessonsDir, f);
      const result = LessonSchema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
      if (!result.success) {
        console.error(red(`${f} failed schema validation — run npm run validate first`));
        process.exit(1);
      }
      return result.data;
    });
}

// --- Main -------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const lessonFlagIdx = argv.indexOf("--lesson");
  const lessonId = lessonFlagIdx !== -1 ? argv[lessonFlagIdx + 1] : null;
  const all = argv.includes("--all");
  const force = argv.includes("--force");

  if (!lessonId && !all) {
    console.error(
      red("usage: npm run audio:elevenlabs -- --lesson <lessonId> | --all [--force]")
    );
    process.exit(1);
  }

  requireFfprobe();

  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error(red("ELEVENLABS_API_KEY is not set — add it to .env.local"));
    process.exit(1);
  }

  const langDir = path.join(CONTENT_ROOT, "lv");
  const audioDir = path.join(langDir, "audio-elevenlabs");
  const manifestPath = path.join(audioDir, "manifest.json");
  fs.mkdirSync(audioDir, { recursive: true });

  const voices = loadVoices(langDir);
  const { model, outputFormat } = voices.defaults;
  const allLessons = loadLessons(path.join(langDir, "lessons"));
  const manifest = loadManifest(manifestPath);

  console.log(bold(`\nElevenLabs — model ${model}, format ${outputFormat}`));

  const unmapped = unmappedSpeakers(allLessons, voices);
  if (unmapped.length > 0) {
    console.log(bold("\nSpeakers with no voice mapping (using fallback voice):"));
    for (const { speaker, count, examples } of unmapped) {
      console.log(
        yellow(
          `  ${speaker} — ${count} sentence(s), fallback "${voices.fallback.voiceId}": ${examples.join(", ")}`
        )
      );
    }
  }

  const targets = lessonId ? allLessons.filter((l) => l.lessonId === lessonId) : allLessons;
  if (targets.length === 0) {
    console.error(red(`lesson "${lessonId}" not found`));
    process.exit(1);
  }

  let generated = 0;
  let skipped = 0;
  let characters = 0;
  const failures: string[] = [];

  for (const lesson of targets) {
    console.log(bold(`\n=== ${lesson.lessonId} ===`));

    for (const sentence of lessonSentences(lesson)) {
      const filename = expectedAudioName(lesson.lessonId, sentence.id);
      const destination = path.join(audioDir, filename);
      const { voice } = resolveVoice(voices, sentence.speaker);
      const hash = inputHash(sentence.target, voice, model, outputFormat);

      const existing = manifest[filename];
      if (!shouldRegenerate(existing, hash, fs.existsSync(destination), force)) {
        skipped++;
        console.log(`  skip     ${filename} (${existing!.durationSeconds}s, unchanged)`);
        continue;
      }

      try {
        const mp3 = await synthesize(sentence.target, voice, model, outputFormat, apiKey);
        const durationSeconds = writeAudio(destination, mp3);
        characters += sentence.target.length;
        manifest[filename] = {
          hash,
          voice: voice.voiceId,
          durationSeconds,
          generatedAt: new Date().toISOString(),
        };
        writeManifest(manifestPath, manifest);
        generated++;
        console.log(green(`  wrote    ${filename} (${durationSeconds}s, ${mp3.length} bytes)`));
      } catch (error) {
        if (error instanceof AuthError || error instanceof PlanError) {
          console.error(red(`\n  ${error.message}`));
          console.error(red("\nAborting: every remaining request would fail the same way."));
          process.exit(1);
        }
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${filename}: ${message}`);
        console.error(red(`  FAILED   ${filename} — ${message}`));
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  const files = fs.readdirSync(audioDir).filter((f) => f.endsWith(".mp3"));
  const totalBytes = files.reduce((sum, f) => sum + fs.statSync(path.join(audioDir, f)).size, 0);

  console.log(bold("\n=== Summary ==="));
  console.log(`  generated: ${generated}`);
  console.log(`  skipped:   ${skipped}`);
  console.log(`  failed:    ${failures.length}`);
  console.log(`  characters billed this run: ~${characters}`);
  console.log(`  audio dir: ${files.length} mp3, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (failures.length > 0) {
    console.log(red("\n  failures:"));
    failures.forEach((f) => console.log(red(`    ${f}`)));
    process.exit(1);
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
