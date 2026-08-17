"use client";

import { useState } from "react";
import type { Sentence } from "@/lib/content/schema";

export type ViewMode = "decode" | "natural" | "latvian";

interface Props {
  sentence: Sentence;
  mode: ViewMode;
  showSpeaker?: boolean;
  openNoteId: string | null;
  onToggleNote: (id: string) => void;
}

export default function InterlinearSentence({
  sentence,
  mode,
  showSpeaker,
  openNoteId,
  onToggleNote,
}: Props) {
  const [naturalOpen, setNaturalOpen] = useState(false);

  return (
    <div className="sentence-block">
      {showSpeaker && sentence.speaker && (
        <span className="speaker-label">{sentence.speaker}</span>
      )}

      {mode === "decode" && (
        <div className="token-row" role="group" aria-label={sentence.target}>
          {sentence.tokens.map((token, i) => {
            const tid = `${sentence.id}:${i}`;
            const isOpen = openNoteId === tid;
            return (
              <span key={tid} className="token-pair">
                <span className="lv-line">
                  <span
                    className={`lv-word${token.note ? " has-note" : ""}`}
                    onClick={() => token.note && onToggleNote(tid)}
                    onKeyDown={(e) => {
                      if (token.note && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onToggleNote(tid);
                      }
                    }}
                    tabIndex={token.note ? 0 : undefined}
                    role={token.note ? "button" : undefined}
                    aria-expanded={token.note ? isOpen : undefined}
                    aria-label={token.note ? `${token.lv} — tap for note` : undefined}
                  >
                    {token.lv}
                  </span>
                  {token.punct && <span className="lv-punct">{token.punct}</span>}
                </span>
                <span className="gloss-word">{token.gloss}</span>
                {token.note && isOpen && (
                  <span className="note-bubble" role="status">
                    {token.note}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {mode === "natural" && (
        <div className="natural-mode-sentence">
          <p className="lv-sentence">{sentence.target}</p>
          <p className="natural-translation">{sentence.natural}</p>
        </div>
      )}

      {mode === "latvian" && (
        <p className="lv-sentence">{sentence.target}</p>
      )}

      {mode === "decode" && (
        <div className="natural-toggle-row">
          <button
            className="natural-toggle"
            onClick={() => setNaturalOpen((v) => !v)}
            aria-expanded={naturalOpen}
          >
            {naturalOpen ? "▴" : "▾"} natural translation
          </button>
          {naturalOpen && (
            <p className="natural-translation-inline">{sentence.natural}</p>
          )}
        </div>
      )}
    </div>
  );
}
