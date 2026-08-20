import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { LessonSchema, VoicesSchema } from "../src/lib/content/schema";
import type { Lesson, Voices } from "../src/lib/content/schema";
import {
  resolveVoice,
  promptedText,
  buildRequest,
  inputHash,
  extractPcm,
  parseRetryDelayMs,
  parseDurationMs,
  isDailyQuotaExhausted,
  formatDuration,
  pcmToMp3,
  probeDurationSeconds,
  expectedAudioName,
  lessonSentences,
  unmappedSpeakers,
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

// Silence is enough: the conversion path only needs to know the byte layout.
function silencePcm(seconds: number, sampleRate = 24000): Buffer {
  return Buffer.alloc(Math.round(seconds * sampleRate) * 2);
}

function apiResponse(base64: string, mimeType = "audio/L16;codec=pcm;rate=24000") {
  return { candidates: [{ content: { parts: [{ inlineData: { mimeType, data: base64 } }] } }] };
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

  it("has no trailing punctuation on prompts, which would double up before the colon", () => {
    const voices = loadVoices();
    const prompts = [...Object.values(voices.speakers), voices.fallback].map((v) => v.prompt);
    expect(prompts.filter((p) => /[.:!?]$/.test(p))).toEqual([]);
  });
});

describe("resolveVoice", () => {
  const voices = loadVoices();

  it("uses the speaker's own voice when mapped", () => {
    const { voice, mapped } = resolveVoice(voices, "Anna");
    expect(mapped).toBe(true);
    expect(voice.voiceName).toBe("Achernar");
  });

  it("falls back and flags it for an unmapped speaker", () => {
    const { voice, mapped } = resolveVoice(voices, "B");
    expect(mapped).toBe(false);
    expect(voice.voiceName).toBe(voices.fallback.voiceName);
  });

  it("falls back and flags it for a sentence with no speaker", () => {
    const { voice, mapped } = resolveVoice(voices, undefined);
    expect(mapped).toBe(false);
    expect(voice.voiceName).toBe(voices.fallback.voiceName);
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
  const anna = voices.speakers["Anna"];

  it("puts steering in the text as `${prompt}: ${target}`", () => {
    expect(promptedText(anna, "Labdien!")).toBe(`${anna.prompt}: Labdien!`);
  });

  it("passes target text through unmodified", () => {
    const target = "Cik ilgi tu dzīvo Rīgā?";
    const text = buildRequest(target, anna).contents[0].parts[0].text;
    expect(text.endsWith(target)).toBe(true);
  });

  it("requests audio with the speaker's prebuilt voice", () => {
    const request = buildRequest("Labdien!", anna);
    expect(request.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(
      request.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName
    ).toBe("Achernar");
  });
});

describe("inputHash", () => {
  const voices = loadVoices();
  const anna = voices.speakers["Anna"];
  const model = voices.defaults.model;

  it("is stable for identical inputs", () => {
    expect(inputHash("Labdien!", anna, model)).toBe(inputHash("Labdien!", anna, model));
  });

  it("changes when the text changes", () => {
    expect(inputHash("Labdien!", anna, model)).not.toBe(inputHash("Labdien.", anna, model));
  });

  it("changes when the voice changes", () => {
    expect(inputHash("Labdien!", anna, model)).not.toBe(
      inputHash("Labdien!", voices.speakers["Marta"], model)
    );
  });

  it("changes when the prompt changes", () => {
    expect(inputHash("Labdien!", anna, model)).not.toBe(
      inputHash("Labdien!", { ...anna, prompt: "Read aloud slowly" }, model)
    );
  });

  it("changes when the model changes", () => {
    expect(inputHash("Labdien!", anna, model)).not.toBe(
      inputHash("Labdien!", anna, "some-other-tts-model")
    );
  });
});

describe("extractPcm", () => {
  it("decodes the inline base64 payload", () => {
    const pcm = silencePcm(1);
    expect(extractPcm(apiResponse(pcm.toString("base64"))).length).toBe(pcm.length);
  });

  // A rejected request comes back HTTP 200 with a small JSON body; piping that
  // straight to ffmpeg would silently write a zero-byte mp3.
  it("throws when the response carries no inlineData", () => {
    expect(() => extractPcm({ candidates: [{ content: { parts: [{ text: "sorry" }] } }] })).toThrow(
      /no audio/
    );
    expect(() => extractPcm({ error: { message: "quota exceeded" } })).toThrow(/quota exceeded/);
    expect(() => extractPcm({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(/SAFETY/);
  });

  it("throws when the decoded PCM is implausibly small", () => {
    expect(() => extractPcm(apiResponse(Buffer.alloc(400).toString("base64")))).toThrow(
      /implausibly small/
    );
  });
});

describe("parseRetryDelayMs", () => {
  // The real 429 body that made the first --all run give up on 8 sentences:
  // exponential backoff capped at 8s while the API was asking for ~56s.
  const quotaBody = JSON.stringify({
    error: {
      code: 429,
      message:
        "You exceeded your current quota, please check your plan and billing details. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model, limit: 10, model: gemini-3.1-flash-tts\nPlease retry in 56.12319464s.",
      status: "RESOURCE_EXHAUSTED",
      details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "56s" }],
    },
  });

  it("prefers the structured RetryInfo detail", () => {
    expect(parseRetryDelayMs(quotaBody)).toBe(56_000);
  });

  it("falls back to the message text when the body is truncated mid-JSON", () => {
    expect(parseRetryDelayMs(quotaBody.slice(0, 280))).toBe(56_124);
  });

  it("returns null when there is no usable hint", () => {
    expect(parseRetryDelayMs("")).toBeNull();
    expect(parseRetryDelayMs("Internal error")).toBeNull();
    expect(parseRetryDelayMs(JSON.stringify({ error: { code: 500 } }))).toBeNull();
  });

  // The per-day body carries an hours-long duration and no RetryInfo detail;
  // an s-only regex silently missed it and fell back to exponential backoff.
  it("reads an hours-long delay from the per-day quota message", () => {
    expect(parseRetryDelayMs("Please retry in 17h42m36.717227318s.")).toBe(63_756_718);
  });
});

describe("parseDurationMs", () => {
  it("parses the duration shapes the API emits", () => {
    expect(parseDurationMs("56.12319464s")).toBe(56_124);
    expect(parseDurationMs("30s")).toBe(30_000);
    expect(parseDurationMs("1m30s")).toBe(90_000);
    expect(parseDurationMs("17h42m36.7s")).toBe(63_756_700);
    expect(parseDurationMs("2h")).toBe(7_200_000);
  });

  it("rejects junk", () => {
    expect(parseDurationMs("")).toBeNull();
    expect(parseDurationMs("soon")).toBeNull();
    expect(parseDurationMs("0s")).toBeNull();
  });
});

describe("isDailyQuotaExhausted", () => {
  it("distinguishes a per-day quota from a per-minute one", () => {
    const perDay =
      "Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 100";
    const perMinute =
      "Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model, limit: 10";
    expect(isDailyQuotaExhausted(perDay)).toBe(true);
    expect(isDailyQuotaExhausted(perMinute)).toBe(false);
    expect(isDailyQuotaExhausted('"quotaId": "GenerateRequestsPerDayPerProjectPerModel"')).toBe(true);
  });
});

describe("formatDuration", () => {
  it("renders waits in the largest useful unit", () => {
    expect(formatDuration(63_757_000)).toBe("17h42m");
    expect(formatDuration(90_000)).toBe("1m30s");
    expect(formatDuration(45_000)).toBe("45s");
  });
});

describe("pcmToMp3", () => {
  it("converts raw PCM to a playable mp3 and reports its duration", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "valoda-audio-"));
    const destination = path.join(dir, "out.mp3");

    const duration = await pcmToMp3(silencePcm(1), destination, 24000, 1);

    expect(fs.existsSync(destination)).toBe(true);
    expect(fs.statSync(destination).size).toBeGreaterThan(0);
    expect(duration).toBeGreaterThan(0.9);
    expect(duration).toBeLessThan(1.2);
    expect(probeDurationSeconds(destination)).toBeCloseTo(duration, 3);
    // No temp file left behind.
    expect(fs.readdirSync(dir)).toEqual(["out.mp3"]);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads a longer clip's duration proportionally", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "valoda-audio-"));
    const destination = path.join(dir, "out.mp3");

    const duration = await pcmToMp3(silencePcm(3), destination, 24000, 1);
    expect(duration).toBeGreaterThan(2.9);
    expect(duration).toBeLessThan(3.2);

    fs.rmSync(dir, { recursive: true, force: true });
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
    voice: "Achernar",
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
