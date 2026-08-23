import { describe, it, expect } from "vitest";
import { LessonSchema, CourseSchema } from "../src/lib/content/schema";
import type { Lesson, Dictionary, Course } from "../src/lib/content/schema";
import fs from "fs";
import path from "path";
import {
  checkVocabularyCoverage,
  checkTokenization,
  findLanguageDirs,
  checkNewLemmasMatchCourse,
  checkNoDuplicateDeclarations,
  checkGlossUniqueness,
  checkSenseDisclosure,
  checkRecycling,
  checkAudioCoverage,
} from "./validate";
import os from "os";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "content/lv/lessons/lv-a1-01.json"
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
    const result = checkTokenization(lesson);
    expect(result.pass).toBe(true);
    expect(result.messages).toEqual([]);
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
    const result = checkTokenization(badLesson);
    expect(result.pass).toBe(false);
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

describe("tokenization check (check 2): punctuation", () => {
  it("passes when punct fields reconstruct sentence-final and internal punctuation exactly", () => {
    const lesson: Lesson = {
      lessonId: "lv-a1-00",
      title: "Test",
      cefr: "A1",
      newLemmas: ["kur", "tu", "dzīvot"],
      sections: [
        {
          format: "drill",
          title: "T",
          sentences: [
            {
              id: "s1",
              target: "Kur tu dzīvo?",
              tokens: [
                { lv: "Kur", gloss: "where", lemma: "kur", pos: "adv" },
                { lv: "tu", gloss: "you", lemma: "tu", pos: "pron" },
                { lv: "dzīvo", gloss: "live", lemma: "dzīvot", pos: "verb", punct: "?" },
              ],
              natural: "Where do you live?",
              audio: "lv-a1-00-s1.mp3",
              audioApproved: false,
            },
          ],
        },
      ],
    };
    const result = checkTokenization(lesson);
    expect(result.pass).toBe(true);
    expect(result.messages).toEqual([]);
  });

  it("passes for a free-standing em dash represented as a leading space on punct", () => {
    const lesson: Lesson = {
      lessonId: "lv-a1-00",
      title: "Test",
      cefr: "A1",
      newLemmas: ["es", "tu", "teikt", "tas", "būt", "fantastisks"],
      sections: [
        {
          format: "dialogue",
          title: "T",
          sentences: [
            {
              id: "s1",
              target: "Es tev saku — tās ir fantastiskas.",
              tokens: [
                { lv: "Es", gloss: "I", lemma: "es", pos: "pron" },
                { lv: "tev", gloss: "to-you", lemma: "tu", pos: "pron", note: "dat." },
                { lv: "saku", gloss: "say", lemma: "teikt", pos: "verb", note: "1sg pres.", punct: " —" },
                { lv: "tās", gloss: "those", lemma: "tas", pos: "pron", note: "demonstr." },
                { lv: "ir", gloss: "are", lemma: "būt", pos: "verb" },
                { lv: "fantastiskas", gloss: "fantastic", lemma: "fantastisks", pos: "adj", punct: "." },
              ],
              natural: "I'm telling you — they're fantastic.",
              audio: "lv-a1-00-s1.mp3",
              audioApproved: false,
            },
          ],
        },
      ],
    };
    const result = checkTokenization(lesson);
    expect(result.pass).toBe(true);
    expect(result.messages).toEqual([]);
  });

  it("fails when punct is missing from a token that has trailing punctuation in target", () => {
    const lesson: Lesson = {
      lessonId: "lv-a1-00",
      title: "Test",
      cefr: "A1",
      newLemmas: ["kur", "tu", "dzīvot"],
      sections: [
        {
          format: "drill",
          title: "T",
          sentences: [
            {
              id: "s1",
              target: "Kur tu dzīvo?",
              tokens: [
                { lv: "Kur", gloss: "where", lemma: "kur", pos: "adv" },
                { lv: "tu", gloss: "you", lemma: "tu", pos: "pron" },
                { lv: "dzīvo", gloss: "live", lemma: "dzīvot", pos: "verb" },
              ],
              natural: "Where do you live?",
              audio: "lv-a1-00-s1.mp3",
              audioApproved: false,
            },
          ],
        },
      ],
    };
    const result = checkTokenization(lesson);
    expect(result.pass).toBe(false);
    expect(result.messages[0]).toMatch(/dzīvo.*dzīvo\?/);
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
    // Build a course where the fixture lesson is lesson 0 and declares every
    // lemma it uses, so the only coverage error can be the injected one, and a
    // second lesson introduces "future_lemma" too late to be allowed.
    const fixtureLemmas = [
      ...new Set(
        lesson.sections.flatMap((s) => s.sentences).flatMap((s) => s.tokens.map((t) => t.lemma))
      ),
    ];
    const courseWithFutureLemma: Course = {
      ...loadCourse(),
      lessons: [
        {
          lessonId: lesson.lessonId,
          theme: "fixture",
          cefr: "A1",
          newLemmas: fixtureLemmas,
        },
        {
          lessonId: "lv-a1-01",
          theme: "greetings",
          cefr: "A1",
          newLemmas: ["future_lemma"],
        },
      ],
    };
    // Inject a token using future_lemma into the fixture lesson
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

describe("findLanguageDirs", () => {
  it("skips underscore dirs, files, and dirs without course.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "valoda-langdirs-"));

    fs.mkdirSync(path.join(root, "lv"));
    fs.writeFileSync(path.join(root, "lv", "course.json"), "{}");
    fs.mkdirSync(path.join(root, "_shared"));
    fs.writeFileSync(path.join(root, "_shared", "course.json"), "{}");
    fs.mkdirSync(path.join(root, "drafts"));
    fs.writeFileSync(path.join(root, "drafts", "lv-a1-01.md"), "# draft");
    fs.writeFileSync(path.join(root, "README.md"), "not a dir");

    expect(findLanguageDirs(root)).toEqual([path.join(root, "lv")]);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds the real lv content dir without throwing on sibling draft dirs", () => {
    const dirs = findLanguageDirs(path.join(process.cwd(), "content"));
    expect(dirs).toContain(path.join(process.cwd(), "content", "lv"));
  });
});

// ---------------------------------------------------------------------------
// Phase 3 rules. Each exists because a real defect passed the previous gate.
// ---------------------------------------------------------------------------

type TokenSpec = { lv: string; gloss: string; lemma: string; note?: string };

function mkLesson(
  lessonId: string,
  sentences: TokenSpec[][],
  newLemmas: string[] = []
): Lesson {
  return {
    lessonId,
    title: "T",
    cefr: "A1",
    newLemmas,
    sections: [
      {
        format: "drill",
        title: "T",
        sentences: sentences.map((tokens, i) => ({
          id: `s${i + 1}`,
          target: tokens.map((t) => t.lv).join(" "),
          tokens: tokens.map((t) => ({ ...t, pos: "noun" as const })),
          natural: "n",
          audio: `${lessonId}-s${i + 1}.mp3`,
          audioApproved: false,
        })),
      },
    ],
  };
}

function mkCourse(lessons: { lessonId: string; newLemmas: string[] }[]): Course {
  return CourseSchema.parse({
    language: "lv",
    languageName: "Latvian",
    glossLanguage: "en",
    glossingRules: "../_shared/GLOSSING_RULES.md",
    lessons: lessons.map((l) => ({ ...l, theme: "t", cefr: "A1" })),
  });
}

describe("rule 1a — newLemmas must agree with course.json", () => {
  const course = mkCourse([{ lessonId: "lv-a1-01", newLemmas: ["a", "b"] }]);

  it("passes when the two lists match as sets, ignoring order", () => {
    const lesson = mkLesson("lv-a1-01", [[{ lv: "a", gloss: "a", lemma: "a" }]], ["b", "a"]);
    expect(checkNewLemmasMatchCourse(lesson, course).pass).toBe(true);
  });

  it("fails when the lesson re-declares a lemma course.json does not list for it", () => {
    // The real lv-a1-01 defect: 7 lemmas already taught in lv-a1-00.
    const lesson = mkLesson("lv-a1-01", [[{ lv: "a", gloss: "a", lemma: "a" }]], ["a", "b", "es"]);
    const result = checkNewLemmasMatchCourse(lesson, course);
    expect(result.pass).toBe(false);
    expect(result.messages[0]).toMatch(/not in course\.json/);
    expect(result.messages[0]).toMatch(/es/);
  });

  it("fails when the lesson omits a lemma course.json declares for it", () => {
    // The real lv-a1-02 defect: 8 omitted lemmas bypassed the new-lemma review gate.
    const lesson = mkLesson("lv-a1-01", [[{ lv: "a", gloss: "a", lemma: "a" }]], ["a"]);
    const result = checkNewLemmasMatchCourse(lesson, course);
    expect(result.pass).toBe(false);
    expect(result.messages[0]).toMatch(/not in the lesson file/);
    expect(result.messages[0]).toMatch(/\bb\b/);
  });

  it("passes on all real lessons", () => {
    const course = loadCourse();
    for (const entry of course.lessons) {
      const lesson: Lesson = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), `content/lv/lessons/${entry.lessonId}.json`), "utf-8")
      );
      expect(checkNewLemmasMatchCourse(lesson, course).messages).toEqual([]);
    }
  });
});

describe("rule 1b — no lemma declared new twice", () => {
  it("fails when a later lesson re-introduces an earlier lemma", () => {
    const course = mkCourse([
      { lessonId: "lv-a1-00", newLemmas: ["es", "tu"] },
      { lessonId: "lv-a1-01", newLemmas: ["sveiki", "es"] },
    ]);
    const result = checkNoDuplicateDeclarations(course);
    expect(result.pass).toBe(false);
    expect(result.messages[0]).toMatch(/"es".*lv-a1-01.*already introduced in lv-a1-00/);
  });

  it("passes on the real course", () => {
    expect(checkNoDuplicateDeclarations(loadCourse()).messages).toEqual([]);
  });
});

describe("rule 2 — course-wide gloss uniqueness", () => {
  it("catches one surface form glossed two ways across lessons (the paldies defect)", () => {
    const dictionary: Dictionary = { paldies: { glosses: ["thanks", "thank-you"] } };
    const lessons = [
      mkLesson("lv-a1-01", [[{ lv: "Paldies", gloss: "thanks", lemma: "paldies" }]]),
      mkLesson("lv-a1-03", [[{ lv: "Paldies", gloss: "thank-you", lemma: "paldies" }]]),
    ];
    const result = checkGlossUniqueness(lessons, dictionary);
    expect(result.pass).toBe(false);
    expect(result.messages[0]).toMatch(/paldies/);
    expect(result.messages[0]).toMatch(/"thanks".*vs.*"thank-you"|"thank-you".*vs.*"thanks"/);
  });

  it("ignores case when comparing surface forms", () => {
    const dictionary: Dictionary = { paldies: { glosses: ["thanks", "thank-you"] } };
    const lessons = [
      mkLesson("lv-a1-01", [
        [{ lv: "Paldies", gloss: "thanks", lemma: "paldies" }],
        [{ lv: "paldies", gloss: "thank-you", lemma: "paldies" }],
      ]),
    ];
    expect(checkGlossUniqueness(lessons, dictionary).pass).toBe(false);
  });

  it("does not fire on inflection-driven gloss differences across different forms", () => {
    // kūka -> cake/cakes and Rīga -> Riga/in-Riga are required by the method,
    // not drift: different surface forms, so each form still has one gloss.
    const dictionary: Dictionary = {
      kūka: { glosses: ["cake", "cakes"] },
      Rīga: { glosses: ["Riga", "in-Riga"] },
    };
    const lessons = [
      mkLesson("lv-a1-03", [
        [
          { lv: "kūku", gloss: "cake", lemma: "kūka" },
          { lv: "kūkas", gloss: "cakes", lemma: "kūka" },
          { lv: "Rīga", gloss: "Riga", lemma: "Rīga" },
          { lv: "Rīgā", gloss: "in-Riga", lemma: "Rīga" },
        ],
      ]),
    ];
    expect(checkGlossUniqueness(lessons, dictionary).messages).toEqual([]);
  });

  it("exempts a form whose dictionary note documents distinct senses (cik, vai)", () => {
    const dictionary: Dictionary = {
      cik: { glosses: ["how-much", "how"], note: "cik ilgi = how long; cik + adj./adv. = how" },
      vai: {
        glosses: ["whether", "or"],
        note: "Vai tu nāc? = whether (question particle); X vai Y = or (conjunction)",
      },
    };
    const lessons = [
      mkLesson("lv-a1-01", [
        [
          { lv: "Cik", gloss: "how-much", lemma: "cik", note: "how much" },
          { lv: "Cik", gloss: "how", lemma: "cik", note: "cik ilgi = how long" },
          { lv: "vai", gloss: "whether", lemma: "vai", note: "q. particle" },
          { lv: "vai", gloss: "or", lemma: "vai", note: "conj." },
        ],
      ]),
    ];
    expect(checkGlossUniqueness(lessons, dictionary).messages).toEqual([]);
  });

  it("passes on the real course content", () => {
    const course = loadCourse();
    const lessons = course.lessons.map(
      (e) =>
        JSON.parse(
          fs.readFileSync(path.join(process.cwd(), `content/lv/lessons/${e.lessonId}.json`), "utf-8")
        ) as Lesson
    );
    expect(checkGlossUniqueness(lessons, loadDictionary()).messages).toEqual([]);
  });
});

describe("rule 3 — sense-selection disclosure", () => {
  const dictionary: Dictionary = {
    cik: { glosses: ["how-much", "how"], note: "cik ilgi = how long; cik + adj./adv. = how" },
  };

  it("warns without failing when an ambiguous lemma's token carries no note (the Cik defect)", () => {
    const lessons = [mkLesson("lv-a1-01", [[{ lv: "Cik", gloss: "how-much", lemma: "cik" }]])];
    const result = checkSenseDisclosure(lessons, dictionary);
    // Warning-only until the deferred note-granularity pass lands.
    expect(result.pass).toBe(true);
    expect(result.warnings?.length).toBe(1);
    expect(result.warnings?.[0]).toMatch(/cik/);
    expect(result.warnings?.[0]).toMatch(/carry no note/);
  });

  it("is silent when every token of the ambiguous lemma discloses its sense", () => {
    const lessons = [
      mkLesson("lv-a1-01", [[{ lv: "Cik", gloss: "how", lemma: "cik", note: "cik ilgi = how long" }]]),
    ];
    expect(checkSenseDisclosure(lessons, dictionary).warnings).toEqual([]);
  });

  it("is silent for a single-gloss lemma, and for a multi-gloss lemma with no sense rule in its note", () => {
    const dict: Dictionary = {
      maize: { glosses: ["bread"] },
      dzert: { glosses: ["to-drink", "drink"], note: "no sense rule here" },
    };
    const lessons = [
      mkLesson("lv-a1-01", [
        [
          { lv: "maizi", gloss: "bread", lemma: "maize" },
          { lv: "dzert", gloss: "to-drink", lemma: "dzert" },
        ],
      ]),
    ];
    expect(checkSenseDisclosure(lessons, dict).warnings).toEqual([]);
  });
});

describe("recycling report", () => {
  it("reports lemmas appearing exactly once and never fails the build", () => {
    const lessons = [
      mkLesson("lv-a1-01", [
        [
          { lv: "maizi", gloss: "bread", lemma: "maize" },
          { lv: "maize", gloss: "bread", lemma: "maize" },
          { lv: "zupa", gloss: "soup", lemma: "zupa" },
        ],
      ]),
    ];
    const result = checkRecycling(lessons);
    expect(result.pass).toBe(true);
    expect(result.messages).toEqual([]);
    expect(result.warnings?.[0]).toMatch(/1 of 2 lemmas appear exactly once/);
    expect(result.warnings?.[0]).toMatch(/zupa/);
    expect(result.warnings?.[0]).not.toMatch(/maize/);
  });
});

describe("check 7 — audio coverage", () => {
  const lessons = [
    mkLesson("lv-a1-01", [
      [{ lv: "maize", gloss: "bread", lemma: "maize" }],
      [{ lv: "zupa", gloss: "soup", lemma: "zupa" }],
    ]),
  ];

  function withAudioDir(files: string[], run: (dir: string) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "valoda-audio-"));
    files.forEach((f) => fs.writeFileSync(path.join(dir, f), "x"));
    try {
      run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("never fails the build, even with no audio at all", () => {
    withAudioDir([], (dir) => {
      const result = checkAudioCoverage(lessons, dir);
      expect(result.pass).toBe(true);
      expect(result.messages).toEqual([]);
      expect(result.warnings?.[0]).toMatch(/2 of 2 sentence\(s\) have no audio file yet/);
    });
  });

  it("tolerates a missing audio directory", () => {
    const result = checkAudioCoverage(lessons, path.join(os.tmpdir(), "valoda-audio-does-not-exist"));
    expect(result.pass).toBe(true);
    expect(result.warnings?.[0]).toMatch(/no audio file yet/);
  });

  it("is silent when every sentence has audio and nothing is orphaned", () => {
    withAudioDir(["lv-a1-01-s1.mp3", "lv-a1-01-s2.mp3"], (dir) => {
      expect(checkAudioCoverage(lessons, dir).warnings).toEqual([]);
    });
  });

  it("warns about orphaned audio files", () => {
    withAudioDir(["lv-a1-01-s1.mp3", "lv-a1-01-s2.mp3", "lv-a1-01-s9.mp3"], (dir) => {
      const warnings = checkAudioCoverage(lessons, dir).warnings ?? [];
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/1 audio file\(s\) match no sentence: lv-a1-01-s9\.mp3/);
    });
  });

  it("ignores non-mp3 files such as the manifest", () => {
    withAudioDir(["lv-a1-01-s1.mp3", "lv-a1-01-s2.mp3", "manifest.json", ".gitkeep"], (dir) => {
      expect(checkAudioCoverage(lessons, dir).warnings).toEqual([]);
    });
  });
});
