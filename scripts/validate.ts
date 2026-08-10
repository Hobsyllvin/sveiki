import fs from "fs";
import path from "path";
import { LessonSchema, DictionarySchema, CourseSchema } from "../src/lib/content/schema";
import type { Lesson, Dictionary, Course } from "../src/lib/content/schema";

const CONTENT_ROOT = path.join(process.cwd(), "content");

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

type CheckResult = { pass: boolean; messages: string[] };

function checkSchema(lessonPath: string): CheckResult {
  const raw = JSON.parse(fs.readFileSync(lessonPath, "utf-8"));
  const result = LessonSchema.safeParse(raw);
  if (!result.success) {
    return {
      pass: false,
      messages: result.error.issues.map((i) => `  schema: ${i.path.join(".")} — ${i.message}`),
    };
  }
  return { pass: true, messages: [] };
}

function checkTokenization(lesson: Lesson): CheckResult {
  const messages: string[] = [];
  const strip = (s: string) => s.replace(/[.?!,]/g, "").trim();

  for (const section of lesson.sections) {
    for (const sentence of section.sentences) {
      const reconstructed = sentence.tokens.map((t) => t.lv).join(" ");
      const normalizedTarget = strip(sentence.target);
      const normalizedReconstructed = strip(reconstructed);
      if (normalizedTarget !== normalizedReconstructed) {
        messages.push(
          `  tokenization [${sentence.id}]: tokens reconstruct to "${normalizedReconstructed}" but target is "${normalizedTarget}"`
        );
      }
    }
  }
  return { pass: messages.length === 0, messages };
}

function checkDictionary(lesson: Lesson, dictionary: Dictionary): CheckResult {
  const messages: string[] = [];

  for (const section of lesson.sections) {
    for (const sentence of section.sentences) {
      for (const token of sentence.tokens) {
        const entry = dictionary[token.lemma];
        if (!entry) {
          messages.push(
            `  dictionary [${sentence.id}] token "${token.lv}": lemma "${token.lemma}" missing entirely → new lemma, needs review`
          );
        } else if (!entry.glosses.includes(token.gloss)) {
          messages.push(
            `  dictionary [${sentence.id}] token "${token.lv}": gloss "${token.gloss}" not approved for lemma "${token.lemma}" (approved: ${entry.glosses.join(", ")})`
          );
        }
      }
    }
  }
  return { pass: messages.length === 0, messages };
}

export function checkVocabularyCoverage(lesson: Lesson, course: Course): CheckResult {
  const lessonIndex = course.lessons.findIndex((l) => l.lessonId === lesson.lessonId);
  if (lessonIndex === -1) {
    return {
      pass: false,
      messages: [`  vocab coverage: lesson "${lesson.lessonId}" not found in course.json`],
    };
  }

  // Build allowed set: union of newLemmas from lessons 0..N-1 plus this lesson's own newLemmas.
  const allowedLemmas = new Set<string>();
  for (let i = 0; i <= lessonIndex; i++) {
    for (const lemma of course.lessons[i].newLemmas ?? []) {
      allowedLemmas.add(lemma);
    }
  }

  // Also build a lookup: which lesson first introduces each lemma
  const lemmaIntroducedIn: Record<string, string> = {};
  for (const entry of course.lessons) {
    for (const lemma of entry.newLemmas ?? []) {
      if (!(lemma in lemmaIntroducedIn)) {
        lemmaIntroducedIn[lemma] = entry.lessonId;
      }
    }
  }

  const messages: string[] = [];
  for (const section of lesson.sections) {
    for (const sentence of section.sentences) {
      for (const token of sentence.tokens) {
        if (!allowedLemmas.has(token.lemma)) {
          const introducedIn = lemmaIntroducedIn[token.lemma];
          const where = introducedIn
            ? `introduced in ${introducedIn}`
            : "never introduced in course.json";
          messages.push(
            `  vocab coverage [${sentence.id}] token "${token.lv}": lemma "${token.lemma}" not in allowed set (${where})`
          );
        }
      }
    }
  }
  return { pass: messages.length === 0, messages };
}

function checkMorphology(_lesson: Lesson): CheckResult {
  // TODO: integrate Tēzaurs morphology analyzer
  // Intended backends: api.tezaurs.lv and github.com/PeterisP/morphology
  console.log(yellow("  morphology: skipped — Tēzaurs/analyzer integration pending"));
  return { pass: true, messages: [] };
}

function checkRecycling(_lesson: Lesson): CheckResult {
  // TODO: warning-only; will report lemmas not reused within 3 lessons
  console.log(yellow("  recycling report: skipped — needs multi-lesson window"));
  return { pass: true, messages: [] };
}

function loadDictionary(langDir: string): Dictionary {
  const dictPath = path.join(langDir, "dictionary.json");
  const raw = JSON.parse(fs.readFileSync(dictPath, "utf-8"));
  const result = DictionarySchema.safeParse(raw);
  if (!result.success) {
    console.error(red(`dictionary.json schema error: ${result.error.message}`));
    process.exit(1);
  }
  return result.data;
}

function loadCourse(langDir: string): Course {
  const coursePath = path.join(langDir, "course.json");
  const raw = JSON.parse(fs.readFileSync(coursePath, "utf-8"));
  const result = CourseSchema.safeParse(raw);
  if (!result.success) {
    console.error(red(`course.json schema error: ${result.error.message}`));
    process.exit(1);
  }
  return result.data;
}

function validateLessonFile(
  lessonPath: string,
  dictionary: Dictionary,
  course: Course
): boolean {
  const lessonId = path.basename(lessonPath, ".json");
  console.log(bold(`\nValidating ${lessonId}...`));

  const schemaResult = checkSchema(lessonPath);
  if (!schemaResult.pass) {
    schemaResult.messages.forEach((m) => console.log(red(m)));
    console.log(red(`  FAIL: ${lessonId}`));
    return false;
  }

  const lesson = JSON.parse(fs.readFileSync(lessonPath, "utf-8")) as Lesson;

  const checks: CheckResult[] = [
    checkTokenization(lesson),
    checkDictionary(lesson, dictionary),
    checkVocabularyCoverage(lesson, course),
    checkMorphology(lesson),
    checkRecycling(lesson),
  ];

  let passed = true;
  for (const check of checks) {
    if (!check.pass) {
      check.messages.forEach((m) => console.log(red(m)));
      passed = false;
    }
  }

  if (passed) {
    console.log(green(`  PASS: ${lessonId}`));
  } else {
    console.log(red(`  FAIL: ${lessonId}`));
  }
  return passed;
}

function main() {
  // Parse --lesson <id> flag
  const lessonFlagIdx = process.argv.indexOf("--lesson");
  const singleLessonId = lessonFlagIdx !== -1 ? process.argv[lessonFlagIdx + 1] : null;

  let allPassed = true;

  const langDirs = fs
    .readdirSync(CONTENT_ROOT)
    .filter((d) => !d.startsWith("_"))
    .map((d) => path.join(CONTENT_ROOT, d))
    .filter((d) => fs.statSync(d).isDirectory());

  for (const langDir of langDirs) {
    const lang = path.basename(langDir);
    console.log(bold(`\n=== Language: ${lang} ===`));

    const course = loadCourse(langDir);
    const dictionary = loadDictionary(langDir);

    const lessonsDir = path.join(langDir, "lessons");
    if (!fs.existsSync(lessonsDir)) continue;

    let lessonFiles = fs
      .readdirSync(lessonsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(lessonsDir, f));

    if (singleLessonId) {
      lessonFiles = lessonFiles.filter(
        (f) => path.basename(f, ".json") === singleLessonId
      );
      if (lessonFiles.length === 0) {
        console.error(red(`  lesson "${singleLessonId}" not found in ${lessonsDir}`));
        process.exit(1);
      }
    }

    for (const lessonPath of lessonFiles) {
      const passed = validateLessonFile(lessonPath, dictionary, course);
      if (!passed) allPassed = false;
    }
  }

  console.log(allPassed ? green("\n✓ All checks passed") : red("\n✗ Validation failed"));
  process.exit(allPassed ? 0 : 1);
}

// Only run when invoked directly (not when imported by tests)
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/validate.ts") || process.argv[1].endsWith("/validate.js"));

if (isMain) {
  main();
}
