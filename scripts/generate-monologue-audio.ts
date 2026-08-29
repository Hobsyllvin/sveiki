import fs from "fs";
import path from "path";
import { z } from "zod";
import { DialogueVoicesSchema, LessonSchema } from "../src/lib/content/schema";
import type { AudioTimings } from "../src/lib/content/schema";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps";
const OUTPUT_FORMAT = "mp3_44100_128";
const MIN_MP3_BYTES = 1_000;

const AlignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});

const ResponseSchema = z.object({
  audio_base64: z.string().min(1),
  alignment: AlignmentSchema.nullable(),
  normalized_alignment: AlignmentSchema.nullable().optional(),
});

type Alignment = z.infer<typeof AlignmentSchema>;

function fail(message: string): never {
  throw new Error(message);
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function flag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index !== -1 ? (argv[index + 1] ?? null) : null;
}

function alignmentForText(text: string, alignment: Alignment): AudioTimings["sentences"] {
  if (alignment.characters.length !== alignment.character_start_times_seconds.length ||
      alignment.characters.length !== alignment.character_end_times_seconds.length) {
    fail("ElevenLabs returned misaligned character timing arrays");
  }
  const normalized = alignment.characters.join("");
  if (normalized !== text) {
    fail(
      `ElevenLabs alignment does not match the submitted text (returned ${normalized.length} characters, submitted ${text.length})`
    );
  }
  return {};
}

function sentenceTimings(text: string, sentences: { id: string; text: string }[], alignment: Alignment): AudioTimings["sentences"] {
  alignmentForText(text, alignment);
  const result: AudioTimings["sentences"] = {};
  let offset = 0;
  for (const sentence of sentences) {
    const start = offset;
    const end = offset + sentence.text.length;
    const starts = alignment.character_start_times_seconds.slice(start, end);
    const ends = alignment.character_end_times_seconds.slice(start, end);
    if (starts.length !== sentence.text.length || ends.length !== sentence.text.length) {
      fail(`no usable character timings returned for ${sentence.id}`);
    }
    result[sentence.id] = {
      start: Math.round(Math.min(...starts) * 1000) / 1000,
      end: Math.round(Math.max(...ends) * 1000) / 1000,
    };
    offset = end + 1;
  }
  return result;
}

async function request(text: string, voiceId: string, modelId: string, languageCode: string, apiKey: string) {
  const response = await fetch(API_URL.replace("{voice_id}", voiceId), {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: modelId, language_code: languageCode, output_format: OUTPUT_FORMAT }),
  });
  if (!response.ok) fail(`request failed (HTTP ${response.status}): ${(await response.text()).slice(0, 800)}`);
  const parsed = ResponseSchema.safeParse(await response.json());
  if (!parsed.success) fail(`unexpected response shape: ${parsed.error.message}`);
  if (!parsed.data.alignment) fail("ElevenLabs returned usable audio but no sentence-capable alignment");
  return parsed.data;
}

async function main() {
  const argv = process.argv.slice(2);
  const lessonId = flag(argv, "--lesson");
  if (!lessonId) fail("usage: npm run audio-monologue -- --lesson <lessonId> [--probe]");
  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) fail("ELEVENLABS_API_KEY is not set — add it to .env.local");

  const lang = lessonId.split("-")[0];
  const langDir = path.join(CONTENT_ROOT, lang);
  const lesson = LessonSchema.parse(JSON.parse(fs.readFileSync(path.join(langDir, "lessons", `${lessonId}.json`), "utf8")));
  const voices = DialogueVoicesSchema.parse(JSON.parse(fs.readFileSync(path.join(langDir, "voices.json"), "utf8")));
  const sentences = lesson.sections.flatMap((section) => section.sentences).map((sentence) => ({ id: sentence.id, text: sentence.target }));
  const voiceId = voices.speakers["Emma"];
  if (!voiceId) fail("Emma has no voice mapping");

  if (argv.includes("--probe")) {
    const text = sentences[0].text;
    const result = await request(text, voiceId, voices.model_id, voices.language_code, apiKey);
    const timings = sentenceTimings(text, [sentences[0]], result.alignment!);
    const audio = Buffer.from(result.audio_base64, "base64");
    if (audio.length < MIN_MP3_BYTES) fail(`probe audio is only ${audio.length} bytes`);
    console.log(`probe passed: ${audio.length} bytes, timing ${timings.s1.start.toFixed(3)}–${timings.s1.end.toFixed(3)}s`);
    return;
  }

  const text = sentences.map((sentence) => sentence.text).join(" ");
  const result = await request(text, voiceId, voices.model_id, voices.language_code, apiKey);
  const timings: AudioTimings = { audio: `${lessonId}.mp3`, sentences: sentenceTimings(text, sentences, result.alignment!) };
  const outputDir = path.join(langDir, "audio");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `${lessonId}.mp3`), Buffer.from(result.audio_base64, "base64"));
  writeJson(path.join(outputDir, `${lessonId}.timings.json`), timings);
  writeJson(path.join(outputDir, `${lessonId}.alignment.json`), result.alignment);
  const duration = Math.max(...Object.values(timings.sentences).map((timing) => timing.end));
  console.log(`wrote ${lessonId}: ${duration.toFixed(2)}s, ${sentences.length} sentence timings`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
