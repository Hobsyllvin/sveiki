"use client";

import { useEffect, useRef, useState } from "react";
import type { Sentence } from "@/lib/content/schema";

export type ViewMode = "decode" | "natural" | "latvian";

interface Props {
  sentence: Sentence;
  mode: ViewMode;
  showSpeaker?: boolean;
  openNoteId: string | null;
  onToggleNote: (id: string) => void;
  isActive?: boolean;
  /** Clicking the sentence body plays onward from here. */
  onPlayFrom?: () => void;
  /** The ▸ button plays this sentence alone. */
  onPlayOnly?: () => void;
  shouldAutoScroll?: () => boolean;
}

export default function InterlinearSentence({
  sentence,
  mode,
  showSpeaker,
  openNoteId,
  onToggleNote,
  isActive = false,
  onPlayFrom,
  onPlayOnly,
  shouldAutoScroll,
}: Props) {
  const [naturalOpen, setNaturalOpen] = useState(false);
  const blockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isActive || !blockRef.current) return;
    if (shouldAutoScroll && !shouldAutoScroll()) return;
    blockRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [isActive, shouldAutoScroll]);

  const handleBodyClick = () => {
    if (!onPlayFrom) return;
    // A click that ends a text selection is reading, not a request to play.
    if (window.getSelection()?.toString()) return;
    onPlayFrom();
  };

  const showMeta = Boolean(onPlayOnly) || Boolean(showSpeaker && sentence.speaker);

  return (
    <div
      ref={blockRef}
      className={`sentence-block${isActive ? " sentence-block--active" : ""}${
        onPlayFrom ? " sentence-block--seekable" : ""
      }`}
      aria-current={isActive ? "true" : undefined}
      onClick={handleBodyClick}
    >
      {showMeta && (
        <div className="sentence-meta">
          {onPlayOnly && (
            <button
              className="sentence-play"
              onClick={(event) => {
                event.stopPropagation();
                onPlayOnly();
              }}
              aria-label={`Play just this sentence: ${sentence.target}`}
            >
              ▸
            </button>
          )}
          {showSpeaker && sentence.speaker && (
            <span className="speaker-label">{sentence.speaker}</span>
          )}
        </div>
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
                    onClick={(e) => {
                      if (token.note) {
                        e.stopPropagation();
                        onToggleNote(tid);
                      }
                    }}
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
            onClick={(e) => {
              e.stopPropagation();
              setNaturalOpen((v) => !v);
            }}
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
