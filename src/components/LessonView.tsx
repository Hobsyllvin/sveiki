"use client";

import { useState } from "react";
import Link from "next/link";
import type { Lesson } from "@/lib/content/schema";
import InterlinearSentence, { type ViewMode } from "./InterlinearSentence";
import LessonModeToggle from "./LessonModeToggle";

interface Props {
  lesson: Lesson;
}

export default function LessonView({ lesson }: Props) {
  const [mode, setMode] = useState<ViewMode>("decode");
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

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
                />
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
