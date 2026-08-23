import fs from "fs";
import path from "path";
import { LessonSchema, CourseSchema, AudioTimingsSchema } from "./schema";
import type { Lesson, Course, AudioTimings } from "./schema";

const CONTENT_ROOT = path.join(process.cwd(), "content");

// Whole-scene audio and its timings live here; scripts/sync-audio.ts copies the
// mp3s to public/audio/<lang>/ so Next serves them as static assets.
export const AUDIO_DIR_NAME = "audio-elevenlabs";

function langFromLessonId(lessonId: string): string {
  return lessonId.split("-")[0];
}

export function loadLesson(lessonId: string): Lesson | null {
  const lang = langFromLessonId(lessonId);
  const lessonPath = path.join(CONTENT_ROOT, lang, "lessons", `${lessonId}.json`);
  if (!fs.existsSync(lessonPath)) return null;
  const raw = JSON.parse(fs.readFileSync(lessonPath, "utf-8"));
  return LessonSchema.parse(raw);
}

export function loadTimings(lessonId: string): AudioTimings | null {
  const lang = langFromLessonId(lessonId);
  const timingsPath = path.join(
    CONTENT_ROOT,
    lang,
    AUDIO_DIR_NAME,
    `${lessonId}.timings.json`
  );
  if (!fs.existsSync(timingsPath)) return null;
  const raw = JSON.parse(fs.readFileSync(timingsPath, "utf-8"));
  return AudioTimingsSchema.parse(raw);
}

export function audioSrc(lessonId: string, timings: AudioTimings): string {
  return `/audio/${langFromLessonId(lessonId)}/${timings.audio}`;
}

export function loadCourse(lang: string): Course {
  const coursePath = path.join(CONTENT_ROOT, lang, "course.json");
  const raw = JSON.parse(fs.readFileSync(coursePath, "utf-8"));
  return CourseSchema.parse(raw);
}

export function allLessonIds(): string[] {
  const contentDir = fs.readdirSync(CONTENT_ROOT);
  const ids: string[] = [];
  for (const lang of contentDir) {
    if (lang.startsWith("_")) continue;
    const coursePath = path.join(CONTENT_ROOT, lang, "course.json");
    if (!fs.existsSync(coursePath)) continue;
    const course = loadCourse(lang);
    ids.push(...course.lessons.map((l) => l.lessonId));
  }
  return ids;
}
