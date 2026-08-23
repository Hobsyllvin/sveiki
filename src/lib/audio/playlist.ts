import type { AudioManifest, Lesson } from "@/lib/content/schema";

export interface Clip {
  id: string;
  src: string;
  duration: number;
  /** Seconds of audio before this clip, for the position readout. Gaps are not counted. */
  offset: number;
}

/**
 * One clip per sentence, in lesson order. Sentences with no generated clip are left
 * out rather than faked, so a half-generated lesson plays the part that exists.
 */
export function buildPlaylist(
  lesson: Lesson,
  manifest: AudioManifest,
  lang: string
): Clip[] {
  const clips: Clip[] = [];
  let offset = 0;
  for (const section of lesson.sections) {
    for (const sentence of section.sentences) {
      const entry = manifest[sentence.audio];
      if (!entry) continue;
      clips.push({
        id: sentence.id,
        src: `/audio/${lang}/${sentence.audio}`,
        duration: entry.durationSeconds,
        offset,
      });
      offset += entry.durationSeconds;
    }
  }
  return clips;
}

export function totalDuration(playlist: Clip[]): number {
  const last = playlist[playlist.length - 1];
  return last ? last.offset + last.duration : 0;
}

export function indexOfClip(playlist: Clip[], id: string | null): number {
  return id === null ? -1 : playlist.findIndex((clip) => clip.id === id);
}
