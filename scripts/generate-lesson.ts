/**
 * generate-lesson.ts
 * Usage: npm run generate -- --lesson lv-a1-01 [--force]
 *
 * Calls the Anthropic API to draft a lesson JSON, validates it, writes it to
 * content/lv/lessons/<id>.json.  Refuses to overwrite an existing file
 * without --force.
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { CourseSchema, DictionarySchema, LessonSchema } from "../src/lib/content/schema";

// Model constant — change here to switch globally.
const GENERATION_MODEL = "claude-fable-5";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const LESSONS_DIR = (lang: string) =>
  path.join(CONTENT_ROOT, lang, "lessons");
const GLOSSING_RULES_PATH = path.join(
  CONTENT_ROOT,
  "_shared",
  "GLOSSING_RULES.md"
);

function parseArgs() {
  const args = process.argv.slice(2);
  const lessonIdx = args.indexOf("--lesson");
  if (lessonIdx === -1 || !args[lessonIdx + 1]) {
    console.error("Usage: npm run generate -- --lesson <id> [--force]");
    process.exit(1);
  }
  return {
    lessonId: args[lessonIdx + 1],
    force: args.includes("--force"),
  };
}

function loadFile(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

function inferLang(lessonId: string): string {
  return lessonId.split("-")[0];
}

function buildPrompt(opts: {
  glossingRules: string;
  lessonEntry: { lessonId: string; theme: string; cefr: string; newLemmas?: string[] };
  knownLemmas: string[];
  dictionary: Record<string, { glosses: string[]; note?: string }>;
  fixtureLesson: string;
}): string {
  const { glossingRules, lessonEntry, knownLemmas, dictionary, fixtureLesson } = opts;
  const newLemmas = lessonEntry.newLemmas ?? [];

  return `You are drafting lesson content for a Latvian language learning app that uses the Birkenbihl decoding method.

## GLOSSING RULES (authoritative — follow exactly)

${glossingRules}

## LESSON TO GENERATE

Lesson ID: ${lessonEntry.lessonId}
Theme: ${lessonEntry.theme}
CEFR level: ${lessonEntry.cefr}

### New lemmas introduced in this lesson (${newLemmas.length} total)
${newLemmas.join(", ")}

### Cumulative known lemmas (available from prior lessons — use freely)
${knownLemmas.length > 0 ? knownLemmas.join(", ") : "(none — this is the first lesson)"}

### Approved dictionary (lemma → glosses)
${JSON.stringify(dictionary, null, 2)}

## WORKED EXAMPLE (match this structure exactly)

${fixtureLesson}

## TASK

Generate a complete lesson JSON for ${lessonEntry.lessonId}.

Requirements:
1. **Vocabulary budget**: every content word's lemma must be either in the "new lemmas" list above OR in the "cumulative known lemmas" list.  If an idea cannot be expressed within that budget, simplify the sentence — do NOT reach for unlisted lemmas.
2. **Length**: 10–14 sentences total, spread across 2–3 sections.
3. **Sections**: mix "dialogue" and "drill" formats.  Dialogue sections MUST have "speaker" fields on each sentence (e.g. "Pēteris", "Anna").  Drill sections do NOT have speaker fields.
4. **Immersion**: make the content genuinely interesting and natural — a real scene, not a word list.  Sentences should flow as a coherent mini-story or conversation.
5. **Glossing**: follow GLOSSING_RULES.md exactly for every token.  Each token's "gloss" must match the approved glosses in the dictionary for that lemma.  For lemmas NOT yet in the dictionary (new lemmas from this lesson), propose a gloss consistent with the rules — it will be added to the dictionary after human review.
6. **Notes**: include concise telegraphic notes (case, verb form) where helpful.
7. **Audio**: set all "audio" fields to the pattern "${lessonEntry.lessonId}-<sentenceId>.mp3" and all "audioApproved" to false.
8. **POS tags**: the only valid values for the "pos" field are exactly: "noun", "verb", "adj", "adv", "pron", "prep", "conj", "propn", "num", "part", "interj".  Use "interj" (not "intj") for interjections.
9. **Schema**: output must be valid JSON matching the lesson schema (lessonId, title, cefr, newLemmas, sections → sentences → tokens).  No extra fields, no markdown, no explanation — pure JSON only.

Output ONLY the lesson JSON object, nothing else.`;
}

async function main() {
  const { lessonId, force } = parseArgs();
  const lang = inferLang(lessonId);
  const langDir = path.join(CONTENT_ROOT, lang);
  const outPath = path.join(LESSONS_DIR(lang), `${lessonId}.json`);

  if (fs.existsSync(outPath) && !force) {
    console.error(
      `${outPath} already exists. Use --force to overwrite.`
    );
    process.exit(1);
  }

  // Load course
  const courseRaw = JSON.parse(loadFile(path.join(langDir, "course.json")));
  const course = CourseSchema.parse(courseRaw);
  const lessonEntry = course.lessons.find((l) => l.lessonId === lessonId);
  if (!lessonEntry) {
    console.error(`Lesson "${lessonId}" not found in course.json`);
    process.exit(1);
  }

  // Build cumulative known lemmas (all lessons that come BEFORE this one)
  const lessonIndex = course.lessons.findIndex((l) => l.lessonId === lessonId);
  const knownLemmas: string[] = [];
  for (let i = 0; i < lessonIndex; i++) {
    for (const lemma of course.lessons[i].newLemmas ?? []) {
      if (!knownLemmas.includes(lemma)) knownLemmas.push(lemma);
    }
  }

  // Load dictionary
  const dictRaw = JSON.parse(loadFile(path.join(langDir, "dictionary.json")));
  const dictionary = DictionarySchema.parse(dictRaw);

  // Load fixture lesson (first lesson — lv-a1-00 or equivalent)
  const fixtureLessonId = course.lessons[0].lessonId;
  const fixturePath = path.join(LESSONS_DIR(lang), `${fixtureLessonId}.json`);
  const fixtureLesson = loadFile(fixturePath);

  // Load glossing rules
  const glossingRules = loadFile(GLOSSING_RULES_PATH);

  const prompt = buildPrompt({
    glossingRules,
    lessonEntry,
    knownLemmas,
    dictionary,
    fixtureLesson,
  });

  console.log(`Generating lesson ${lessonId} with model ${GENERATION_MODEL}...`);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 16000,
    // Fable 5: thinking is always on; use medium effort for structured generation,
    // display summarized so thinking tokens don't silently consume the budget.
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: prompt }],
  } as Parameters<typeof client.messages.create>[0]);

  console.log(`Stop reason: ${response.stop_reason}`);
  console.log(`Content blocks: ${response.content.length}`);

  if (response.stop_reason === "refusal") {
    console.error("Model refused the request (safety classifier).");
    process.exit(1);
  }

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Strip potential markdown fences
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  // Always dump raw to tmp for inspection
  fs.writeFileSync("/tmp/generated-lesson-raw.txt", rawText);
  fs.writeFileSync("/tmp/generated-lesson-stripped.txt", jsonText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    console.error("Model output is not valid JSON:");
    console.error("--- first 800 chars of stripped output ---");
    console.error(jsonText.slice(0, 800));
    console.error("--- last 200 chars ---");
    console.error(jsonText.slice(-200));
    console.error("Raw output saved to /tmp/generated-lesson-raw.txt");
    process.exit(1);
  }

  const result = LessonSchema.safeParse(parsed);
  if (!result.success) {
    console.error("Generated lesson failed schema validation:");
    result.error.issues.forEach((i) =>
      console.error(`  ${i.path.join(".")} — ${i.message}`)
    );
    console.error("\nRaw output saved to /tmp/generated-lesson-raw.json for inspection.");
    fs.writeFileSync("/tmp/generated-lesson-raw.json", JSON.stringify(parsed, null, 2));
    process.exit(1);
  }

  if (result.data.lessonId !== lessonId) {
    console.error(
      `Generated lessonId "${result.data.lessonId}" does not match requested "${lessonId}"`
    );
    process.exit(1);
  }

  fs.mkdirSync(LESSONS_DIR(lang), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result.data, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);

  // Run validator
  console.log("\nRunning validator...");
  const { execSync } = await import("child_process");
  try {
    const out = execSync(
      `npm run validate -- --lesson ${lessonId} 2>&1`,
      { encoding: "utf-8" }
    );
    console.log(out);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "stdout" in e) {
      console.log((e as { stdout: string }).stdout);
    }
    console.error("Validation failed — review the output above.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
