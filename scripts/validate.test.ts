import { describe, it, expect } from "vitest";
import { LessonSchema } from "../src/lib/content/schema";
import type { Lesson, Dictionary } from "../src/lib/content/schema";
import fs from "fs";
import path from "path";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "content/lv/lessons/lv-a1-00.json"
);
const DICTIONARY_PATH = path.join(process.cwd(), "content/lv/dictionary.json");

function loadFixture(): Lesson {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf-8"));
}

function loadDictionary(): Dictionary {
  return JSON.parse(fs.readFileSync(DICTIONARY_PATH, "utf-8"));
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
