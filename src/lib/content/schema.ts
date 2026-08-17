import { z } from "zod";

export const TokenSchema = z.object({
  lv: z.string().min(1),
  gloss: z
    .string()
    .min(1)
    .regex(/^\S+$/, "gloss must not contain spaces — use hyphens for multi-word glosses"),
  lemma: z.string().min(1),
  pos: z.enum([
    "noun",
    "verb",
    "adj",
    "adv",
    "pron",
    "prep",
    "conj",
    "propn",
    "num",
    "part",
    "interj",
  ]),
  note: z.string().max(60).optional(),
  // Punctuation immediately following this token in the source sentence, no space
  // between (e.g. "?", "?!"). A leading space is allowed only for a free-standing
  // em dash used as a mid-sentence break (see GLOSSING_RULES.md). lv itself stays
  // punctuation-free.
  punct: z
    .string()
    .max(3)
    .regex(/^ ?[.,!?—]{1,2}$/, "punct must be 1-2 punctuation marks, optionally preceded by a single space for a free-standing em dash")
    .optional(),
});

export type Token = z.infer<typeof TokenSchema>;

export const SentenceSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().optional(),
  target: z.string().min(1),
  tokens: z.array(TokenSchema).min(1),
  natural: z.string().min(1),
  audio: z.string().regex(/\.mp3$/, "audio filename must end with .mp3"),
  audioApproved: z.boolean(),
});

export type Sentence = z.infer<typeof SentenceSchema>;

export const SectionSchema = z.object({
  format: z.enum(["dialogue", "drill", "narration"]),
  title: z.string().min(1),
  sentences: z.array(SentenceSchema).min(1),
});

export type Section = z.infer<typeof SectionSchema>;

export const LessonSchema = z.object({
  lessonId: z
    .string()
    .regex(/^[a-z]{2}-[a-z]\d-\d{2}$/, "lessonId must match pattern: lv-a1-00"),
  title: z.string().min(1),
  cefr: z.enum(["A1", "A2", "B1", "B2"]),
  newLemmas: z.array(z.string()),
  sections: z.array(SectionSchema).min(1),
});

export type Lesson = z.infer<typeof LessonSchema>;

export const DictionaryEntrySchema = z.object({
  glosses: z.array(z.string()).min(1),
  note: z.string().optional(),
  seeAlso: z.array(z.string()).optional(),
  needsNativeReview: z.boolean().optional(),
});

export type DictionaryEntry = z.infer<typeof DictionaryEntrySchema>;

export const DictionarySchema = z.record(z.string(), DictionaryEntrySchema);

export type Dictionary = z.infer<typeof DictionarySchema>;

export const CourseLessonSchema = z.object({
  lessonId: z.string().min(1),
  theme: z.string().min(1),
  cefr: z.enum(["A1", "A2", "B1", "B2"]),
  newLemmas: z.array(z.string()).optional(),
});

export type CourseLessonEntry = z.infer<typeof CourseLessonSchema>;

export const CourseSchema = z.object({
  language: z.string().min(1),
  languageName: z.string().min(1),
  glossLanguage: z.string().min(1),
  glossingRules: z.string().min(1),
  lessons: z.array(CourseLessonSchema),
});

export type Course = z.infer<typeof CourseSchema>;
