import type { AudioTimings, Lesson } from "@/lib/content/schema";

export interface TimelineEntry {
  id: string;
  start: number;
  end: number;
}

/** Sentences in lesson (= playback) order, skipping any the timings file lacks. */
export function buildTimeline(
  lesson: Lesson,
  timings: AudioTimings | null
): TimelineEntry[] {
  if (!timings) return [];
  const entries: TimelineEntry[] = [];
  for (const section of lesson.sections) {
    for (const sentence of section.sentences) {
      const timing = timings.sentences[sentence.id];
      if (timing) entries.push({ id: sentence.id, start: timing.start, end: timing.end });
    }
  }
  return entries;
}

/**
 * Ranges are half-open, so at a shared boundary the later sentence wins — seeking
 * to a sentence's start lands on that sentence. The final end is inclusive so the
 * last sentence stays lit until playback stops.
 */
export function activeSentenceIdAt(
  timeline: TimelineEntry[],
  time: number
): string | null {
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i];
    if (time < entry.start) break;
    const isLast = i === timeline.length - 1;
    if (time < entry.end || (isLast && time <= entry.end)) return entry.id;
  }
  return null;
}

export function indexOfSentence(timeline: TimelineEntry[], id: string | null): number {
  return id === null ? -1 : timeline.findIndex((entry) => entry.id === id);
}
