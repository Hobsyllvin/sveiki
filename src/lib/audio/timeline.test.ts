import { describe, it, expect } from "vitest";
import { activeSentenceIdAt, buildTimeline, indexOfSentence } from "./timeline";
import type { AudioTimings, Lesson } from "@/lib/content/schema";

const lesson: Lesson = {
  lessonId: "lv-a1-01",
  title: "Test",
  cefr: "A1",
  newLemmas: [],
  sections: [
    {
      format: "dialogue",
      title: "One",
      sentences: [
        {
          id: "s1",
          target: "Labdien!",
          tokens: [{ lv: "Labdien", gloss: "good-day", lemma: "labdiena", pos: "interj" }],
          natural: "Hello!",
          audio: "lv-a1-01-s1.mp3",
          audioApproved: false,
        },
        {
          id: "s2",
          target: "Sveiki!",
          tokens: [{ lv: "Sveiki", gloss: "hello", lemma: "sveiks", pos: "interj" }],
          natural: "Hi!",
          audio: "lv-a1-01-s2.mp3",
          audioApproved: false,
        },
      ],
    },
    {
      format: "drill",
      title: "Two",
      sentences: [
        {
          id: "s3",
          target: "Paldies.",
          tokens: [{ lv: "Paldies", gloss: "thanks", lemma: "paldies", pos: "interj" }],
          natural: "Thanks.",
          audio: "lv-a1-01-s3.mp3",
          audioApproved: false,
        },
      ],
    },
  ],
};

const timings: AudioTimings = {
  audio: "lv-a1-01.mp3",
  sentences: {
    s1: { start: 0, end: 1.84 },
    s2: { start: 1.84, end: 2.8 },
    s3: { start: 2.8, end: 5.5 },
  },
};

describe("buildTimeline", () => {
  it("flattens sections into lesson order", () => {
    expect(buildTimeline(lesson, timings)).toEqual([
      { id: "s1", start: 0, end: 1.84 },
      { id: "s2", start: 1.84, end: 2.8 },
      { id: "s3", start: 2.8, end: 5.5 },
    ]);
  });

  it("is empty without timings", () => {
    expect(buildTimeline(lesson, null)).toEqual([]);
  });

  it("skips sentences the timings file does not cover", () => {
    const partial: AudioTimings = {
      audio: "lv-a1-01.mp3",
      sentences: { s2: { start: 0, end: 1 } },
    };
    expect(buildTimeline(lesson, partial).map((e) => e.id)).toEqual(["s2"]);
  });
});

describe("activeSentenceIdAt", () => {
  const timeline = buildTimeline(lesson, timings);

  it("returns the sentence containing the time", () => {
    expect(activeSentenceIdAt(timeline, 0.5)).toBe("s1");
    expect(activeSentenceIdAt(timeline, 2.0)).toBe("s2");
    expect(activeSentenceIdAt(timeline, 4)).toBe("s3");
  });

  it("treats a start boundary as inside that sentence", () => {
    expect(activeSentenceIdAt(timeline, 0)).toBe("s1");
    expect(activeSentenceIdAt(timeline, 1.84)).toBe("s2");
    expect(activeSentenceIdAt(timeline, 2.8)).toBe("s3");
  });

  it("keeps the last sentence active at its end", () => {
    expect(activeSentenceIdAt(timeline, 5.5)).toBe("s3");
  });

  it("returns null before the first sentence starts and on an empty timeline", () => {
    expect(activeSentenceIdAt([{ id: "a", start: 1, end: 2 }], 0.5)).toBeNull();
    expect(activeSentenceIdAt([], 1)).toBeNull();
  });

  it("holds the last sentence through trailing silence", () => {
    expect(activeSentenceIdAt(timeline, 5.51)).toBe("s3");
  });

  // Corrected boundaries can leave a pause owned by neither neighbour; the highlight
  // should stay on the sentence just heard rather than blink off.
  it("holds the previous sentence through a gap", () => {
    const gapped = [
      { id: "a", start: 0, end: 1 },
      { id: "b", start: 3, end: 4 },
    ];
    expect(activeSentenceIdAt(gapped, 2)).toBe("a");
    expect(activeSentenceIdAt(gapped, 3)).toBe("b");
  });
});

describe("indexOfSentence", () => {
  const timeline = buildTimeline(lesson, timings);

  it("finds a sentence and reports -1 for none", () => {
    expect(indexOfSentence(timeline, "s2")).toBe(1);
    expect(indexOfSentence(timeline, null)).toBe(-1);
    expect(indexOfSentence(timeline, "nope")).toBe(-1);
  });
});
