import { describe, expect, it } from "vitest";
import { displayLessonTitle } from "./lessonTitles";

describe("displayLessonTitle", () => {
  it("uses the editorial title for known lessons", () => {
    expect(displayLessonTitle("lv-a1-03", "Kafejnīcā")).toBe("Coffee, Cake & Conversation");
  });

  it("keeps a fallback for future lessons", () => {
    expect(displayLessonTitle("lv-a1-99", "Future lesson")).toBe("Future lesson");
  });
});
