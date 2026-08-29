import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { DialogueVoicesSchema, LessonSchema } from "../src/lib/content/schema";
import {
  buildTimings,
  checkScriptAgainstLesson,
  dialogueCharacterCount,
  lessonSeed,
  lessonSentences,
  missingTimings,
  parseScript,
  resolveVoices,
  stripTags,
  type ScriptLine,
} from "./generate-dialogue-audio";

describe("whole-lesson dialogue scripts", () => {
  it("parses tagged lines and preserves pipes inside dialogue", () => {
    expect(parseScript("s1 | Emma | [warmly] Sveika!\ns2 | Marta | A | B")).toEqual([
      { id: "s1", speaker: "Emma", text: "[warmly] Sveika!" },
      { id: "s2", speaker: "Marta", text: "A | B" },
    ]);
    expect(stripTags("[warmly]  Sveika!")).toBe("Sveika!");
  });

  it.each(["lv-a1-01", "lv-a1-02", "lv-a1-03"])(
    "keeps %s aligned and within the one-request limit",
    (lessonId) => {
      const langRoot = path.join(process.cwd(), "content", "lv");
      const script = parseScript(
        fs.readFileSync(path.join(langRoot, "audio-scripts", `${lessonId}.md`), "utf-8")
      );
      const lesson = LessonSchema.parse(
        JSON.parse(
          fs.readFileSync(path.join(langRoot, "lessons", `${lessonId}.json`), "utf-8")
        )
      );
      const voices = DialogueVoicesSchema.parse(
        JSON.parse(fs.readFileSync(path.join(langRoot, "voices.json"), "utf-8"))
      );

      expect(checkScriptAgainstLesson(script, lessonSentences(lesson))).toEqual([]);
      expect(dialogueCharacterCount(resolveVoices(script, voices))).toBeLessThanOrEqual(2_000);
    }
  );
});

describe("whole-take timing derivation", () => {
  const script: ScriptLine[] = [
    { id: "s1", speaker: "A", text: "One." },
    { id: "s2", speaker: "B", text: "Two." },
  ];

  it("combines multiple returned segments for one sentence", () => {
    const timings = buildTimings("lesson.mp3", script, [
      { dialogue_input_index: 0, start_time_seconds: 0, end_time_seconds: 0.9 },
      { dialogue_input_index: 1, start_time_seconds: 1, end_time_seconds: 2 },
      { dialogue_input_index: 0, start_time_seconds: 0.9, end_time_seconds: 1 },
    ]);

    expect(timings).toEqual({
      audio: "lesson.mp3",
      sentences: {
        s1: { start: 0, end: 1 },
        s2: { start: 1, end: 2 },
      },
    });
    expect(missingTimings(script, timings)).toEqual([]);
  });

  it("reports inputs that received no timing", () => {
    const timings = buildTimings("lesson.mp3", script, [
      { dialogue_input_index: 0, start_time_seconds: 0, end_time_seconds: 1 },
    ]);
    expect(missingTimings(script, timings)).toEqual(["s2"]);
  });
});

describe("generation seed", () => {
  it("is stable per lesson and differs between lessons", () => {
    expect(lessonSeed("lv-a1-02")).toBe(lessonSeed("lv-a1-02"));
    expect(lessonSeed("lv-a1-02")).not.toBe(lessonSeed("lv-a1-03"));
    expect(lessonSeed("lv-a1-02")).toBeGreaterThanOrEqual(0);
    expect(lessonSeed("lv-a1-02")).toBeLessThanOrEqual(4_294_967_295);
  });
});
