import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { DialogueVoicesSchema, LessonSchema } from "../src/lib/content/schema";
import type { DialogueVoices, Lesson, Sentence } from "../src/lib/content/schema";

// One request per lesson: the whole scene is generated as a single take so
// voice, pacing, and prosody carry across every speaker turn.
const CONTENT_ROOT = path.join(process.cwd(), "content");
const API_URL = "https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps";
const OUTPUT_FORMAT = "mp3_44100_128";
const MAX_DIALOGUE_CHARS = 2_000;
const MIN_MP3_BYTES = 20_000;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const ScriptLineSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().min(1),
  text: z.string().min(1),
});

export type ScriptLine = z.infer<typeof ScriptLineSchema>;

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

type DialogueResponse = z.infer<typeof ResponseSchema>;

export type Timings = {
  audio: string;
  sentences: Record<string, { start: number; end: number }>;
};

export function lessonSentences(lesson: Lesson): Sentence[] {
  return lesson.sections.flatMap((section) => section.sentences);
}

// `s12 | Emma | [surprised] Ko?` — speaker and delivery tags live here,
// never in lesson JSON.
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

// The script only adds delivery tags. Any content drift would label the wrong
// audio with the lesson's sentence IDs, so it must stop generation.
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
  sentences.forEach((sentence, index) => {
    const line = script[index];
    if (!line) {
      problems.push(`${sentence.id}: missing from script`);
      return;
    }
    if (line.id !== sentence.id) {
      problems.push(
        `position ${index + 1}: script has ${line.id}, lesson has ${sentence.id}`
      );
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
        `${sentence.id}: text differs from target (case aside)\n` +
          `      script: ${JSON.stringify(stripped)}\n` +
          `      target: ${JSON.stringify(sentence.target)}`
      );
    }
  });
  return problems;
}

export function resolveVoices(
  script: ScriptLine[],
  voices: DialogueVoices
): { text: string; voice_id: string }[] {
  const missing = [...new Set(script.map((line) => line.speaker))].filter(
    (speaker) => !voices.speakers[speaker]
  );
  if (missing.length > 0) {
    throw new Error(
      `no voice_id in content/lv/voices.json for speaker(s): ${missing.join(", ")}\n` +
        `  mapped speakers: ${Object.keys(voices.speakers).join(", ")}`
    );
  }
  return script.map((line) => ({
    text: line.text,
    voice_id: voices.speakers[line.speaker],
  }));
}

export function dialogueCharacterCount(
  inputs: { text: string; voice_id: string }[]
): number {
  return inputs.reduce((total, input) => total + input.text.length, 0);
}

// A stable seed makes repeated generations of an unchanged lesson more
// reproducible. ElevenLabs still treats determinism as best effort.
export function lessonSeed(name: string): number {
  return Number.parseInt(
    crypto.createHash("sha256").update(name).digest("hex").slice(0, 8),
    16
  );
}

// One input can come back as several segments, so a sentence spans from its
// earliest segment start to its latest segment end.
export function buildTimings(
  audioName: string,
  script: ScriptLine[],
  segments: DialogueResponse["voice_segments"]
): Timings {
  const sentences: Timings["sentences"] = {};
  for (const segment of segments) {
    const line = script[segment.dialogue_input_index];
    if (!line) {
      throw new Error(
        `response references dialogue_input_index ${segment.dialogue_input_index}, ` +
          `but only ${script.length} input(s) were sent`
      );
    }
    const existing = sentences[line.id];
    sentences[line.id] = existing
      ? {
          start: Math.min(existing.start, segment.start_time_seconds),
          end: Math.max(existing.end, segment.end_time_seconds),
        }
      : {
          start: segment.start_time_seconds,
          end: segment.end_time_seconds,
        };
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
  throw new Error(message);
}

function readJson<T>(filePath: string, schema: z.ZodType<T>, label: string): T {
  if (!fs.existsSync(filePath)) fail(`${label} not found at ${filePath}`);
  const result = schema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  if (!result.success) fail(`${label} schema error: ${result.error.message}`);
  return result.data;
}

async function generate(
  inputs: { text: string; voice_id: string }[],
  voices: DialogueVoices,
  apiKey: string,
  seed: number
): Promise<DialogueResponse> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs,
      model_id: voices.model_id,
      language_code: voices.language_code,
      output_format: OUTPUT_FORMAT,
      seed,
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

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function flag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index !== -1 ? (argv[index + 1] ?? null) : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const lessonId = flag(argv, "--lesson");
  const scriptArg = flag(argv, "--script");
  if (!lessonId && !scriptArg) {
    fail("usage: npm run audio -- --lesson <lessonId> | --script <path to .md>");
  }

  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) fail("ELEVENLABS_API_KEY is not set — add it to .env.local");

  const lang = lessonId?.split("-")[0] ?? "lv";
  const langDir = path.join(CONTENT_ROOT, lang);
  const audioRoot = path.join(langDir, "audio");
  const outputDir = audioRoot;
  const voices = readJson(
    path.join(langDir, "voices.json"),
    DialogueVoicesSchema,
    "voices.json"
  );

  // --script is for scratch scripts that are not lesson content.
  const name = lessonId ?? path.basename(scriptArg!, ".md");
  const scriptPath = lessonId
    ? path.join(langDir, "audio-scripts", `${lessonId}.md`)
    : scriptArg!;
  if (!fs.existsSync(scriptPath)) fail(`audio script not found at ${scriptPath}`);
  const script = parseScript(fs.readFileSync(scriptPath, "utf-8"));

  if (lessonId) {
    const lesson = readJson(
      path.join(langDir, "lessons", `${lessonId}.json`),
      LessonSchema,
      `lesson ${lessonId}`
    );
    const problems = checkScriptAgainstLesson(script, lessonSentences(lesson));
    if (problems.length > 0) {
      fail(`audio script does not match ${lessonId}:\n  ${problems.join("\n  ")}`);
    }
  }

  const inputs = resolveVoices(script, voices);
  const characterCount = dialogueCharacterCount(inputs);
  if (characterCount > MAX_DIALOGUE_CHARS) {
    fail(
      `${name} contains ${characterCount} dialogue characters; ElevenLabs recommends no more ` +
        `than ${MAX_DIALOGUE_CHARS} in one Text-to-Dialogue request`
    );
  }

  const seed = lessonSeed(name);
  console.log(
    bold(
      `\n${name} — one coherent take, ${inputs.length} inputs, ${characterCount} characters, ` +
        `model ${voices.model_id}, seed ${seed}`
    )
  );

  const result = await generate(inputs, voices, apiKey, seed);
  const audioName = `${name}.mp3`;
  const mp3 = Buffer.from(result.audio_base64, "base64");
  if (mp3.length < MIN_MP3_BYTES) {
    fail(`decoded audio is only ${mp3.length} bytes — too small to be a full scene`);
  }

  const timings = buildTimings(audioName, script, result.voice_segments);
  const absent = missingTimings(script, timings);
  if (absent.length > 0) fail(`no timing returned for: ${absent.join(", ")}`);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, audioName), mp3);
  writeJson(path.join(outputDir, `${name}.timings.json`), timings);
  writeJson(path.join(outputDir, `${name}.alignment.json`), result.alignment);

  // Corrections are measured against a particular take. Keep them visible, but
  // warn because they must be reviewed after every new full-lesson generation.
  const editsPath = path.join(outputDir, `${name}.timings.edits.json`);
  if (fs.existsSync(editsPath)) {
    const edited = Object.keys(
      (JSON.parse(fs.readFileSync(editsPath, "utf-8")) as { sentences?: object })
        .sentences ?? {}
    ).length;
    console.log(
      yellow(
        `\n  ${path.basename(editsPath)} still holds ${edited} corrected boundary set(s) from ` +
          `the previous take. Recheck them with: npm run timings -- --lesson ${name}`
      )
    );
  }

  const duration = Math.max(...Object.values(timings.sentences).map((timing) => timing.end));
  console.log(
    green(
      `  wrote ${path.relative(process.cwd(), path.join(outputDir, audioName))} — ` +
        `${(mp3.length / 1024 / 1024).toFixed(2)} MB`
    )
  );
  console.log(green(`  wrote ${name}.timings.json — ${script.length} sentences`));
  console.log(green(`  wrote ${name}.alignment.json`));
  console.log(bold(`  spoken duration: ${duration.toFixed(2)}s`));
  if (lessonId) {
    console.log("  audioApproved stays false — Christian reviews before approval.");
  }
  console.log("");
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
