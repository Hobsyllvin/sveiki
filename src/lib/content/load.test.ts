import { describe, it, expect } from "vitest";
import { loadTimings, audioSrc, mergeTimingEdits, timingEditsPathFor } from "./load";
import type { AudioTimings } from "./schema";

describe("loadTimings", () => {
  it("parses a lesson's timings file", () => {
    const timings = loadTimings("lv-a1-03");
    expect(timings).not.toBeNull();
    expect(timings!.audio).toBe("lv-a1-03.mp3");
    expect(timings!.sentences.s1.start).toBe(0);
    expect(timings!.sentences.s1.end).toBeGreaterThan(0);
  });

  it("returns null for a lesson with no audio", () => {
    expect(loadTimings("lv-a1-99")).toBeNull();
  });
});

describe("mergeTimingEdits", () => {
  const timings: AudioTimings = {
    audio: "lv-a1-02.mp3",
    sentences: {
      s1: { start: 0, end: 2.08 },
      s2: { start: 2.08, end: 5.28 },
      s3: { start: 5.28, end: 7.36 },
    },
  };

  it("lets a corrected boundary win and leaves the rest alone", () => {
    const merged = mergeTimingEdits(timings, {
      sentences: { s2: { start: 2.1, end: 5.5 } },
    });
    expect(merged.sentences.s2).toEqual({ start: 2.1, end: 5.5 });
    expect(merged.sentences.s1).toEqual({ start: 0, end: 2.08 });
    expect(merged.sentences.s3).toEqual({ start: 5.28, end: 7.36 });
    expect(merged.audio).toBe("lv-a1-02.mp3");
  });

  it("does not mutate the generated timings", () => {
    mergeTimingEdits(timings, { sentences: { s1: { start: 0.2, end: 2 } } });
    expect(timings.sentences.s1).toEqual({ start: 0, end: 2.08 });
  });

  it("accepts corrections that leave a gap between neighbours", () => {
    const merged = mergeTimingEdits(timings, {
      sentences: { s1: { start: 0, end: 1.7 }, s2: { start: 2.1, end: 5.28 } },
    });
    expect(merged.sentences.s1.end).toBeLessThan(merged.sentences.s2.start);
  });
});

describe("timingEditsPathFor", () => {
  it("sits beside the generated timings file", () => {
    expect(timingEditsPathFor("lv-a1-02")).toMatch(
      /content\/lv\/audio\/lv-a1-02\.timings\.edits\.json$/
    );
  });
});

describe("audioSrc", () => {
  it("points at the synced public path for the lesson's language", () => {
    expect(audioSrc("lv-a1-01", { audio: "lv-a1-01.mp3", sentences: {} })).toBe(
      "/audio/lv/lv-a1-01.mp3"
    );
  });
});
