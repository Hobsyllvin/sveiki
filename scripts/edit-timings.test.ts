import { describe, expect, it } from "vitest";
import {
  applyRegeneratedDuration,
  buildConcatFilter,
  buildSpliceSegments,
  dropRegeneratedEdit,
  parseSilences,
  regenTrimBounds,
  shiftTimingsAfter,
} from "./edit-timings";

describe("shifting timings after a sentence", () => {
  const orderedIds = ["s1", "s2", "s3"];
  const timings = {
    audio: "lesson.mp3",
    sentences: { s1: { start: 0, end: 2 }, s2: { start: 2, end: 4 }, s3: { start: 4, end: 6 } },
  };

  it("leaves the reference sentence and everything before it untouched", () => {
    expect(shiftTimingsAfter(timings, orderedIds, "s2", 0.5).sentences).toEqual({
      s1: { start: 0, end: 2 },
      s2: { start: 2, end: 4 },
      s3: { start: 4.5, end: 6.5 },
    });
  });

  it("supports a negative shift (a shorter replacement clip)", () => {
    expect(shiftTimingsAfter(timings, orderedIds, "s1", -0.5).sentences).toEqual({
      s1: { start: 0, end: 2 },
      s2: { start: 1.5, end: 3.5 },
      s3: { start: 3.5, end: 5.5 },
    });
  });
});

describe("applying a regenerated sentence's duration", () => {
  const orderedIds = ["s1", "s2", "s3"];
  const timings = {
    audio: "lesson.mp3",
    sentences: { s1: { start: 0, end: 2 }, s2: { start: 2, end: 4 }, s3: { start: 4, end: 6 } },
  };

  it("sets the regenerated sentence's own boundary from its new duration and shifts the rest", () => {
    // old s2 was 2s (2..4); the replacement take is 2.5s
    expect(applyRegeneratedDuration(timings, orderedIds, "s2", 2, 4, 2.5).sentences).toEqual({
      s1: { start: 0, end: 2 },
      s2: { start: 2, end: 4.5 },
      s3: { start: 4.5, end: 6.5 },
    });
  });

  it("drops the regenerated sentence's own hand correction but shifts other corrections", () => {
    const edits = { sentences: { s2: { start: 2.1, end: 3.9 }, s3: { start: 4.2, end: 5.9 } } };
    expect(dropRegeneratedEdit(edits, orderedIds, "s2", 2.1, 3.9, 2.5, "lesson.mp3").sentences).toEqual({
      s3: { start: 4.9, end: 6.6 },
    });
  });
});

describe("trimming a single-sentence take's silence padding", () => {
  it("trims leading and trailing silence but keeps internal pauses", () => {
    const silences = [
      { start: 0, end: 0.3 },
      { start: 1.5, end: 1.7 },
      { start: 3.6, end: 4 },
    ];
    expect(regenTrimBounds(4, silences, 0.02)).toEqual({ start: 0.28, end: 3.62 });
  });

  it("leaves bounds alone when there is no leading/trailing silence", () => {
    expect(regenTrimBounds(2, [], 0.02)).toEqual({ start: 0, end: 2 });
  });
});

describe("splicing a replacement clip into the original take", () => {
  it("includes a before and after segment when the sentence is in the middle", () => {
    const segments = buildSpliceSegments(2, 4, 6);
    expect(segments).toEqual([
      { source: "original", start: 0, end: 2 },
      { source: "candidate" },
      { source: "original", start: 4, end: 6 },
    ]);
    expect(buildConcatFilter(segments)).toBe(
      "[0:a]atrim=start=0:end=2,asetpts=PTS-STARTPTS[s0];" +
        "[1:a]asetpts=PTS-STARTPTS[s1];" +
        "[0:a]atrim=start=4:end=6,asetpts=PTS-STARTPTS[s2];" +
        "[s0][s1][s2]concat=n=3:v=0:a=1[out]"
    );
  });

  it("drops the before segment when the sentence starts at the beginning", () => {
    expect(buildSpliceSegments(0, 2, 6)).toEqual([
      { source: "candidate" },
      { source: "original", start: 2, end: 6 },
    ]);
  });

  it("drops the after segment when the sentence runs to the end", () => {
    expect(buildSpliceSegments(4, 6, 6)).toEqual([
      { source: "original", start: 0, end: 4 },
      { source: "candidate" },
    ]);
  });
});

describe("existing silence parsing (regression guard for the file split above)", () => {
  it("closes a silence left open at end of file", () => {
    expect(parseSilences("silence_start: 1.0\n", 5)).toEqual([{ start: 1, end: 5 }]);
  });
});
