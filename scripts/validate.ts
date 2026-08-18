import fs from "fs";
import path from "path";
import { LessonSchema, DictionarySchema, CourseSchema } from "../src/lib/content/schema";
import type { Lesson, Dictionary, Course } from "../src/lib/content/schema";

const CONTENT_ROOT = path.join(process.cwd(), "content");

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

type CheckResult = { pass: boolean; messages: string[]; warnings?: string[] };

function allTokens(lessons: Lesson[]) {
  return lessons.flatMap((lesson) =>
    lesson.sections.flatMap((section) =>
      section.sentences.flatMap((sentence) =>
        sentence.tokens.map((token) => ({
          lessonId: lesson.lessonId,
          sentenceId: sentence.id,
          token,
        }))
      )
    )
  );
}

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

// Exact reconstruction: target must equal tokens' (lv + punct) joined by single
// spaces, whitespace-normalized. Punctuation attaches to the token it follows
// (see GLOSSING_RULES.md); a free-standing em dash is represented as a leading
// space on `punct` (e.g. "saku" + " —"), since the join already supplies the
// space before the next token.
export function checkTokenization(lesson: Lesson): CheckResult {
  const messages: string[] = [];
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

  for (const section of lesson.sections) {
    for (const sentence of section.sentences) {
      const reconstructed = sentence.tokens
        .map((t) => t.lv + (t.punct ?? ""))
        .join(" ");
      const normalizedTarget = normalize(sentence.target);
      const normalizedReconstructed = normalize(reconstructed);
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

// Rule 1a — a lesson's own newLemmas must agree with course.json's list for it.
// Compared as sets: the two files order their lists differently by convention.
export function checkNewLemmasMatchCourse(lesson: Lesson, course: Course): CheckResult {
  const entry = course.lessons.find((l) => l.lessonId === lesson.lessonId);
  if (!entry) {
    return {
      pass: false,
      messages: [`  newLemmas: lesson "${lesson.lessonId}" not found in course.json`],
    };
  }
  const declared = new Set(entry.newLemmas ?? []);
  const own = new Set(lesson.newLemmas);
  const onlyLesson = [...own].filter((l) => !declared.has(l));
  const onlyCourse = [...declared].filter((l) => !own.has(l));

  const messages: string[] = [];
  if (onlyLesson.length > 0) {
    messages.push(
      `  newLemmas [${lesson.lessonId}]: declared in the lesson file but not in course.json: ${onlyLesson.join(", ")}`
    );
  }
  if (onlyCourse.length > 0) {
    messages.push(
      `  newLemmas [${lesson.lessonId}]: declared in course.json but not in the lesson file: ${onlyCourse.join(", ")}`
    );
  }
  return { pass: messages.length === 0, messages };
}

// Rule 1b — no lemma may be introduced as new twice in the course.
export function checkNoDuplicateDeclarations(course: Course): CheckResult {
  const firstSeen = new Map<string, string>();
  const messages: string[] = [];
  for (const entry of course.lessons) {
    for (const lemma of entry.newLemmas ?? []) {
      const earlier = firstSeen.get(lemma);
      if (earlier) {
        messages.push(
          `  newLemmas: "${lemma}" declared new in ${entry.lessonId} but already introduced in ${earlier}`
        );
      } else {
        firstSeen.set(lemma, entry.lessonId);
      }
    }
  }
  return { pass: messages.length === 0, messages };
}

// A dictionary note containing "=" is the course's marker that the entry
// documents sense selection (e.g. `cik ilgi = how long; cik + adj./adv. = how`).
// Rules 2 and 3 both key off it, so the two stay consistent by construction.
function declaresSenses(dictionary: Dictionary, lemma: string): boolean {
  return (dictionary[lemma]?.note ?? "").includes("=");
}

// Rule 2 — course-wide gloss uniqueness.
//
// Scoped to a single surface form rather than the whole lemma. The whole-lemma
// version fires on every inflection-driven gloss difference the method requires
// (`Rīga` -> Riga/in-Riga, `kūka` -> cake/cakes, `tu` -> you/to-you): 14 lemmas
// on current content, all legitimate. One surface form glossed two ways is the
// actual defect class — the same word rendered with two different English words.
// Exempt when the dictionary note declares sense selection, which is how a
// genuinely ambiguous form (`vai` -> whether/or) stays legal.
export function checkGlossUniqueness(lessons: Lesson[], dictionary: Dictionary): CheckResult {
  const byForm = new Map<string, { gloss: string; where: string }[]>();
  for (const { lessonId, sentenceId, token } of allTokens(lessons)) {
    const key = `${token.lemma} ${token.lv.toLowerCase()}`;
    if (!byForm.has(key)) byForm.set(key, []);
    byForm.get(key)!.push({ gloss: token.gloss, where: `${lessonId}/${sentenceId}` });
  }

  const messages: string[] = [];
  for (const [key, uses] of byForm) {
    const [lemma, form] = key.split(" ");
    const glosses = [...new Set(uses.map((u) => u.gloss))];
    if (glosses.length < 2) continue;
    if (declaresSenses(dictionary, lemma)) continue;
    const detail = glosses
      .map((g) => `"${g}" (${uses.filter((u) => u.gloss === g).map((u) => u.where).join(", ")})`)
      .join(" vs ");
    messages.push(
      `  gloss uniqueness: lemma "${lemma}" form "${form}" glossed ${glosses.length} ways — ${detail}. ` +
        `Pick one, or document the distinct senses in the dictionary note.`
    );
  }
  return { pass: messages.length === 0, messages };
}

// Rule 3 — sense-selection disclosure.
//
// If a lemma has several approved glosses AND its note declares sense selection,
// every token must state which sense it picked. Warning-only for now: the note
// granularity it asks for (44 bare nominative `es` tokens) is deferred until
// after the native-speaker review. Promote to an error once that pass lands.
export function checkSenseDisclosure(lessons: Lesson[], dictionary: Dictionary): CheckResult {
  const warnings: string[] = [];
  const tokens = allTokens(lessons);
  for (const [lemma, entry] of Object.entries(dictionary)) {
    if (entry.glosses.length < 2) continue;
    if (!declaresSenses(dictionary, lemma)) continue;
    const undisclosed = tokens.filter((t) => t.token.lemma === lemma && !t.token.note);
    if (undisclosed.length === 0) continue;
    const shown = undisclosed
      .slice(0, 3)
      .map((t) => `${t.lessonId}/${t.sentenceId} "${t.token.lv}"`)
      .join(", ");
    const more = undisclosed.length > 3 ? ` (+${undisclosed.length - 3} more)` : "";
    warnings.push(
      `  sense disclosure: lemma "${lemma}" has ${entry.glosses.length} approved glosses and a note declaring senses, ` +
        `but ${undisclosed.length} token(s) carry no note: ${shown}${more}`
    );
  }
  return { pass: true, messages: [], warnings };
}

// Warning-only recycling report: a lemma taught once and never met again is
// unlikely to stick. Reports; changes nothing.
export function checkRecycling(lessons: Lesson[]): CheckResult {
  const counts = new Map<string, number>();
  for (const { token } of allTokens(lessons)) {
    counts.set(token.lemma, (counts.get(token.lemma) ?? 0) + 1);
  }
  const once = [...counts.entries()]
    .filter(([, n]) => n === 1)
    .map(([lemma]) => lemma)
    .sort();
  if (once.length === 0) return { pass: true, messages: [], warnings: [] };
  return {
    pass: true,
    messages: [],
    warnings: [
      `  recycling: ${once.length} of ${counts.size} lemmas appear exactly once across ${lessons.length} lesson(s) — ` +
        `never recycled: ${once.join(", ")}`,
    ],
  };
}

export function findLanguageDirs(contentRoot: string): string[] {
  return fs
    .readdirSync(contentRoot)
    .filter((d) => !d.startsWith("_"))
    .map((d) => path.join(contentRoot, d))
    .filter((d) => fs.statSync(d).isDirectory())
    .filter((d) => fs.existsSync(path.join(d, "course.json")));
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

function report(checks: CheckResult[]): boolean {
  let passed = true;
  for (const check of checks) {
    check.messages.forEach((m) => console.log(red(m)));
    (check.warnings ?? []).forEach((w) => console.log(yellow(w)));
    if (!check.pass) passed = false;
  }
  return passed;
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

  const passed = report([
    checkTokenization(lesson),
    checkDictionary(lesson, dictionary),
    checkVocabularyCoverage(lesson, course),
    checkNewLemmasMatchCourse(lesson, course),
    checkMorphology(lesson),
  ]);

  if (passed) {
    console.log(green(`  PASS: ${lessonId}`));
  } else {
    console.log(red(`  FAIL: ${lessonId}`));
  }
  return passed;
}

// Course-wide checks need every lesson, so they run once per language rather
// than per lesson — and on the full set even when --lesson narrows the per-lesson run.
function validateCourseWide(lessons: Lesson[], dictionary: Dictionary, course: Course): boolean {
  console.log(bold(`\nCourse-wide checks...`));
  const passed = report([
    checkNoDuplicateDeclarations(course),
    checkGlossUniqueness(lessons, dictionary),
    checkSenseDisclosure(lessons, dictionary),
    checkRecycling(lessons),
  ]);
  console.log(passed ? green(`  PASS: course-wide`) : red(`  FAIL: course-wide`));
  return passed;
}

function main() {
  // Parse --lesson <id> flag
  const lessonFlagIdx = process.argv.indexOf("--lesson");
  const singleLessonId = lessonFlagIdx !== -1 ? process.argv[lessonFlagIdx + 1] : null;

  let allPassed = true;

  const langDirs = findLanguageDirs(CONTENT_ROOT);

  for (const langDir of langDirs) {
    const lang = path.basename(langDir);
    console.log(bold(`\n=== Language: ${lang} ===`));

    const course = loadCourse(langDir);
    const dictionary = loadDictionary(langDir);

    const lessonsDir = path.join(langDir, "lessons");
    if (!fs.existsSync(lessonsDir)) continue;

    const allLessonFiles = fs
      .readdirSync(lessonsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(lessonsDir, f));

    let lessonFiles = allLessonFiles;
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

    // Course-wide checks see every lesson, including ones --lesson filtered out.
    // Schema-invalid files are skipped here; validateLessonFile already failed them.
    const parsedLessons = allLessonFiles
      .map((f) => LessonSchema.safeParse(JSON.parse(fs.readFileSync(f, "utf-8"))))
      .filter((r) => r.success)
      .map((r) => r.data as Lesson);

    if (!validateCourseWide(parsedLessons, dictionary, course)) allPassed = false;
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
