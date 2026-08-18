import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { LessonSchema, VoicesSchema } from "../src/lib/content/schema";
import type { Lesson, Voices } from "../src/lib/content/schema";
import {
  resolveVoice,
  buildRequest,
  inputHash,
  expectedAudioName,
  lessonSentences,
  unmappedSpeakers,
  mp3DurationSeconds,
  shouldRegenerate,
  loadManifest,
  writeManifest,
} from "./generate-audio";

const VOICES_PATH = path.join(process.cwd(), "content/lv/voices.json");
const LESSONS_DIR = path.join(process.cwd(), "content/lv/lessons");

function loadVoices(): Voices {
  return VoicesSchema.parse(JSON.parse(fs.readFileSync(VOICES_PATH, "utf-8")));
}

function loadLessons(): Lesson[] {
  return fs
    .readdirSync(LESSONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => LessonSchema.parse(JSON.parse(fs.readFileSync(path.join(LESSONS_DIR, f), "utf-8"))));
}

// MPEG2 Layer III, 24 kHz, 32 kbps: 96-byte frames of 0.024s each.
function mp3Frames(count: number): Buffer {
  const frame = Buffer.alloc(96);
  frame[0] = 0xff;
  frame[1] = 0xf3;
  frame[2] = 0x44;
  frame[3] = 0x00;
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

describe("voices.json", () => {
  it("matches the voices schema", () => {
    const result = VoicesSchema.safeParse(JSON.parse(fs.readFileSync(VOICES_PATH, "utf-8")));
    expect(result.success).toBe(true);
  });

  it("maps every named speaker used in the content", () => {
    const voices = loadVoices();
    const named = unmappedSpeakers(loadLessons(), voices).filter((s) => s.speaker !== "(no speaker)");
    expect(named).toEqual([]);
  });
});

describe("resolveVoice", () => {
  const voices = loadVoices();

  it("uses the speaker's own voice when mapped", () => {
    const { voice, mapped } = resolveVoice(voices, "Anna");
    expect(mapped).toBe(true);
    expect(voice.name).toBe("Archernar");
  });

  it("falls back and flags it for an unmapped speaker", () => {
    const { voice, mapped } = resolveVoice(voices, "B");
    expect(mapped).toBe(false);
    expect(voice.name).toBe(voices.fallback.name);
  });

  it("falls back and flags it for a sentence with no speaker", () => {
    const { voice, mapped } = resolveVoice(voices, undefined);
    expect(mapped).toBe(false);
    expect(voice.name).toBe(voices.fallback.name);
  });
});

describe("unmappedSpeakers", () => {
  const voices = loadVoices();

  it("reports speakerless sentences with examples", () => {
    const lesson: Lesson = {
      lessonId: "lv-a1-99",
      title: "t",
      cefr: "A1",
      newLemmas: [],
      sections: [
        {
          format: "drill",
          title: "s",
          sentences: [
            { id: "s1", target: "Jā.", tokens: [{ lv: "Jā", gloss: "yes", lemma: "jā", pos: "part", punct: "." }], natural: "Yes.", audio: "lv-a1-99-s1.mp3", audioApproved: false },
            { id: "s2", speaker: "A", target: "Nē.", tokens: [{ lv: "Nē", gloss: "no", lemma: "nē", pos: "part", punct: "." }], natural: "No.", audio: "lv-a1-99-s2.mp3", audioApproved: false },
            { id: "s3", speaker: "Anna", target: "Jā.", tokens: [{ lv: "Jā", gloss: "yes", lemma: "jā", pos: "part", punct: "." }], natural: "Yes.", audio: "lv-a1-99-s3.mp3", audioApproved: false },
          ],
        },
      ],
    };
    const result = unmappedSpeakers([lesson], voices);
    expect(result.map((r) => r.speaker).sort()).toEqual(["(no speaker)", "A"]);
    expect(result.find((r) => r.speaker === "A")?.examples).toEqual(["lv-a1-99/s2"]);
  });
});

describe("buildRequest", () => {
  const voices = loadVoices();

  it("passes target text through unmodified", () => {
    const target = "Cik ilgi tu dzīvo Rīgā?";
    const request = buildRequest(target, voices.speakers["Anna"], voices);
    expect(request.input.text).toBe(target);
    expect(request.input.prompt).toBe(voices.speakers["Anna"].prompt);
    expect(request.voice).toEqual({
      languageCode: "lv-LV",
      modelName: voices.defaults.modelName,
      name: "Archernar",
    });
    expect(request.audioConfig).toEqual({ audioEncoding: "MP3", speakingRate: 1, pitch: 0 });
  });
});

describe("inputHash", () => {
  const voices = loadVoices();
  const anna = voices.speakers["Anna"];

  it("is stable for identical inputs", () => {
    expect(inputHash(buildRequest("Labdien!", anna, voices))).toBe(
      inputHash(buildRequest("Labdien!", anna, voices))
    );
  });

  it("changes when the text changes", () => {
    expect(inputHash(buildRequest("Labdien!", anna, voices))).not.toBe(
      inputHash(buildRequest("Labdien.", anna, voices))
    );
  });

  it("changes when the voice changes", () => {
    expect(inputHash(buildRequest("Labdien!", anna, voices))).not.toBe(
      inputHash(buildRequest("Labdien!", voices.speakers["Marta"], voices))
    );
  });

  it("changes when the prompt changes", () => {
    const rePrompted = { ...anna, prompt: "Read aloud slowly." };
    expect(inputHash(buildRequest("Labdien!", anna, voices))).not.toBe(
      inputHash(buildRequest("Labdien!", rePrompted, voices))
    );
  });

  it("changes when audioConfig changes", () => {
    const slower: Voices = {
      ...voices,
      defaults: { ...voices.defaults, speakingRate: 0.8 },
    };
    expect(inputHash(buildRequest("Labdien!", anna, voices))).not.toBe(
      inputHash(buildRequest("Labdien!", anna, slower))
    );
  });
});

describe("mp3DurationSeconds", () => {
  it("sums frame durations", () => {
    expect(mp3DurationSeconds(mp3Frames(10))).toBeCloseTo(0.24, 3);
  });

  it("skips an ID3v2 header", () => {
    const id3 = Buffer.alloc(10);
    id3.write("ID3", 0, "ascii");
    id3[9] = 20; // 20-byte tag body
    const tagged = Buffer.concat([id3, Buffer.alloc(20), mp3Frames(5)]);
    expect(mp3DurationSeconds(tagged)).toBeCloseTo(0.12, 3);
  });

  it("returns null when there are no decodable frames", () => {
    expect(mp3DurationSeconds(Buffer.alloc(0))).toBeNull();
    expect(mp3DurationSeconds(Buffer.from("not an mp3 at all, truncated"))).toBeNull();
  });
});

describe("audio filenames", () => {
  it("every sentence's audio field matches <lessonId>-<sentenceId>.mp3", () => {
    const mismatches: string[] = [];
    for (const lesson of loadLessons()) {
      for (const sentence of lessonSentences(lesson)) {
        const expected = expectedAudioName(lesson.lessonId, sentence.id);
        if (sentence.audio !== expected) {
          mismatches.push(`${lesson.lessonId}/${sentence.id}: ${sentence.audio} != ${expected}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("shouldRegenerate", () => {
  const entry = {
    hash: "a".repeat(64),
    voice: "Archernar",
    durationSeconds: 1.2,
    generatedAt: "2026-08-18T00:00:00.000Z",
  };

  it("skips an unchanged sentence whose file is present", () => {
    expect(shouldRegenerate(entry, entry.hash, true, false)).toBe(false);
  });

  it("regenerates when the inputs hash differently", () => {
    expect(shouldRegenerate(entry, "b".repeat(64), true, false)).toBe(true);
  });

  it("regenerates when the file is missing despite a manifest entry", () => {
    expect(shouldRegenerate(entry, entry.hash, false, false)).toBe(true);
  });

  it("regenerates when there is no manifest entry", () => {
    expect(shouldRegenerate(undefined, entry.hash, true, false)).toBe(true);
  });

  it("regenerates unchanged sentences under --force", () => {
    expect(shouldRegenerate(entry, entry.hash, true, true)).toBe(true);
  });
});

describe("manifest round-trip", () => {
  it("writes sorted keys and reads them back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "valoda-manifest-"));
    const manifestPath = path.join(dir, "manifest.json");
    const entry = (hash: string) => ({
      hash,
      voice: "Umbriel",
      durationSeconds: 2,
      generatedAt: "2026-08-18T00:00:00.000Z",
    });

    writeManifest(manifestPath, {
      "lv-a1-01-s2.mp3": entry("b".repeat(64)),
      "lv-a1-01-s1.mp3": entry("a".repeat(64)),
    });

    expect(Object.keys(loadManifest(manifestPath))).toEqual([
      "lv-a1-01-s1.mp3",
      "lv-a1-01-s2.mp3",
    ]);
    expect(loadManifest(path.join(dir, "absent.json"))).toEqual({});

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
