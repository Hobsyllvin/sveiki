import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LessonView from "./LessonView";
import type { AudioTimings, Lesson } from "@/lib/content/schema";

const lesson: Lesson = {
  lessonId: "lv-a1-01",
  title: "Iepazīšanās",
  cefr: "A1",
  newLemmas: [],
  sections: [
    {
      format: "dialogue",
      title: "Saruna",
      sentences: [
        {
          id: "s1",
          speaker: "PĒTERIS",
          target: "Labdien!",
          tokens: [{ lv: "Labdien", gloss: "good-day", lemma: "labdiena", pos: "interj" }],
          natural: "Hello!",
          audio: "lv-a1-01-s1.mp3",
          audioApproved: false,
        },
        {
          id: "s2",
          speaker: "SVETLANA",
          target: "Sveiki!",
          tokens: [{ lv: "Sveiki", gloss: "hello", lemma: "sveiks", pos: "interj" }],
          natural: "Hi!",
          audio: "lv-a1-01-s2.mp3",
          audioApproved: false,
        },
        {
          id: "s3",
          speaker: "PĒTERIS",
          target: "Paldies.",
          tokens: [{ lv: "Paldies", gloss: "thanks", lemma: "paldies", pos: "interj" }],
          natural: "Thanks.",
          audio: "lv-a1-01-s3.mp3",
          audioApproved: false,
        },
      ],
    },
  ],
};

const timings: AudioTimings = {
  audio: "lv-a1-01.mp3",
  sentences: {
    s1: { start: 0, end: 1.84 },
    s2: { start: 1.84, end: 2.8 },
    s3: { start: 2.8, end: 5.5 },
  },
};

// jsdom implements none of the media API, so stand in for the parts the player touches.
let time = 0;
const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value;
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "playbackRate", {
    configurable: true,
    writable: true,
    value: 1,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: play,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: pause,
  });
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  time = 0;
  play.mockClear();
  pause.mockClear();
});

function renderWithAudio() {
  const view = render(
    <LessonView lesson={lesson} timings={timings} audioSrc="/audio/lv/lv-a1-01.mp3" />
  );
  const audio = view.container.querySelector("audio")!;
  return { ...view, audio };
}

const sentenceBody = (target: string) => screen.getByRole("group", { name: target });

describe("LessonView — lesson without audio", () => {
  it("renders the lesson with no player and no audio element", () => {
    const { container } = render(<LessonView lesson={lesson} timings={null} audioSrc={null} />);
    expect(screen.getByText("Labdien")).toBeInTheDocument();
    expect(container.querySelector("audio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play just this sentence/ })).not.toBeInTheDocument();
    expect(container.querySelector('[aria-current="true"]')).toBeNull();
  });
});

describe("LessonView — player", () => {
  it("mounts one audio element and the transport controls", () => {
    const { audio } = renderWithAudio();
    expect(audio).toHaveAttribute("src", "/audio/lv/lv-a1-01.mp3");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /repeat sentence/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the audio element mounted across view-mode switches", () => {
    const { container, audio } = renderWithAudio();
    fireEvent.click(screen.getByRole("button", { name: "Natural" }));
    fireEvent.click(screen.getByRole("button", { name: "Latvian" }));
    expect(container.querySelector("audio")).toBe(audio);
  });

  it("space toggles playback, but not while a control is focused", () => {
    renderWithAudio();
    fireEvent.keyDown(document.body, { key: " " });
    expect(play).toHaveBeenCalledTimes(1);

    const disclosures = screen.getAllByRole("button", { name: /natural translation/i });
    fireEvent.keyDown(disclosures[0], { key: " " });
    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe("LessonView — sync", () => {
  it("highlights the sentence whose range contains the current time", () => {
    const { container, audio } = renderWithAudio();
    time = 2.0;
    fireEvent(audio, new Event("timeupdate"));

    const active = container.querySelector('[aria-current="true"]');
    expect(active).not.toBeNull();
    expect(active!.textContent).toContain("Sveiki");
  });

  it("clicking a sentence seeks to its start and plays onward", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(sentenceBody("Sveiki!"));
    expect(audio.currentTime).toBe(1.84);
    expect(play).toHaveBeenCalled();

    // Playing onward means no boundary: passing the sentence end does not pause.
    time = 2.9;
    fireEvent(audio, new Event("timeupdate"));
    expect(pause).not.toHaveBeenCalled();
    expect(audio.currentTime).toBe(2.9);
  });

  it("the per-sentence button plays that sentence alone and stops at its end", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(screen.getByRole("button", { name: /Play just this sentence: Sveiki!/ }));
    expect(audio.currentTime).toBe(1.84);

    time = 2.85;
    fireEvent(audio, new Event("timeupdate"));
    expect(pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(1.84);
  });

  it("repeat loops the selected sentence instead of stopping", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(sentenceBody("Sveiki!"));
    fireEvent.click(screen.getByRole("button", { name: /repeat sentence/i }));

    time = 2.85;
    fireEvent(audio, new Event("timeupdate"));
    expect(audio.currentTime).toBe(1.84);
    expect(pause).not.toHaveBeenCalled();
  });

  it("arrow keys step to the neighbouring sentence", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(sentenceBody("Sveiki!"));

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(audio.currentTime).toBe(2.8);

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(audio.currentTime).toBe(1.84);
  });
});
