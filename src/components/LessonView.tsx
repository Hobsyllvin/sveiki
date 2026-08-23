"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { AudioTimings, Lesson } from "@/lib/content/schema";
import { buildTimeline } from "@/lib/audio/timeline";
import { useLessonAudio } from "@/lib/audio/useLessonAudio";
import InterlinearSentence, { type ViewMode } from "./InterlinearSentence";
import LessonModeToggle from "./LessonModeToggle";
import AudioPlayer from "./AudioPlayer";

interface Props {
  lesson: Lesson;
  timings?: AudioTimings | null;
  audioSrc?: string | null;
}

export default function LessonView({ lesson, timings = null, audioSrc = null }: Props) {
  const [mode, setMode] = useState<ViewMode>("decode");
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timeline = useMemo(() => buildTimeline(lesson, timings), [lesson, timings]);
  const audio = useLessonAudio(audioRef, timeline);
  const hasAudio = audioSrc !== null && timeline.length > 0;

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
              {section.sentences.map((sentence) => (
                <InterlinearSentence
                  key={sentence.id}
                  sentence={sentence}
                  mode={mode}
                  showSpeaker={section.format === "dialogue"}
                  openNoteId={openNoteId}
                  onToggleNote={handleToggleNote}
                  isActive={hasAudio && audio.activeId === sentence.id}
                  onPlayFrom={hasAudio ? () => audio.playFrom(sentence.id) : undefined}
                  onPlayOnly={hasAudio ? () => audio.playOnly(sentence.id) : undefined}
                  shouldAutoScroll={audio.shouldAutoScroll}
                />
              ))}
            </div>
          </section>
        ))}
      </main>

      {hasAudio && (
        <>
          {/* Mounted outside the mode-dependent tree so playback survives view switches. */}
          <audio ref={audioRef} src={audioSrc} preload="metadata" />
          <AudioPlayer
            isPlaying={audio.isPlaying}
            currentTime={audio.currentTime}
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
