"use client";

import { useEffect, useRef } from "react";
import type { Sentence } from "@/lib/content/schema";

export type ViewMode = "decode" | "natural" | "latvian";

interface Props {
  sentence: Sentence;
  mode: ViewMode;
  showSpeaker?: boolean;
  openNoteId: string | null;
  onToggleNote: (id: string) => void;
  onOpenNote?: (id: string) => void;
  onCloseNote?: (id: string) => void;
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
  onOpenNote,
  onCloseNote,
  isActive = false,
  onPlayFrom,
  onPlayOnly,
  shouldAutoScroll,
}: Props) {
  const blockRef = useRef<HTMLDivElement | null>(null);
  const openedByHoverRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isActive || !blockRef.current) return;
    if (shouldAutoScroll && !shouldAutoScroll()) return;
    return scrollSentenceIntoView(blockRef.current, shouldAutoScroll);
  }, [isActive, shouldAutoScroll]);

  const handleBodyClick = () => {
    if (!onPlayFrom) return;
    // A click that ends a text selection is reading, not a request to play.
    if (window.getSelection()?.toString()) return;
    onPlayFrom();
  };

  return (
    <div
      ref={blockRef}
      className={`sentence-block${isActive ? " sentence-block--active" : ""}${
        onPlayFrom ? " sentence-block--seekable" : ""
      }`}
      aria-current={isActive ? "true" : undefined}
      onClick={handleBodyClick}
    >
      <div className="sentence-gutter">
        {showSpeaker && sentence.speaker && (
          <span className="speaker-label">{sentence.speaker}</span>
        )}
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
      </div>

      <div className="sentence-content">
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
                          if (openedByHoverRef.current === tid) {
                            openedByHoverRef.current = null;
                            return;
                          }
                          if (isOpen) onCloseNote?.(tid);
                          else onOpenNote?.(tid);
                          if (!onOpenNote || !onCloseNote) onToggleNote(tid);
                        }
                      }}
                      onPointerEnter={() => {
                        if (token.note && !isOpen) {
                          openedByHoverRef.current = tid;
                          onOpenNote?.(tid);
                        }
                      }}
                      onPointerLeave={() => {
                        if (token.note && isOpen) {
                          openedByHoverRef.current = null;
                          onCloseNote?.(tid);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (token.note && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          if (isOpen) onCloseNote?.(tid);
                          else onOpenNote?.(tid);
                          if (!onOpenNote || !onCloseNote) onToggleNote(tid);
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
      </div>
    </div>
  );
}

const AUTO_SCROLL_DURATION_MS = 700;

function scrollSentenceIntoView(element: HTMLElement, shouldAutoScroll?: () => boolean) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const startY = window.scrollY;
  const rect = element.getBoundingClientRect();
  const targetY = Math.max(
    0,
    startY + rect.top - (window.innerHeight - rect.height) / 2
  );

  if (reduceMotion) {
    window.scrollTo(0, targetY);
    return;
  }

  const distance = targetY - startY;
  if (Math.abs(distance) < 1) return;
  const startedAt = performance.now();
  let frameId = 0;
  const easeInOut = (progress: number) =>
    progress < 0.5 ? 4 * progress * progress * progress : 1 - (-2 * progress + 2) ** 3 / 2;

  const frame = (now: number) => {
    if (shouldAutoScroll && !shouldAutoScroll()) return;
    const progress = Math.min((now - startedAt) / AUTO_SCROLL_DURATION_MS, 1);
    window.scrollTo(0, startY + distance * easeInOut(progress));
    if (progress < 1) frameId = requestAnimationFrame(frame);
  };

  frameId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(frameId);
}
