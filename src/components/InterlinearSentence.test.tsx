import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InterlinearSentence from "./InterlinearSentence";
import type { Sentence } from "@/lib/content/schema";

const sentence: Sentence = {
  id: "s3",
  target: "Es gribu pirkt maizi.",
  tokens: [
    { lv: "Es", gloss: "I", lemma: "es", pos: "pron" },
    { lv: "gribu", gloss: "want", lemma: "gribēt", pos: "verb", note: "1sg pres." },
    { lv: "pirkt", gloss: "to-buy", lemma: "pirkt", pos: "verb", note: "inf." },
    { lv: "maizi", gloss: "bread", lemma: "maize", pos: "noun", note: "acc." },
  ],
  natural: "I want to buy bread.",
  audio: "lv-a1-00-s3.mp3",
  audioApproved: false,
};

const sentenceNoNotes: Sentence = {
  id: "s1",
  speaker: "A",
  target: "Kur tu dzīvo?",
  tokens: [
    { lv: "Kur", gloss: "where", lemma: "kur", pos: "adv" },
    { lv: "tu", gloss: "you", lemma: "tu", pos: "pron" },
    { lv: "dzīvo", gloss: "live", lemma: "dzīvot", pos: "verb" },
  ],
  natural: "Where do you live?",
  audio: "lv-a1-00-s1.mp3",
  audioApproved: false,
};

describe("InterlinearSentence — decode mode", () => {
  it("renders all Latvian tokens in order", () => {
    render(<InterlinearSentence sentence={sentence} mode="decode" />);
    const words = ["Es", "gribu", "pirkt", "maizi"];
    for (const word of words) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
  });

  it("renders all glosses in order", () => {
    render(<InterlinearSentence sentence={sentence} mode="decode" />);
    const glosses = ["I", "want", "to-buy", "bread"];
    for (const gloss of glosses) {
      expect(screen.getByText(gloss)).toBeInTheDocument();
    }
  });

  it("natural translation is hidden by default", () => {
    render(<InterlinearSentence sentence={sentence} mode="decode" />);
    expect(screen.queryByText("I want to buy bread.")).not.toBeInTheDocument();
  });

  it("natural translation revealed after toggle click", () => {
    render(<InterlinearSentence sentence={sentence} mode="decode" />);
    const toggle = screen.getByRole("button", { name: /natural translation/i });
    fireEvent.click(toggle);
    expect(screen.getByText("I want to buy bread.")).toBeInTheDocument();
  });

  it("token with note exposes note via disclosure on click", () => {
    render(<InterlinearSentence sentence={sentence} mode="decode" />);
    const gribu = screen.getByText("gribu");
    expect(screen.queryByText("1sg pres.")).not.toBeInTheDocument();
    fireEvent.click(gribu);
    expect(screen.getByText("1sg pres.")).toBeInTheDocument();
  });

  it("token without note shows no dotted underline affordance", () => {
    render(<InterlinearSentence sentence={sentenceNoNotes} mode="decode" />);
    const kur = screen.getByText("Kur");
    expect(kur).not.toHaveClass("has-note");
  });
});

describe("InterlinearSentence — latvian-only mode", () => {
  it("renders no glosses", () => {
    render(<InterlinearSentence sentence={sentence} mode="latvian" />);
    expect(screen.queryByText("I")).not.toBeInTheDocument();
    expect(screen.queryByText("want")).not.toBeInTheDocument();
    expect(screen.queryByText("to-buy")).not.toBeInTheDocument();
    expect(screen.queryByText("bread")).not.toBeInTheDocument();
  });

  it("renders the target sentence", () => {
    render(<InterlinearSentence sentence={sentence} mode="latvian" />);
    expect(screen.getByText("Es gribu pirkt maizi.")).toBeInTheDocument();
  });
});

describe("InterlinearSentence — natural mode", () => {
  it("renders Latvian sentence and natural translation", () => {
    render(<InterlinearSentence sentence={sentence} mode="natural" />);
    expect(screen.getByText("Es gribu pirkt maizi.")).toBeInTheDocument();
    expect(screen.getByText("I want to buy bread.")).toBeInTheDocument();
  });

  it("renders no token-level glosses", () => {
    render(<InterlinearSentence sentence={sentence} mode="natural" />);
    expect(screen.queryByText("to-buy")).not.toBeInTheDocument();
  });
});
