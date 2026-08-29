import fs from "fs";
import path from "path";
import { LessonSchema, CourseSchema, AudioTimingsSchema, TimingEditsSchema } from "./schema";
import type { Lesson, Course, AudioTimings, TimingEdits } from "./schema";

const CONTENT_ROOT = path.join(process.cwd(), "content");

// Each whole-scene take and its timings live in the single canonical audio directory;
// scripts/sync-audio.ts mirrors MP3s into public/audio/<lang>/ for serving.
export const AUDIO_DIR_NAME = "audio";

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

export function timingsPathFor(lessonId: string): string {
  const lang = langFromLessonId(lessonId);
  return path.join(
    CONTENT_ROOT,
    lang,
    AUDIO_DIR_NAME,
    `${lessonId}.timings.json`
  );
}

export function timingEditsPathFor(lessonId: string): string {
  const lang = langFromLessonId(lessonId);
  return path.join(
    CONTENT_ROOT,
    lang,
    AUDIO_DIR_NAME,
    `${lessonId}.timings.edits.json`
  );
}

/** A corrected boundary is a human judgement about the audio, so it wins. */
export function mergeTimingEdits(timings: AudioTimings, edits: TimingEdits): AudioTimings {
  return { ...timings, sentences: { ...timings.sentences, ...edits.sentences } };
}

export function loadTimingEdits(lessonId: string): TimingEdits | null {
  const editsPath = timingEditsPathFor(lessonId);
  if (!fs.existsSync(editsPath)) return null;
  return TimingEditsSchema.parse(JSON.parse(fs.readFileSync(editsPath, "utf-8")));
}

export function loadTimings(lessonId: string): AudioTimings | null {
  const timingsPath = timingsPathFor(lessonId);
  if (!fs.existsSync(timingsPath)) return null;
  const timings = AudioTimingsSchema.parse(JSON.parse(fs.readFileSync(timingsPath, "utf-8")));
  const edits = loadTimingEdits(lessonId);
  return edits ? mergeTimingEdits(timings, edits) : timings;
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
