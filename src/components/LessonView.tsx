"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { Lesson } from "@/lib/content/schema";
import type { Clip } from "@/lib/audio/playlist";
import { useLessonAudio } from "@/lib/audio/useLessonAudio";
import InterlinearSentence, { type ViewMode } from "./InterlinearSentence";
import LessonModeToggle from "./LessonModeToggle";
import AudioPlayer from "./AudioPlayer";

interface Props {
  lesson: Lesson;
  playlist?: Clip[];
}

export default function LessonView({ lesson, playlist = [] }: Props) {
  const [mode, setMode] = useState<ViewMode>("decode");
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);

  const audio = useLessonAudio(audioRef, preloadRef, playlist);
  const hasAudio = playlist.length > 0;
  const playable = new Set(playlist.map((clip) => clip.id));

  const handleToggleNote = (id: string) => {
    setOpenNoteId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="lesson-view">
      <header className="lesson-header">
        <Link href="/" className="back-link">← all lessons</Link>
        <div className="lesson-title-row">
          <h1 className="lesson-title">{lesson.title}</h1>
          <span className="cefr-badge">{lesson.cefr}</span>
        </div>
        <LessonModeToggle mode={mode} onChange={setMode} />
      </header>

      <main className="lesson-sections">
        {lesson.sections.map((section) => (
          <section key={section.title} className={`lesson-section section-${section.format}`}>
            <div className={`${section.format}-block`}>
              {section.sentences.map((sentence) => {
                const canPlay = playable.has(sentence.id);
                return (
                  <InterlinearSentence
                    key={sentence.id}
                    sentence={sentence}
                    mode={mode}
                    showSpeaker={section.format === "dialogue"}
                    openNoteId={openNoteId}
                    onToggleNote={handleToggleNote}
                    isActive={audio.activeId === sentence.id}
                    onPlayFrom={canPlay ? () => audio.playFrom(sentence.id) : undefined}
                    onPlayOnly={canPlay ? () => audio.playOnly(sentence.id) : undefined}
                    shouldAutoScroll={audio.shouldAutoScroll}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {hasAudio && (
        <>
          {/* Outside the mode-dependent tree so playback survives view switches. The
              second element only warms the next clip; it is never played. */}
          <audio ref={audioRef} preload="auto" />
          <audio ref={preloadRef} preload="auto" muted aria-hidden="true" />
          <AudioPlayer
            isPlaying={audio.isPlaying}
            currentTime={audio.position}
            duration={audio.duration}
            rate={audio.rate}
            onRateChange={audio.setRate}
            repeat={audio.repeat}
            onToggleRepeat={audio.toggleRepeat}
            onTogglePlay={audio.togglePlay}
          />
        </>
      )}
    </div>
  );
}
