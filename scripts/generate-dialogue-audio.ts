import fs from "fs";
import path from "path";
import { z } from "zod";
import { LessonSchema, DialogueVoicesSchema } from "../src/lib/content/schema";
import type { Lesson, Sentence, DialogueVoices } from "../src/lib/content/schema";

// One request per lesson: the whole scene is generated as a single take so
// prosody carries across speaker turns. Sentence-level playback then comes from
// the timings the API returns, not from separate clips.
const CONTENT_ROOT = path.join(process.cwd(), "content");
const API_URL = "https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps";
const OUTPUT_FORMAT = "mp3_44100_128";
// A whole lesson is tens of seconds of speech; anything this small is an error
// body or a truncated stream, not a scene.
const MIN_MP3_BYTES = 20_000;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const ScriptLineSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().min(1),
  text: z.string().min(1),
});

type ScriptLine = z.infer<typeof ScriptLineSchema>;

const AlignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});

const ResponseSchema = z.object({
  audio_base64: z.string().min(1),
  alignment: AlignmentSchema,
  voice_segments: z
    .array(
      z.object({
        dialogue_input_index: z.number().int().nonnegative(),
        start_time_seconds: z.number(),
        end_time_seconds: z.number(),
      })
    )
    .min(1),
});

export type Timings = { audio: string; sentences: Record<string, { start: number; end: number }> };

export function lessonSentences(lesson: Lesson): Sentence[] {
  return lesson.sections.flatMap((section) => section.sentences);
}

// `s12 | Anna | [surprised] Ko?` — speaker and tags live here, never in lesson JSON.
export function parseScript(markdown: string): ScriptLine[] {
  const lines = markdown.split("\n").filter((line) => /^s\d+\s*\|/.test(line));
  return lines.map((line) => {
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

// The script exists only to add delivery tags. If it has drifted from the lesson
// — reordered, reworded, re-punctuated — the timings would label the wrong audio,
// so the mismatch has to stop the run.
export function checkScriptAgainstLesson(script: ScriptLine[], sentences: Sentence[]): string[] {
  const problems: string[] = [];
  if (script.length !== sentences.length) {
    problems.push(`script has ${script.length} line(s), lesson has ${sentences.length} sentence(s)`);
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
      problems.push(`${sentence.id}: speaker "${line.speaker}" but lesson says "${sentence.speaker}"`);
    }
    const stripped = stripTags(line.text);
    if (stripped !== sentence.target) {
      problems.push(
        `${sentence.id}: text differs from target\n      script: ${JSON.stringify(stripped)}\n      target: ${JSON.stringify(sentence.target)}`
      );
    }
  });
  return problems;
}

export function resolveVoices(
  script: ScriptLine[],
  voices: DialogueVoices
): { text: string; voice_id: string }[] {
  const missing = [...new Set(script.map((l) => l.speaker))].filter((s) => !voices.speakers[s]);
  if (missing.length > 0) {
    throw new Error(
      `no voice_id in content/lv/voices.json for speaker(s): ${missing.join(", ")}\n` +
        `  mapped speakers: ${Object.keys(voices.speakers).join(", ")}`
    );
  }
  return script.map((line) => ({ text: line.text, voice_id: voices.speakers[line.speaker] }));
}

// One input can come back as several segments when a voice is interrupted or the
// model splits a long turn, so a sentence spans from its first start to its last end.
export function buildTimings(
  audioName: string,
  script: ScriptLine[],
  segments: z.infer<typeof ResponseSchema>["voice_segments"]
): Timings {
  const sentences: Timings["sentences"] = {};
  for (const segment of segments) {
    const line = script[segment.dialogue_input_index];
    if (!line) {
      throw new Error(
        `response references dialogue_input_index ${segment.dialogue_input_index}, but only ${script.length} input(s) were sent`
      );
    }
    const existing = sentences[line.id];
    sentences[line.id] = existing
      ? {
          start: Math.min(existing.start, segment.start_time_seconds),
          end: Math.max(existing.end, segment.end_time_seconds),
        }
      : { start: segment.start_time_seconds, end: segment.end_time_seconds };
  }
  const rounded = Object.fromEntries(
    script
      .filter((line) => sentences[line.id])
      .map((line) => [
        line.id,
        {
          start: Math.round(sentences[line.id].start * 1000) / 1000,
          end: Math.round(sentences[line.id].end * 1000) / 1000,
        },
      ])
  );
  return { audio: audioName, sentences: rounded };
}

export function missingTimings(script: ScriptLine[], timings: Timings): string[] {
  return script.filter((line) => !timings.sentences[line.id]).map((line) => line.id);
}

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

async function generate(
  inputs: { text: string; voice_id: string }[],
  voices: DialogueVoices,
  apiKey: string
): Promise<z.infer<typeof ResponseSchema>> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs,
      model_id: voices.model_id,
      language_code: voices.language_code,
      output_format: OUTPUT_FORMAT,
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 800);
    fail(`request failed (HTTP ${response.status}): ${body}`);
  }

  const parsed = ResponseSchema.safeParse(await response.json());
  if (!parsed.success) fail(`unexpected response shape: ${parsed.error.message}`);
  return parsed.data;
}

async function main() {
  const argv = process.argv.slice(2);
  const lessonFlagIdx = argv.indexOf("--lesson");
  const lessonId = lessonFlagIdx !== -1 ? argv[lessonFlagIdx + 1] : null;
  if (!lessonId) fail("usage: npm run audio -- --lesson <lessonId>");

  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) fail("ELEVENLABS_API_KEY is not set — add it to .env.local");

  const langDir = path.join(CONTENT_ROOT, "lv");
  const audioDir = path.join(langDir, "audio");
  const lessonPath = path.join(langDir, "lessons", `${lessonId}.json`);
  const scriptPath = path.join(langDir, "audio-scripts", `${lessonId}.md`);

  const lesson = loadJson(lessonPath, LessonSchema, `lesson ${lessonId}`);
  const voices = loadJson(path.join(langDir, "voices.json"), DialogueVoicesSchema, "voices.json");
  if (!fs.existsSync(scriptPath)) fail(`audio script not found at ${scriptPath}`);
  const script = parseScript(fs.readFileSync(scriptPath, "utf-8"));

  const problems = checkScriptAgainstLesson(script, lessonSentences(lesson));
  if (problems.length > 0) {
    fail(`audio script does not match ${lessonId}:\n  ${problems.join("\n  ")}`);
  }

  const inputs = resolveVoices(script, voices);
  console.log(
    bold(`\n${lessonId} — ${inputs.length} inputs, model ${voices.model_id}, format ${OUTPUT_FORMAT}`)
  );

  const result = await generate(inputs, voices, apiKey);

  const audioName = `${lessonId}.mp3`;
  const mp3 = Buffer.from(result.audio_base64, "base64");
  if (mp3.length < MIN_MP3_BYTES) {
    fail(`decoded audio is only ${mp3.length} bytes — too small to be a full scene`);
  }

  const timings = buildTimings(audioName, script, result.voice_segments);
  const absent = missingTimings(script, timings);
  if (absent.length > 0) fail(`no timing returned for: ${absent.join(", ")}`);

  fs.mkdirSync(audioDir, { recursive: true });
  fs.writeFileSync(path.join(audioDir, audioName), mp3);
  fs.writeFileSync(
    path.join(audioDir, `${lessonId}.timings.json`),
    `${JSON.stringify(timings, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(audioDir, `${lessonId}.alignment.json`),
    `${JSON.stringify(result.alignment, null, 2)}\n`
  );

  const duration = Math.max(...Object.values(timings.sentences).map((t) => t.end));
  console.log(green(`  wrote ${audioName} — ${(mp3.length / 1024 / 1024).toFixed(2)} MB`));
  console.log(green(`  wrote ${lessonId}.timings.json — ${Object.keys(timings.sentences).length} sentences`));
  console.log(green(`  wrote ${lessonId}.alignment.json — ${result.alignment.characters.length} characters`));
  console.log(bold(`\n  total duration: ${duration.toFixed(2)}s`));
  console.log("  audioApproved stays false — Christian reviews before approval.\n");
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/generate-dialogue-audio.ts") ||
    process.argv[1].endsWith("/generate-dialogue-audio.js"));

if (isMain) {
  main().catch((error) => {
    console.error(red(`\n${error instanceof Error ? error.stack : String(error)}`));
    process.exit(1);
  });
}
