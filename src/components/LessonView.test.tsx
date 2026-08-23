import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import LessonView from "./LessonView";
import type { Clip } from "@/lib/audio/playlist";
import type { Lesson } from "@/lib/content/schema";

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
          speaker: "ANNA",
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

const playlist: Clip[] = [
  { id: "s1", src: "/audio/lv/lv-a1-01-s1.mp3", duration: 1.68, offset: 0 },
  { id: "s2", src: "/audio/lv/lv-a1-01-s2.mp3", duration: 0.88, offset: 1.68 },
  { id: "s3", src: "/audio/lv/lv-a1-01-s3.mp3", duration: 2.4, offset: 2.56 },
];

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
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  time = 0;
  play.mockClear();
  pause.mockClear();
});

function renderWithAudio() {
  const view = render(<LessonView lesson={lesson} playlist={playlist} />);
  const elements = view.container.querySelectorAll("audio");
  return { ...view, audio: elements[0], preload: elements[1] };
}

const sentenceBody = (target: string) => screen.getByRole("group", { name: target });
const soloButton = (target: string) =>
  screen.getByRole("button", { name: `Play just this sentence: ${target}` });

describe("LessonView — lesson with no generated audio", () => {
  it("renders the text with no player and no errors", () => {
    const { container } = render(<LessonView lesson={lesson} playlist={[]} />);
    expect(screen.getByText("Labdien")).toBeInTheDocument();
    expect(container.querySelector("audio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Play just this sentence/ })).not.toBeInTheDocument();
    expect(container.querySelector('[aria-current="true"]')).toBeNull();
  });
});

describe("LessonView — partly generated lesson", () => {
  it("offers playback only for the sentences that have a clip", () => {
    render(<LessonView lesson={lesson} playlist={[playlist[0]]} />);
    expect(soloButton("Labdien!")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /just this sentence: Sveiki!/ })).not.toBeInTheDocument();
  });
});

describe("LessonView — player", () => {
  it("mounts the transport controls and the total lesson duration", () => {
    renderWithAudio();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /repeat sentence/i })).toBeInTheDocument();
    // 1.68 + 0.88 + 2.4 = 4.96s
    expect(screen.getByText(/0:04/)).toBeInTheDocument();
  });

  it("keeps the audio element mounted across view-mode switches", () => {
    const { container, audio } = renderWithAudio();
    fireEvent.click(screen.getByRole("button", { name: "Natural" }));
    fireEvent.click(screen.getByRole("button", { name: "Latvian" }));
    expect(container.querySelectorAll("audio")[0]).toBe(audio);
  });

  it("starts at the first sentence when nothing has been selected yet", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(audio.src).toContain("lv-a1-01-s1.mp3");
    expect(play).toHaveBeenCalled();
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

describe("LessonView — clip selection", () => {
  it("clicking a sentence loads that clip and plays", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(sentenceBody("Sveiki!"));
    expect(audio.src).toContain("lv-a1-01-s2.mp3");
    expect(play).toHaveBeenCalled();
  });

  it("marks the loaded sentence as current", () => {
    const { container } = renderWithAudio();
    fireEvent.click(sentenceBody("Sveiki!"));
    const active = container.querySelector('[aria-current="true"]');
    expect(active!.textContent).toContain("Sveiki");
  });

  it("reports the position as an offset into the whole lesson", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(sentenceBody("Paldies."));
    time = 0.44;
    fireEvent(audio, new Event("timeupdate"));
    // 2.56s of earlier clips plus 0.44s into this one.
    expect(screen.getByText(/0:03/)).toBeInTheDocument();
  });

  it("preloads the following clip", () => {
    const { preload } = renderWithAudio();
    fireEvent.click(sentenceBody("Labdien!"));
    expect(preload.src).toContain("lv-a1-01-s2.mp3");
  });

  it("arrow keys step between clips", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(sentenceBody("Sveiki!"));

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(audio.src).toContain("lv-a1-01-s3.mp3");

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(audio.src).toContain("lv-a1-01-s2.mp3");
  });
});

describe("LessonView — chaining", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances to the next clip after the gap", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(sentenceBody("Labdien!"));
    expect(audio.src).toContain("lv-a1-01-s1.mp3");

    fireEvent(audio, new Event("ended"));
    expect(audio.src).toContain("lv-a1-01-s1.mp3");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(audio.src).toContain("lv-a1-01-s2.mp3");
  });

  it("stops at the end of the lesson", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(sentenceBody("Paldies."));
    fireEvent(audio, new Event("ended"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(audio.src).toContain("lv-a1-01-s3.mp3");
  });

  it("a solo sentence does not chain onward", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(soloButton("Labdien!"));
    fireEvent(audio, new Event("ended"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(audio.src).toContain("lv-a1-01-s1.mp3");
  });

  it("repeat replays the same clip instead of advancing", () => {
    const { audio } = renderWithAudio();
    fireEvent.click(sentenceBody("Labdien!"));
    fireEvent.click(screen.getByRole("button", { name: /repeat sentence/i }));
    play.mockClear();

    fireEvent(audio, new Event("ended"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(audio.src).toContain("lv-a1-01-s1.mp3");
    expect(play).toHaveBeenCalled();
  });
});
