import { describe, it, expect } from "vitest";
import { buildPlaylist, indexOfClip, totalDuration } from "./playlist";
import type { AudioManifest, Lesson, Sentence } from "@/lib/content/schema";

function sentence(id: string): Sentence {
  return {
    id,
    target: `Teikums ${id}.`,
    tokens: [{ lv: "Teikums", gloss: "sentence", lemma: "teikums", pos: "noun" }],
    natural: `Sentence ${id}.`,
    audio: `lv-a1-01-${id}.mp3`,
    audioApproved: false,
  };
}

const lesson: Lesson = {
  lessonId: "lv-a1-01",
  title: "Test",
  cefr: "A1",
  newLemmas: [],
  sections: [
    { format: "dialogue", title: "One", sentences: [sentence("s1"), sentence("s2")] },
    { format: "drill", title: "Two", sentences: [sentence("s3")] },
  ],
};

function entry(durationSeconds: number) {
  return {
    hash: "a".repeat(64),
    voice: "voice-id",
    durationSeconds,
    generatedAt: "2026-08-23T00:00:00.000Z",
  };
}

const manifest: AudioManifest = {
  "lv-a1-01-s1.mp3": entry(1.68),
  "lv-a1-01-s2.mp3": entry(0.88),
  "lv-a1-01-s3.mp3": entry(2.4),
};

describe("buildPlaylist", () => {
  it("orders clips by lesson order with cumulative offsets", () => {
    expect(buildPlaylist(lesson, manifest, "lv")).toEqual([
      { id: "s1", src: "/audio/lv/lv-a1-01-s1.mp3", duration: 1.68, offset: 0 },
      { id: "s2", src: "/audio/lv/lv-a1-01-s2.mp3", duration: 0.88, offset: 1.68 },
      { id: "s3", src: "/audio/lv/lv-a1-01-s3.mp3", duration: 2.4, offset: 2.56 },
    ]);
  });

  it("is empty when nothing has been generated", () => {
    expect(buildPlaylist(lesson, {}, "lv")).toEqual([]);
  });

  it("skips sentences with no clip and keeps later offsets contiguous", () => {
    const partial: AudioManifest = {
      "lv-a1-01-s1.mp3": entry(1.5),
      "lv-a1-01-s3.mp3": entry(2.0),
    };
    expect(buildPlaylist(lesson, partial, "lv")).toEqual([
      { id: "s1", src: "/audio/lv/lv-a1-01-s1.mp3", duration: 1.5, offset: 0 },
      { id: "s3", src: "/audio/lv/lv-a1-01-s3.mp3", duration: 2.0, offset: 1.5 },
    ]);
  });
});

describe("totalDuration", () => {
  it("sums the clips", () => {
    expect(totalDuration(buildPlaylist(lesson, manifest, "lv"))).toBeCloseTo(4.96);
  });

  it("is zero with no clips", () => {
    expect(totalDuration([])).toBe(0);
  });
});

describe("indexOfClip", () => {
  it("finds a clip and reports -1 for none", () => {
    const playlist = buildPlaylist(lesson, manifest, "lv");
    expect(indexOfClip(playlist, "s2")).toBe(1);
    expect(indexOfClip(playlist, null)).toBe(-1);
    expect(indexOfClip(playlist, "nope")).toBe(-1);
  });
});
