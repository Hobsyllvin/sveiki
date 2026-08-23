import fs from "fs";
import path from "path";
import { LessonSchema, CourseSchema, AudioManifestSchema } from "./schema";
import type { Lesson, Course, AudioManifest } from "./schema";

const CONTENT_ROOT = path.join(process.cwd(), "content");

// One mp3 per sentence, named by the lesson's `audio` field, plus manifest.json
// recording each clip's duration. scripts/sync-audio.ts copies the mp3s to
// public/audio/<lang>/ so Next serves them as static assets.
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

/** Empty when no clip has been generated for this language yet. */
export function loadAudioManifest(lang: string): AudioManifest {
  const manifestPath = path.join(CONTENT_ROOT, lang, AUDIO_DIR_NAME, "manifest.json");
  if (!fs.existsSync(manifestPath)) return {};
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  return AudioManifestSchema.parse(raw);
}

export function audioSrc(lang: string, filename: string): string {
  return `/audio/${lang}/${filename}`;
}

export function langOf(lessonId: string): string {
  return langFromLessonId(lessonId);
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
