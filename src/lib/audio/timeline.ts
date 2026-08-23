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
 * The sentence whose start is the most recent one passed. At a shared boundary the
 * later sentence wins, so seeking to a sentence's start lands on that sentence.
 *
 * Corrected boundaries may leave a pause belonging to neither neighbour; through such
 * a gap — and through any trailing silence — the sentence just heard stays lit rather
 * than the highlight blinking off mid-scene. Before the first start, nothing is active.
 */
export function activeSentenceIdAt(
  timeline: TimelineEntry[],
  time: number
): string | null {
  let active: string | null = null;
  for (const entry of timeline) {
    if (entry.start > time) break;
    active = entry.id;
  }
  return active;
}

export function indexOfSentence(timeline: TimelineEntry[], id: string | null): number {
  return id === null ? -1 : timeline.findIndex((entry) => entry.id === id);
}
