"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { indexOfClip, totalDuration, type Clip } from "./playlist";

// A breath between sentences while a lesson plays through. Long enough to hear the
// seam, short enough not to feel like the audio stopped.
const SENTENCE_GAP_MS = 250;
// How long a manual scroll keeps the page from following the audio.
const MANUAL_SCROLL_QUIET_MS = 4000;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

export interface LessonAudio {
  isPlaying: boolean;
  /** Seconds into the lesson as a whole, for the readout. */
  position: number;
  duration: number;
  rate: number;
  setRate: (rate: number) => void;
  repeat: boolean;
  toggleRepeat: () => void;
  activeId: string | null;
  togglePlay: () => void;
  /** Play this sentence and carry on through the lesson. */
  playFrom: (id: string) => void;
  /** Play this sentence alone, then stop, cued to replay it. */
  playOnly: (id: string) => void;
  step: (delta: 1 | -1) => void;
  shouldAutoScroll: () => boolean;
}

export function useLessonAudio(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  preloadRef: React.RefObject<HTMLAudioElement | null>,
  playlist: Clip[]
): LessonAudio {
  const [index, setIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipTime, setClipTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [repeat, setRepeat] = useState(false);

  const soloRef = useRef(false);
  const repeatRef = useRef(repeat);
  const indexRef = useRef(index);
  const isPlayingRef = useRef(isPlaying);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastManualScrollRef = useRef(0);

  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const clearGap = useCallback(() => {
    if (gapTimerRef.current !== null) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearGap, [clearGap]);

  // Boundaries are file boundaries: loading a clip *is* seeking to a sentence, so
  // there is no time arithmetic here that could drift out of step with the audio.
  const load = useCallback(
    (target: number, { solo, play }: { solo: boolean; play: boolean }) => {
      const audio = audioRef.current;
      const clip = playlist[target];
      if (!audio || !clip) return;
      clearGap();
      soloRef.current = solo;
      setIndex(target);
      indexRef.current = target;
      setClipTime(0);
      if (audio.src !== clip.src) audio.src = clip.src;
      audio.currentTime = 0;
      if (play) void audio.play().catch(() => {});
    },
    [audioRef, clearGap, playlist]
  );

  const playFrom = useCallback(
    (id: string) => load(indexOfClip(playlist, id), { solo: false, play: true }),
    [load, playlist]
  );

  const playOnly = useCallback(
    (id: string) => load(indexOfClip(playlist, id), { solo: true, play: true }),
    [load, playlist]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (indexRef.current === null) {
      load(0, { solo: false, play: true });
      return;
    }
    if (audio.paused) {
      soloRef.current = false;
      void audio.play().catch(() => {});
    } else {
      clearGap();
      audio.pause();
    }
  }, [audioRef, clearGap, load]);

  // Stepping keeps the current playing/paused state, so arrows can be used to scan.
  const step = useCallback(
    (delta: 1 | -1) => {
      if (playlist.length === 0) return;
      const current = indexRef.current;
      const next = current === null ? (delta === 1 ? 0 : playlist.length - 1) : current + delta;
      if (next < 0 || next >= playlist.length) return;
      load(next, { solo: false, play: isPlayingRef.current });
    },
    [load, playlist]
  );

  const toggleRepeat = useCallback(() => setRepeat((on) => !on), []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setClipTime(audio.currentTime);
    const onEnded = () => {
      if (repeatRef.current) {
        audio.currentTime = 0;
        setClipTime(0);
        void audio.play().catch(() => {});
        return;
      }
      const current = indexRef.current;
      if (soloRef.current || current === null) {
        setIsPlaying(false);
        setClipTime(0);
        audio.currentTime = 0;
        return;
      }
      if (current + 1 >= playlist.length) {
        setIsPlaying(false);
        return;
      }
      // Held as playing across the gap: the lesson has not stopped, it is breathing.
      gapTimerRef.current = setTimeout(() => {
        gapTimerRef.current = null;
        load(current + 1, { solo: false, play: true });
      }, SENTENCE_GAP_MS);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioRef, load, playlist.length]);

  // Smooth position readout: timeupdate alone fires about four times a second.
  useEffect(() => {
    if (!isPlaying) return;
    let frame = requestAnimationFrame(function loop() {
      if (audioRef.current) setClipTime(audioRef.current.currentTime);
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [audioRef, isPlaying]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [audioRef, rate]);

  // Warm the next clip so the gap stays a gap and not a buffering pause.
  useEffect(() => {
    const next = index === null ? null : playlist[index + 1];
    if (preloadRef.current && next) preloadRef.current.src = next.src;
  }, [index, playlist, preloadRef]);

  // Wheel, touch and scroll keys are user intent; the scroll event itself is not,
  // since scrollIntoView would then suppress the next auto-scroll.
  useEffect(() => {
    const mark = () => {
      lastManualScrollRef.current = Date.now();
    };
    const markOnKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) mark();
    };
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchmove", mark, { passive: true });
    window.addEventListener("keydown", markOnKey);
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchmove", mark);
      window.removeEventListener("keydown", markOnKey);
    };
  }, []);

  const shouldAutoScroll = useCallback(
    () => Date.now() - lastManualScrollRef.current > MANUAL_SCROLL_QUIET_MS,
    []
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const onControl = target?.closest(
        "button, a, input, textarea, select, [role='button'], [contenteditable='true']"
      );
      if (event.key === " ") {
        if (onControl) return;
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [step, togglePlay]);

  const current = index === null ? null : playlist[index];

  return {
    isPlaying,
    position: current ? current.offset + clipTime : 0,
    duration: totalDuration(playlist),
    rate,
    setRate,
    repeat,
    toggleRepeat,
    activeId: current?.id ?? null,
    togglePlay,
    playFrom,
    playOnly,
    step,
    shouldAutoScroll,
  };
}
