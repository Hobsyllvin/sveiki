import fs from "fs";
import path from "path";
import crypto from "crypto";
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
const TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1beta1/text:synthesize";
const REQUEST_DELAY_MS = 250;
const MAX_ATTEMPTS = 5;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

export type SynthesisRequest = {
  input: { text: string; prompt: string };
  voice: { languageCode: string; modelName: string; name: string };
  audioConfig: { audioEncoding: "MP3"; speakingRate: number; pitch: number };
};

export class AuthError extends Error {}

export function resolveVoice(
  voices: Voices,
  speaker: string | undefined
): { voice: Voice; mapped: boolean } {
  const mapping = speaker === undefined ? undefined : voices.speakers[speaker];
  return mapping ? { voice: mapping, mapped: true } : { voice: voices.fallback, mapped: false };
}

// The request body IS the hash input: text, voice, prompt and audioConfig all
// live in it, so any change that would alter the audio changes the hash.
export function buildRequest(target: string, voice: Voice, voices: Voices): SynthesisRequest {
  const { languageCode, modelName, audioEncoding, speakingRate, pitch } = voices.defaults;
  return {
    input: { text: target, prompt: voice.prompt },
    voice: { languageCode, modelName, name: voice.name },
    audioConfig: { audioEncoding, speakingRate, pitch },
  };
}

export function inputHash(request: SynthesisRequest): string {
  return crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
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
    .map(([speaker, where]) => ({
      speaker,
      count: where.length,
      examples: where.slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count);
}

// --- MP3 duration -----------------------------------------------------------
// Frame-header parsing rather than a decoder or ffmpeg: durations are summed
// per frame, so VBR output is measured correctly. Returning null means "no
// decodable frames", which is also how a truncated download is caught.

const L3_BITRATES_MPEG1 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const L3_BITRATES_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

function id3v2Size(buffer: Buffer): number {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "ID3") return 0;
  const size =
    (buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9];
  const footer = (buffer[5] & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

export function mp3DurationSeconds(buffer: Buffer): number | null {
  let offset = id3v2Size(buffer);
  let seconds = 0;
  let frames = 0;

  while (offset + 4 <= buffer.length) {
    const [b0, b1, b2] = [buffer[offset], buffer[offset + 1], buffer[offset + 2]];
    const isSync = b0 === 0xff && (b1 & 0xe0) === 0xe0;
    const version = (b1 >> 3) & 0x03;
    const layer = (b1 >> 1) & 0x03;
    const bitrateIndex = (b2 >> 4) & 0x0f;
    const sampleRateIndex = (b2 >> 2) & 0x03;

    if (!isSync || version === 1 || layer !== 1 || sampleRateIndex === 3) {
      offset++;
      continue;
    }

    const bitrate =
      (version === 3 ? L3_BITRATES_MPEG1 : L3_BITRATES_MPEG2)[bitrateIndex] * 1000;
    const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
    if (bitrate === 0) {
      offset++;
      continue;
    }

    const samplesPerFrame = version === 3 ? 1152 : 576;
    const padding = (b2 >> 1) & 0x01;
    const frameLength = Math.floor((samplesPerFrame / 8) * (bitrate / sampleRate)) + padding;
    if (frameLength <= 0) {
      offset++;
      continue;
    }

    seconds += samplesPerFrame / sampleRate;
    frames++;
    offset += frameLength;
  }

  return frames === 0 ? null : Math.round(seconds * 1000) / 1000;
}

// --- Synthesis --------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function authMessage(status: number, body: string): string {
  const blocked = body.includes("API_KEY_SERVICE_BLOCKED");
  const disabled = body.includes("has not been used in project") || body.includes("SERVICE_DISABLED");
  const hint = blocked
    ? "The key is restricted and does not allow texttospeech.googleapis.com — add Cloud Text-to-Speech API to the key's API restrictions in the Google Cloud console."
    : disabled
      ? "The Cloud Text-to-Speech API is not enabled for this project — enable it in the Google Cloud console."
      : "Check that GOOGLE_TTS_API_KEY in .env.local is a valid, unexpired key for a project with Cloud Text-to-Speech enabled.";
  return `TTS auth failed (HTTP ${status}). ${hint}\n${body}`;
}

async function synthesize(request: SynthesisRequest, apiKey: string): Promise<Buffer> {
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(`${TTS_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (response.ok) {
      const json = (await response.json()) as { audioContent?: string };
      if (!json.audioContent) throw new Error("TTS response contained no audioContent");
      const buffer = Buffer.from(json.audioContent, "base64");
      if (buffer.length === 0) throw new Error("TTS returned zero bytes of audio");
      return buffer;
    }

    const body = (await response.text()).slice(0, 800);

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(authMessage(response.status, body));
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`TTS request failed (HTTP ${response.status}): ${body}`);
    }

    lastError = `HTTP ${response.status}: ${body}`;
    if (attempt < MAX_ATTEMPTS) {
      const backoff = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      console.log(yellow(`    retrying in ${backoff}ms (attempt ${attempt}/${MAX_ATTEMPTS}) — ${lastError}`));
      await sleep(backoff);
    }
  }

  throw new Error(`TTS request failed after ${MAX_ATTEMPTS} attempts — ${lastError}`);
}

// Written to a temp path and moved on success, so an interrupted or truncated
// download can never leave a half-written mp3 that later looks generated.
function writeAudio(destination: string, buffer: Buffer): number {
  const duration = mp3DurationSeconds(buffer);
  if (duration === null) {
    throw new Error(
      `refusing to write ${path.basename(destination)}: ${buffer.length} bytes contain no decodable MP3 frames`
    );
  }
  const temp = `${destination}.part`;
  fs.writeFileSync(temp, buffer);
  fs.renameSync(temp, destination);
  return duration;
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

  if (!lessonId && !all) {
    console.error(red("usage: npm run audio -- --lesson <lessonId> | --all [--force]"));
    process.exit(1);
  }

  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    console.error(red("GOOGLE_TTS_API_KEY is not set — add it to .env.local"));
    process.exit(1);
  }

  const langDir = path.join(CONTENT_ROOT, "lv");
  const audioDir = path.join(langDir, "audio");
  const manifestPath = path.join(audioDir, "manifest.json");
  fs.mkdirSync(audioDir, { recursive: true });

  const voices = loadVoices(langDir);
  const allLessons = loadLessons(path.join(langDir, "lessons"));
  const manifest = loadManifest(manifestPath);

  const unmapped = unmappedSpeakers(allLessons, voices);
  if (unmapped.length > 0) {
    console.log(bold("\nSpeakers with no voice mapping (using fallback voice):"));
    for (const { speaker, count, examples } of unmapped) {
      console.log(
        yellow(
          `  ${speaker} — ${count} sentence(s), fallback "${voices.fallback.name}": ${examples.join(", ")}`
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
  const failures: string[] = [];
  const misnamed: string[] = [];

  for (const lesson of targets) {
    console.log(bold(`\n=== ${lesson.lessonId} ===`));

    for (const sentence of lessonSentences(lesson)) {
      const expected = expectedAudioName(lesson.lessonId, sentence.id);
      if (sentence.audio !== expected) {
        misnamed.push(`${lesson.lessonId}/${sentence.id}: audio "${sentence.audio}" (expected "${expected}")`);
      }

      const filename = sentence.audio;
      const destination = path.join(audioDir, filename);
      const { voice } = resolveVoice(voices, sentence.speaker);
      const request = buildRequest(sentence.target, voice, voices);
      const hash = inputHash(request);

      const existing = manifest[filename];
      if (!shouldRegenerate(existing, hash, fs.existsSync(destination), force)) {
        skipped++;
        console.log(`  skip     ${filename} (${existing!.durationSeconds}s, unchanged)`);
        continue;
      }

      try {
        const buffer = await synthesize(request, apiKey);
        const durationSeconds = writeAudio(destination, buffer);
        manifest[filename] = {
          hash,
          voice: voice.name,
          durationSeconds,
          generatedAt: new Date().toISOString(),
        };
        writeManifest(manifestPath, manifest);
        generated++;
        console.log(
          green(`  wrote    ${filename} (${voice.name}, ${durationSeconds}s, ${buffer.length} bytes)`)
        );
      } catch (error) {
        if (error instanceof AuthError) {
          console.error(red(`\n${error.message}`));
          console.error(red("\nAborting: every request would fail the same way."));
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
  console.log(`  audio dir: ${files.length} mp3, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

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
