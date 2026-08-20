import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn, spawnSync } from "child_process";
import {
  LessonSchema,
  VoicesSchema,
  AudioManifestSchema,
} from "../src/lib/content/schema";
import type {
  Lesson,
  Sentence,
  Voice,
  Voices,
  AudioManifest,
  AudioManifestEntry,
} from "../src/lib/content/schema";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// The free tier allows 10 TTS requests per minute per model. Requests are paced
// to stay under it rather than sprinting into a 429 and then thrashing on retries.
const DEFAULT_REQUESTS_PER_MINUTE = 10;
const MAX_ATTEMPTS = 6;
// A 429 can ask for a ~60s wait; the cap keeps a pathological hint from stalling
// the run indefinitely.
const MAX_BACKOFF_MS = 90_000;
// One second of mono 16-bit 24kHz PCM is ~48KB. A failed request still returns
// HTTP 200 with a small JSON body, so anything this short is an error, not audio.
const MIN_PCM_BYTES = 5_000;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

export type TtsRequest = {
  contents: { parts: { text: string }[] }[];
  generationConfig: {
    responseModalities: ["AUDIO"];
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
  };
};

export class AuthError extends Error {}
// The per-day quota resets hours away, so there is nothing to retry: the run
// stops and reports rather than sleeping or failing every remaining sentence.
export class DailyQuotaError extends Error {}

export function resolveVoice(
  voices: Voices,
  speaker: string | undefined
): { voice: Voice; mapped: boolean } {
  const mapping = speaker === undefined ? undefined : voices.speakers[speaker];
  return mapping ? { voice: mapping, mapped: true } : { voice: voices.fallback, mapped: false };
}

// Steering is part of the prompt text, not a separate parameter: the model reads
// everything before the colon as direction and everything after as the line.
export function promptedText(voice: Voice, target: string): string {
  return `${voice.prompt}: ${target}`;
}

export function buildRequest(target: string, voice: Voice): TtsRequest {
  return {
    contents: [{ parts: [{ text: promptedText(voice, target) }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.voiceName } } },
    },
  };
}

// Hashes exactly the inputs that determine the audio, so an edited sentence or a
// changed voice/prompt/model regenerates and nothing else does.
export function inputHash(target: string, voice: Voice, model: string): string {
  const inputs = JSON.stringify({ model, voiceName: voice.voiceName, prompt: voice.prompt, target });
  return crypto.createHash("sha256").update(inputs).digest("hex");
}

// TTS output is not deterministic, so an unchanged sentence must reuse its
// existing file: regenerate only when the inputs hash differently, the file is
// gone, or --force.
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

// Speakers used by the content but absent from voices.json. Reported, never
// silently absorbed by the fallback voice.
export function unmappedSpeakers(
  lessons: Lesson[],
  voices: Voices
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

// --- Response handling ------------------------------------------------------

type TtsResponse = {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
};

// A rejected request still comes back HTTP 200 with a small JSON body, so the
// payload is checked for existence and plausible size before anything is written.
export function extractPcm(response: unknown): Buffer {
  const json = response as TtsResponse;
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;

  if (!inline?.data) {
    const reason =
      json.error?.message ??
      json.promptFeedback?.blockReason ??
      `no inlineData in response: ${JSON.stringify(json).slice(0, 300)}`;
    throw new Error(`response contained no audio — ${reason}`);
  }

  const pcm = Buffer.from(inline.data, "base64");
  if (pcm.length < MIN_PCM_BYTES) {
    throw new Error(
      `decoded PCM is implausibly small (${pcm.length} bytes, expected >= ${MIN_PCM_BYTES}) — mimeType "${inline.mimeType ?? "unknown"}"`
    );
  }
  return pcm;
}

// --- ffmpeg -----------------------------------------------------------------

export function requireFfmpeg(): void {
  for (const binary of ["ffmpeg", "ffprobe"]) {
    const probe = spawnSync(binary, ["-version"], { stdio: "ignore" });
    if (probe.error || probe.status !== 0) {
      throw new Error(
        `${binary} is not on PATH. The Gemini TTS API returns raw PCM, so ${binary} is required to produce mp3. Install with: brew install ffmpeg`
      );
    }
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

function runFfmpeg(pcm: Buffer, destination: string, sampleRate: number, channels: number) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-f", "s16le",
      "-ar", String(sampleRate),
      "-ac", String(channels),
      "-i", "pipe:0",
      "-y", destination,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`))
    );

    // EPIPE if ffmpeg died early; the close handler reports the real reason.
    ffmpeg.stdin.on("error", () => {});
    ffmpeg.stdin.end(pcm);
  });
}

// Converted to a temp path and moved only on success, so a failed or interrupted
// run can never leave a zero-byte or truncated mp3 that later looks generated.
export async function pcmToMp3(
  pcm: Buffer,
  destination: string,
  sampleRate: number,
  channels: number
): Promise<number> {
  const temp = `${destination}.part.mp3`;
  try {
    await runFfmpeg(pcm, temp, sampleRate, channels);
    const size = fs.statSync(temp).size;
    if (size === 0) throw new Error("ffmpeg produced a zero-byte file");
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

// A quota 429 states how long to wait, either as a structured RetryInfo detail or
// in the message text. Blind exponential backoff ignores it and gives up early:
// the API may ask for ~60s while doubling from 1s never gets there.
// Go-style durations, as the API emits them: "56.12s", "1m30s", "17h42m36.7s".
export function parseDurationMs(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const seconds =
    Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null;
}

export function parseRetryDelayMs(body: string): number | null {
  try {
    const json = JSON.parse(body) as {
      error?: { details?: { "@type"?: string; retryDelay?: string }[] };
    };
    const info = json.error?.details?.find((d) => d["@type"]?.endsWith("RetryInfo"));
    const hinted = info?.retryDelay ? parseDurationMs(info.retryDelay) : null;
    if (hinted) return hinted;
  } catch {
    // Truncated or non-JSON body — fall through to the text hint.
  }
  const text = body.match(/retry in ([\dhm.]+s)/i)?.[1];
  return text ? parseDurationMs(text) : null;
}

// A per-minute 429 is worth waiting out; a per-day one is not.
export function isDailyQuotaExhausted(body: string): boolean {
  return /per_model_per_day|RequestsPerDay/i.test(body);
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const [h, m] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60)];
  return h > 0 ? `${h}h${m}m` : m > 0 ? `${m}m${total % 60}s` : `${total}s`;
}

// Spaces out request starts so a run stays under the per-minute quota.
let lastRequestAt = 0;
async function pace(minIntervalMs: number): Promise<void> {
  const wait = lastRequestAt + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function synthesize(
  request: TtsRequest,
  model: string,
  apiKey: string,
  minIntervalMs: number
): Promise<Buffer> {
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pace(minIntervalMs);
    const response = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (response.ok) return extractPcm(await response.json());

    const body = (await response.text()).slice(0, 1200);

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(
        `auth failed (HTTP ${response.status}) — check GEMINI_API_KEY in .env.local is a valid key with the Gemini API enabled.\n${body}`
      );
    }
    if (response.status === 404) {
      const voiceName =
        request.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName;
      throw new Error(
        `HTTP 404 — unknown model "${model}" or unknown voiceName "${voiceName}". Voice names are case-sensitive and must be an accepted prebuilt voice.\n${body}`
      );
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`request failed (HTTP ${response.status}): ${body}`);
    }

    if (response.status === 429 && isDailyQuotaExhausted(body)) {
      const resetsIn = parseRetryDelayMs(body);
      const limit = body.match(/limit:\s*(\d+)/)?.[1];
      throw new DailyQuotaError(
        `daily TTS quota exhausted${limit ? ` (limit: ${limit} requests/day)` : ""}` +
          `${resetsIn ? `, resets in ${formatDuration(resetsIn)}` : ""}.`
      );
    }

    const reason = response.status === 429 ? "rate limited" : `HTTP ${response.status}`;
    lastError = `HTTP ${response.status}: ${body}`;
    if (attempt < MAX_ATTEMPTS) {
      const exponential = 1000 * 2 ** (attempt - 1);
      const hinted = parseRetryDelayMs(body) ?? 0;
      // Honour the server's own wait, plus a second of slack so the retry does
      // not land exactly as the window rolls over.
      const backoff = Math.min(
        Math.max(exponential, hinted > 0 ? hinted + 1000 : 0) + Math.floor(Math.random() * 250),
        MAX_BACKOFF_MS
      );
      console.log(
        yellow(
          `    ${reason} — retrying in ${(backoff / 1000).toFixed(1)}s (attempt ${attempt}/${MAX_ATTEMPTS})`
        )
      );
      await sleep(backoff);
    }
  }

  throw new Error(`request failed after ${MAX_ATTEMPTS} attempts — ${lastError}`);
}

// --- Loading ----------------------------------------------------------------

function loadVoices(langDir: string): Voices {
  const voicesPath = path.join(langDir, "voices.json");
  if (!fs.existsSync(voicesPath)) {
    console.error(red(`voices.json not found at ${voicesPath}`));
    process.exit(1);
  }
  const result = VoicesSchema.safeParse(JSON.parse(fs.readFileSync(voicesPath, "utf-8")));
  if (!result.success) {
    console.error(red(`voices.json schema error: ${result.error.message}`));
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
  const rpmFlagIdx = argv.indexOf("--rpm");
  const rpm =
    rpmFlagIdx !== -1 ? Number.parseInt(argv[rpmFlagIdx + 1], 10) : DEFAULT_REQUESTS_PER_MINUTE;

  if (!lessonId && !all) {
    console.error(
      red("usage: npm run audio -- --lesson <lessonId> | --all [--force] [--rpm <n>]")
    );
    process.exit(1);
  }
  if (!Number.isFinite(rpm) || rpm <= 0) {
    console.error(red(`--rpm must be a positive number (got "${argv[rpmFlagIdx + 1]}")`));
    process.exit(1);
  }
  const minIntervalMs = Math.ceil(60_000 / rpm);

  requireFfmpeg();

  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(red("GEMINI_API_KEY is not set — add it to .env.local"));
    process.exit(1);
  }

  const langDir = path.join(CONTENT_ROOT, "lv");
  const audioDir = path.join(langDir, "audio");
  const manifestPath = path.join(audioDir, "manifest.json");
  fs.mkdirSync(audioDir, { recursive: true });

  const voices = loadVoices(langDir);
  const { model, sampleRate, channels } = voices.defaults;
  const allLessons = loadLessons(path.join(langDir, "lessons"));
  const manifest = loadManifest(manifestPath);

  const unmapped = unmappedSpeakers(allLessons, voices);
  if (unmapped.length > 0) {
    console.log(bold("\nSpeakers with no voice mapping (using fallback voice):"));
    for (const { speaker, count, examples } of unmapped) {
      console.log(
        yellow(
          `  ${speaker} — ${count} sentence(s), fallback "${voices.fallback.voiceName}": ${examples.join(", ")}`
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
  let remaining = 0;
  let quotaBlocked = "";
  const failures: string[] = [];
  const misnamed: string[] = [];

  for (const lesson of targets) {
    console.log(bold(`\n=== ${lesson.lessonId} ===`));

    for (const sentence of lessonSentences(lesson)) {
      const expected = expectedAudioName(lesson.lessonId, sentence.id);
      if (sentence.audio !== expected) {
        misnamed.push(
          `${lesson.lessonId}/${sentence.id}: audio "${sentence.audio}" (expected "${expected}")`
        );
      }

      const filename = sentence.audio;
      const destination = path.join(audioDir, filename);
      const { voice } = resolveVoice(voices, sentence.speaker);
      const hash = inputHash(sentence.target, voice, model);

      const existing = manifest[filename];
      if (!shouldRegenerate(existing, hash, fs.existsSync(destination), force)) {
        skipped++;
        console.log(`  skip     ${filename} (${existing!.durationSeconds}s, unchanged)`);
        continue;
      }

      if (quotaBlocked) {
        remaining++;
        continue;
      }

      try {
        const pcm = await synthesize(
          buildRequest(sentence.target, voice),
          model,
          apiKey,
          minIntervalMs
        );
        const durationSeconds = await pcmToMp3(pcm, destination, sampleRate, channels);
        manifest[filename] = {
          hash,
          voice: voice.voiceName,
          durationSeconds,
          generatedAt: new Date().toISOString(),
        };
        writeManifest(manifestPath, manifest);
        generated++;
        console.log(
          green(
            `  wrote    ${filename} (${voice.voiceName}, ${durationSeconds}s, ${fs.statSync(destination).size} bytes)`
          )
        );
      } catch (error) {
        if (error instanceof AuthError) {
          console.error(red(`\n${error.message}`));
          console.error(red("\nAborting: every request would fail the same way."));
          process.exit(1);
        }
        if (error instanceof DailyQuotaError) {
          quotaBlocked = error.message;
          remaining++;
          console.error(red(`  QUOTA    ${filename} — ${error.message}`));
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${filename}: ${message}`);
        console.error(red(`  FAILED   ${filename} — ${message}`));
      }
    }
  }

  const files = fs.readdirSync(audioDir).filter((f) => f.endsWith(".mp3"));
  const totalBytes = files.reduce((sum, f) => sum + fs.statSync(path.join(audioDir, f)).size, 0);

  console.log(bold("\n=== Summary ==="));
  console.log(`  generated: ${generated}`);
  console.log(`  skipped:   ${skipped}`);
  console.log(`  failed:    ${failures.length}`);
  if (remaining > 0) console.log(yellow(`  remaining: ${remaining} (quota)`));
  console.log(`  audio dir: ${files.length} mp3, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (quotaBlocked) {
    console.log(yellow(`\n  ${quotaBlocked}`));
    console.log(
      yellow(`  ${remaining} sentence(s) not attempted. Re-run this command after the reset —`)
    );
    console.log(yellow("  completed sentences are skipped, so it resumes where it stopped."));
  }

  if (misnamed.length > 0) {
    console.log(yellow(`\n  audio filenames not matching <lessonId>-<sentenceId>.mp3 (not renamed):`));
    misnamed.forEach((m) => console.log(yellow(`    ${m}`)));
  }
  if (failures.length > 0) {
    console.log(red("\n  failures:"));
    failures.forEach((f) => console.log(red(`    ${f}`)));
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/generate-audio.ts") ||
    process.argv[1].endsWith("/generate-audio.js"));

if (isMain) {
  main().catch((error) => {
    console.error(red(`\n${error instanceof Error ? error.stack : String(error)}`));
    process.exit(1);
  });
}
