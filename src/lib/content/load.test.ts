import { describe, it, expect } from "vitest";
import { loadAudioManifest, audioSrc, langOf } from "./load";

describe("loadAudioManifest", () => {
  it("parses the generated clip manifest", () => {
    const manifest = loadAudioManifest("lv");
    const entry = manifest["lv-a1-01-s1.mp3"];
    expect(entry).toBeDefined();
    expect(entry.durationSeconds).toBeGreaterThan(0);
    expect(entry.hash).toHaveLength(64);
  });

  it("returns an empty manifest for a language with no audio", () => {
    expect(loadAudioManifest("xx")).toEqual({});
  });
});

describe("audioSrc", () => {
  it("points at the synced public path", () => {
    expect(audioSrc("lv", "lv-a1-01-s1.mp3")).toBe("/audio/lv/lv-a1-01-s1.mp3");
  });
});

describe("langOf", () => {
  it("reads the language from a lesson id", () => {
    expect(langOf("lv-a1-01")).toBe("lv");
  });
});
