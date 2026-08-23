"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeSentenceIdAt, indexOfSentence, type TimelineEntry } from "./timeline";

// How long a manual scroll keeps the page from following the audio.
const MANUAL_SCROLL_QUIET_MS = 4000;
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

export interface LessonAudio {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  setRate: (rate: number) => void;
  repeat: boolean;
  toggleRepeat: () => void;
  activeId: string | null;
  togglePlay: () => void;
  /** Seek to a sentence and keep playing through the rest of the scene. */
  playFrom: (id: string) => void;
  /** Play that one sentence, then stop, cued to replay it. */
  playOnly: (id: string) => void;
  step: (delta: 1 | -1) => void;
  shouldAutoScroll: () => boolean;
}

export function useLessonAudio(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  timeline: TimelineEntry[]
): LessonAudio {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(() =>
    timeline.length > 0 ? timeline[timeline.length - 1].end : 0
  );
  const [rate, setRate] = useState(1);
  const [repeat, setRepeat] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // The sentence the listener last picked, and whether playback should end there.
  const targetRef = useRef<string | null>(null);
  const soloRef = useRef(false);
  const repeatRef = useRef(repeat);
  const activeIdRef = useRef(activeId);
  const isPlayingRef = useRef(isPlaying);
  const lastManualScrollRef = useRef(0);

  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const entryById = useMemo(
    () => new Map(timeline.map((entry) => [entry.id, entry])),
    [timeline]
  );

  const sync = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = audio.currentTime;

    const holdId = repeatRef.current || soloRef.current ? targetRef.current : null;
    const hold = holdId ? entryById.get(holdId) : undefined;
    if (hold && time >= hold.end) {
      audio.currentTime = hold.start;
      if (!repeatRef.current) audio.pause();
      setCurrentTime(hold.start);
      setActiveId(hold.id);
      return;
    }

    setCurrentTime(time);
    setActiveId(activeSentenceIdAt(timeline, time));
  }, [audioRef, entryById, timeline]);

  // timeupdate fires about four times a second — too coarse to stop cleanly at a
  // sentence end, so drive the sync from rAF while playing and from events otherwise.
  useEffect(() => {
    if (!isPlaying) return;
    let frame = requestAnimationFrame(function loop() {
      sync();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, sync]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onStop = () => setIsPlaying(false);
    const onMetadata = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onStop);
    audio.addEventListener("ended", onStop);
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("seeked", sync);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onStop);
      audio.removeEventListener("ended", onStop);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("timeupdate", sync);
      audio.removeEventListener("seeked", sync);
    };
  }, [audioRef, sync]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [audioRef, rate]);

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

  const cueSentence = useCallback(
    (id: string, { solo, play }: { solo: boolean; play: boolean }) => {
      const audio = audioRef.current;
      const entry = entryById.get(id);
      if (!audio || !entry) return;
      soloRef.current = solo;
      targetRef.current = id;
      audio.currentTime = entry.start;
      setCurrentTime(entry.start);
      setActiveId(id);
      if (play) void audio.play().catch(() => {});
    },
    [audioRef, entryById]
  );

  const playFrom = useCallback(
    (id: string) => cueSentence(id, { solo: false, play: true }),
    [cueSentence]
  );

  const playOnly = useCallback(
    (id: string) => cueSentence(id, { solo: true, play: true }),
    [cueSentence]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      soloRef.current = false;
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [audioRef]);

  // Stepping keeps the current playing/paused state, so arrows can be used to scan.
  const step = useCallback(
    (delta: 1 | -1) => {
      if (timeline.length === 0) return;
      const current = indexOfSentence(timeline, activeIdRef.current);
      const next = current === -1 ? (delta === 1 ? 0 : timeline.length - 1) : current + delta;
      if (next < 0 || next >= timeline.length) return;
      cueSentence(timeline[next].id, { solo: false, play: isPlayingRef.current });
    },
    [cueSentence, timeline]
  );

  const toggleRepeat = useCallback(() => {
    if (!repeatRef.current && activeIdRef.current) targetRef.current = activeIdRef.current;
    setRepeat((on) => !on);
  }, []);

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

  return {
    isPlaying,
    currentTime,
    duration,
    rate,
    setRate,
    repeat,
    toggleRepeat,
    activeId,
    togglePlay,
    playFrom,
    playOnly,
    step,
    shouldAutoScroll,
  };
}
