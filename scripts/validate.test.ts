import { describe, it, expect } from "vitest";
import { LessonSchema, CourseSchema } from "../src/lib/content/schema";
import type { Lesson, Dictionary, Course } from "../src/lib/content/schema";
import fs from "fs";
import path from "path";
import { checkVocabularyCoverage } from "./validate";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "content/lv/lessons/lv-a1-00.json"
);
const DICTIONARY_PATH = path.join(process.cwd(), "content/lv/dictionary.json");
const COURSE_PATH = path.join(process.cwd(), "content/lv/course.json");

function loadFixture(): Lesson {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"));
}

function loadDictionary(): Dictionary {
  return JSON.parse(fs.readFileSync(DICTIONARY_PATH, "utf-8"));
}

function loadCourse(): Course {
  return JSON.parse(fs.readFileSync(COURSE_PATH, "utf-8"));
}

function checkTokenization(lesson: Lesson): string[] {
  const messages: string[] = [];
  const strip = (s: string) => s.replace(/[.?!,]/g, "").trim();
  for (const section of lesson.sections) {
    for (const sentence of section.sentences) {
      const reconstructed = sentence.tokens.map((t) => t.lv).join(" ");
      if (strip(sentence.target) !== strip(reconstructed)) {
        messages.push(`[${sentence.id}] tokenization mismatch`);
      }
    }
  }
  return messages;
}

function checkDictionary(lesson: Lesson, dictionary: Dictionary): string[] {
  const messages: string[] = [];
  for (const section of lesson.sections) {
    for (const sentence of section.sentences) {
      for (const token of sentence.tokens) {
        const entry = dictionary[token.lemma];
        if (!entry) {
          messages.push(`[${sentence.id}] lemma "${token.lemma}" missing`);
        } else if (!entry.glosses.includes(token.gloss)) {
          messages.push(
            `[${sentence.id}] gloss "${token.gloss}" not approved for "${token.lemma}"`
          );
        }
      }
    }
  }
  return messages;
}

describe("validate fixture lesson", () => {
  it("passes schema check", () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"));
    const result = LessonSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it("passes tokenization check", () => {
    const lesson = loadFixture();
    expect(checkTokenization(lesson)).toEqual([]);
  });

  it("passes dictionary check", () => {
    const lesson = loadFixture();
    const dictionary = loadDictionary();
    expect(checkDictionary(lesson, dictionary)).toEqual([]);
  });

  it("passes vocabulary coverage check (check 4)", () => {
    const lesson = loadFixture();
    const course = loadCourse();
    const result = checkVocabularyCoverage(lesson, course);
    expect(result.pass).toBe(true);
    expect(result.messages).toEqual([]);
  });
});

describe("broken lesson: wrong gloss", () => {
  it("fails dictionary check (check 3)", () => {
    const lesson = loadFixture();
    // Corrupt the first token's gloss to something not in the dictionary
    const badLesson: Lesson = {
      ...lesson,
      sections: lesson.sections.map((sec, si) =>
        si === 0
          ? {
              ...sec,
              sentences: sec.sentences.map((sent, seni) =>
                seni === 0
                  ? {
                      ...sent,
                      tokens: sent.tokens.map((tok, ti) =>
                        ti === 0 ? { ...tok, gloss: "INVALID_GLOSS" } : tok
                      ),
                    }
                  : sent
              ),
            }
          : sec
      ),
    };
    const dictionary = loadDictionary();
    const errors = checkDictionary(badLesson, dictionary);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/INVALID_GLOSS/);
  });
});

describe("broken lesson: missing token", () => {
  it("fails tokenization check (check 2)", () => {
    const lesson = loadFixture();
    // Remove the first token from the first sentence — reconstruction won't match target
    const badLesson: Lesson = {
      ...lesson,
      sections: lesson.sections.map((sec, si) =>
        si === 0
          ? {
              ...sec,
              sentences: sec.sentences.map((sent, seni) =>
                seni === 0
                  ? { ...sent, tokens: sent.tokens.slice(1) }
                  : sent
              ),
            }
          : sec
      ),
    };
    const errors = checkTokenization(badLesson);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("vocab coverage check (check 4)", () => {
  it("fails when a token uses a lemma not introduced in any lesson", () => {
    const lesson = loadFixture();
    const course = loadCourse();
    // Inject a token with a lemma that is not in any lesson's newLemmas
    const badLesson: Lesson = {
      ...lesson,
      sections: lesson.sections.map((sec, si) =>
        si === 0
          ? {
              ...sec,
              sentences: sec.sentences.map((sent, seni) =>
                seni === 0
                  ? {
                      ...sent,
                      tokens: [
                        ...sent.tokens,
                        {
                          lv: "GHOST_WORD",
                          gloss: "ghost",
                          lemma: "ghost_lemma_never_introduced",
                          pos: "noun" as const,
                        },
                      ],
                    }
                  : sent
              ),
            }
          : sec
      ),
    };
    const result = checkVocabularyCoverage(badLesson, course);
    expect(result.pass).toBe(false);
    expect(result.messages[0]).toMatch(/never introduced/);
    expect(result.messages[0]).toMatch(/ghost_lemma_never_introduced/);
  });

  it("fails when a token uses a lemma introduced only in a later lesson", () => {
    const lesson = loadFixture();
    // Build a course where the fixture lesson is lesson 0,
    // and a second lesson introduces a lemma "future_lemma".
    // Then test a lesson that uses "future_lemma" but is ALSO lesson 0.
    const courseWithFutureLemma: Course = {
      ...loadCourse(),
      lessons: [
        {
          lessonId: "lv-a1-00",
          theme: "first sentences",
          cefr: "A1",
          newLemmas: ["es", "tu", "viņa", "kur", "dzīvot", "gribēt", "pirkt", "iet", "mazgāties", "maize", "darbs", "rīts", "Rīga", "uz", "no"],
        },
        {
          lessonId: "lv-a1-01",
          theme: "greetings",
          cefr: "A1",
          newLemmas: ["future_lemma"],
        },
      ],
    };
    // Inject a token using future_lemma into the lv-a1-00 lesson
    const badLesson: Lesson = {
      ...lesson,
      sections: lesson.sections.map((sec, si) =>
        si === 0
          ? {
              ...sec,
              sentences: sec.sentences.map((sent, seni) =>
                seni === 0
                  ? {
                      ...sent,
                      tokens: [
                        ...sent.tokens,
                        {
                          lv: "FUTURE",
                          gloss: "future",
                          lemma: "future_lemma",
                          pos: "noun" as const,
                        },
                      ],
                    }
                  : sent
              ),
            }
          : sec
      ),
    };
    const result = checkVocabularyCoverage(badLesson, courseWithFutureLemma);
    expect(result.pass).toBe(false);
    expect(result.messages[0]).toMatch(/future_lemma/);
    expect(result.messages[0]).toMatch(/lv-a1-01/);
  });

  it("passes for lv-a1-01 when it only uses its own newLemmas plus lv-a1-00 lemmas", () => {
    // Simulate a two-lesson course and a lesson-01 that only uses cumulative allowed lemmas
    const twoLessonCourse: Course = CourseSchema.parse({
      language: "lv",
      languageName: "Latvian",
      glossLanguage: "en",
      glossingRules: "../_shared/GLOSSING_RULES.md",
      lessons: [
        {
          lessonId: "lv-a1-00",
          theme: "first sentences",
          cefr: "A1",
          newLemmas: ["es", "tu"],
        },
        {
          lessonId: "lv-a1-01",
          theme: "greetings",
          cefr: "A1",
          newLemmas: ["sveiki"],
        },
      ],
    });
    // A lesson-01 that uses lemmas from lesson-00 AND lesson-01's own newLemmas
    const goodLesson: Lesson = {
      lessonId: "lv-a1-01",
      title: "Sveiki",
      cefr: "A1",
      newLemmas: ["sveiki"],
      sections: [
        {
          format: "drill",
          title: "Sveicieni",
          sentences: [
            {
              id: "s1",
              target: "Sveiki.",
              tokens: [
                { lv: "Sveiki", gloss: "hello", lemma: "sveiki", pos: "interj" },
              ],
              natural: "Hello.",
              audio: "lv-a1-01-s1.mp3",
              audioApproved: false,
            },
            {
              id: "s2",
              target: "Es tu.",
              tokens: [
                { lv: "Es", gloss: "I", lemma: "es", pos: "pron" },
                { lv: "tu", gloss: "you", lemma: "tu", pos: "pron" },
              ],
              natural: "Me, you.",
              audio: "lv-a1-01-s2.mp3",
              audioApproved: false,
            },
          ],
        },
      ],
    };
    const result = checkVocabularyCoverage(goodLesson, twoLessonCourse);
    expect(result.pass).toBe(true);
  });
});
