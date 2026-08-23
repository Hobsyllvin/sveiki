import { describe, it, expect } from "vitest";
import { loadTimings, audioSrc } from "./load";

describe("loadTimings", () => {
  it("parses a lesson's timings file", () => {
    const timings = loadTimings("lv-a1-01");
    expect(timings).not.toBeNull();
    expect(timings!.audio).toBe("lv-a1-01.mp3");
    expect(timings!.sentences.s1.start).toBe(0);
    expect(timings!.sentences.s1.end).toBeGreaterThan(0);
  });

  it("returns null for a lesson with no audio", () => {
    expect(loadTimings("lv-a1-99")).toBeNull();
  });
});

describe("audioSrc", () => {
  it("points at the synced public path for the lesson's language", () => {
    expect(audioSrc("lv-a1-01", { audio: "lv-a1-01.mp3", sentences: {} })).toBe(
      "/audio/lv/lv-a1-01.mp3"
    );
  });
});
