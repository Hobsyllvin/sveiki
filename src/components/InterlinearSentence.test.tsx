import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import InterlinearSentence, { type ViewMode } from "./InterlinearSentence";
import type { Sentence } from "@/lib/content/schema";

// Test harness standing in for LessonView's lifted note-disclosure state.
function TestSentence({
  sentence,
  mode,
  showSpeaker,
}: {
  sentence: Sentence;
  mode: ViewMode;
  showSpeaker?: boolean;
}) {
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  return (
    <InterlinearSentence
      sentence={sentence}
      mode={mode}
      showSpeaker={showSpeaker}
      openNoteId={openNoteId}
      onToggleNote={(id) => setOpenNoteId((prev) => (prev === id ? null : id))}
      onOpenNote={(id) => setOpenNoteId(id)}
      onCloseNote={(id) => setOpenNoteId((prev) => (prev === id ? null : prev))}
    />
  );
}

// Harness sharing one openNoteId across two sentences, like LessonView does across the whole page.
function TwoSentenceHarness({ a, b }: { a: Sentence; b: Sentence }) {
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const onToggleNote = (id: string) =>
    setOpenNoteId((prev) => (prev === id ? null : id));
  return (
    <>
      <InterlinearSentence sentence={a} mode="decode" openNoteId={openNoteId} onToggleNote={onToggleNote} />
      <InterlinearSentence sentence={b} mode="decode" openNoteId={openNoteId} onToggleNote={onToggleNote} />
    </>
  );
}

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
    render(<TestSentence sentence={sentence} mode="decode" />);
    const words = ["Es", "gribu", "pirkt", "maizi"];
    for (const word of words) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
  });

  it("renders all glosses in order", () => {
    render(<TestSentence sentence={sentence} mode="decode" />);
    const glosses = ["I", "want", "to-buy", "bread"];
    for (const gloss of glosses) {
      expect(screen.getByText(gloss)).toBeInTheDocument();
    }
  });

  it("does not render the natural translation or a per-sentence disclosure", () => {
    render(<TestSentence sentence={sentence} mode="decode" />);
    expect(screen.queryByText("I want to buy bread.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /natural translation/i })).not.toBeInTheDocument();
  });

  it("token with note exposes note via disclosure on click", () => {
    render(<TestSentence sentence={sentence} mode="decode" />);
    const gribu = screen.getByText("gribu");
    expect(screen.queryByText("1sg pres.")).not.toBeInTheDocument();
    fireEvent.click(gribu);
    expect(screen.getByText("1sg pres.")).toBeInTheDocument();
  });

  it("clicking an open note again closes it", () => {
    render(<TestSentence sentence={sentence} mode="decode" />);
    const gribu = screen.getByText("gribu");
    fireEvent.click(gribu);
    expect(screen.getByText("1sg pres.")).toBeInTheDocument();
    fireEvent.click(gribu);
    expect(screen.queryByText("1sg pres.")).not.toBeInTheDocument();
  });

  it("opens a note on hover and closes it when the pointer leaves", () => {
    render(<TestSentence sentence={sentence} mode="decode" />);
    const gribu = screen.getByText("gribu");
    fireEvent.pointerEnter(gribu, { pointerType: "mouse" });
    expect(screen.getByText("1sg pres.")).toBeInTheDocument();
    fireEvent.pointerLeave(gribu, { pointerType: "mouse" });
    expect(screen.queryByText("1sg pres.")).not.toBeInTheDocument();
  });

  it("token without note shows no dotted underline affordance", () => {
    render(<TestSentence sentence={sentenceNoNotes} mode="decode" />);
    const kur = screen.getByText("Kur");
    expect(kur).not.toHaveClass("has-note");
  });
});

describe("InterlinearSentence — latvian-only mode", () => {
  it("renders no glosses", () => {
    render(<TestSentence sentence={sentence} mode="latvian" />);
    expect(screen.queryByText("I")).not.toBeInTheDocument();
    expect(screen.queryByText("want")).not.toBeInTheDocument();
    expect(screen.queryByText("to-buy")).not.toBeInTheDocument();
    expect(screen.queryByText("bread")).not.toBeInTheDocument();
  });

  it("renders the target sentence", () => {
    render(<TestSentence sentence={sentence} mode="latvian" />);
    expect(screen.getByText("Es gribu pirkt maizi.")).toBeInTheDocument();
  });
});

describe("InterlinearSentence — natural mode", () => {
  it("renders Latvian sentence and natural translation", () => {
    render(<TestSentence sentence={sentence} mode="natural" />);
    expect(screen.getByText("Es gribu pirkt maizi.")).toBeInTheDocument();
    expect(screen.getByText("I want to buy bread.")).toBeInTheDocument();
  });

  it("renders no token-level glosses", () => {
    render(<TestSentence sentence={sentence} mode="natural" />);
    expect(screen.queryByText("to-buy")).not.toBeInTheDocument();
  });
});

describe("InterlinearSentence — speaker label gating", () => {
  it("drill section: does not render speaker label even when speaker field is present", () => {
    render(<TestSentence sentence={sentenceNoNotes} mode="decode" showSpeaker={false} />);
    expect(screen.queryByText("A")).not.toBeInTheDocument();
  });

  it("dialogue section: renders speaker label when showSpeaker is true", () => {
    render(<TestSentence sentence={sentenceNoNotes} mode="decode" showSpeaker={true} />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});

describe("InterlinearSentence — punctuation rendering", () => {
  const sentenceWithPunct: Sentence = {
    id: "s1",
    target: "Kur tu dzīvo?",
    tokens: [
      { lv: "Kur", gloss: "where", lemma: "kur", pos: "adv" },
      { lv: "tu", gloss: "you", lemma: "tu", pos: "pron" },
      { lv: "dzīvo", gloss: "live", lemma: "dzīvot", pos: "verb", punct: "?" },
    ],
    natural: "Where do you live?",
    audio: "lv-a1-00-s1.mp3",
    audioApproved: false,
  };

  const sentenceWithDash: Sentence = {
    id: "s2",
    target: "Es tev saku — tās ir fantastiskas.",
    tokens: [
      { lv: "Es", gloss: "I", lemma: "es", pos: "pron" },
      { lv: "tev", gloss: "to-you", lemma: "tu", pos: "pron", note: "dat." },
      { lv: "saku", gloss: "say", lemma: "teikt", pos: "verb", punct: " —" },
      { lv: "tās", gloss: "those", lemma: "tas", pos: "pron" },
      { lv: "ir", gloss: "are", lemma: "būt", pos: "verb" },
      { lv: "fantastiskas", gloss: "fantastic", lemma: "fantastisks", pos: "adj", punct: "." },
    ],
    natural: "I'm telling you — they're fantastic.",
    audio: "lv-a1-03-s43.mp3",
    audioApproved: false,
  };

  it("renders punct immediately after its token with no gap, on the top line only", () => {
    render(<TestSentence sentence={sentenceWithPunct} mode="decode" />);
    const word = screen.getByText("dzīvo");
    const lvLine = word.closest(".lv-line");
    expect(lvLine).not.toBeNull();
    expect(lvLine!.textContent).toBe("dzīvo?");
    // Gloss line is unaffected — no punctuation there.
    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it("renders a free-standing em dash with its leading space", () => {
    render(<TestSentence sentence={sentenceWithDash} mode="decode" />);
    const word = screen.getByText("saku");
    const lvLine = word.closest(".lv-line");
    expect(lvLine!.textContent).toBe("saku —");
  });

  it("natural mode renders the target sentence with punctuation intact", () => {
    render(<TestSentence sentence={sentenceWithPunct} mode="natural" />);
    expect(screen.getByText("Kur tu dzīvo?")).toBeInTheDocument();
  });

  it("latvian-only mode renders the target sentence with punctuation intact", () => {
    render(<TestSentence sentence={sentenceWithPunct} mode="latvian" />);
    expect(screen.getByText("Kur tu dzīvo?")).toBeInTheDocument();
  });
});

describe("InterlinearSentence — sentence grid", () => {
  const sentenceWithLongGloss: Sentence = {
    id: "s-long",
    speaker: "TEST",
    target: "Es mazgājos.",
    tokens: [
      { lv: "Es", gloss: "I", lemma: "es", pos: "pron" },
      { lv: "mazgājos", gloss: "washes-oneself", lemma: "mazgāties", pos: "verb", punct: "." },
    ],
    natural: "I wash myself.",
    audio: "lv-a1-00-s-long.mp3",
    audioApproved: false,
  };

  it("keeps each Latvian word and gloss in one pair inside the sentence content column", () => {
    const { container } = render(
      <TestSentence sentence={sentenceWithLongGloss} mode="decode" showSpeaker />
    );
    const block = container.querySelector(".sentence-block");
    expect(block).not.toBeNull();
    expect(block!.querySelector(".sentence-gutter .speaker-label")).toHaveTextContent("TEST");
    const pair = screen.getByText("washes-oneself").closest(".token-pair");
    expect(pair).not.toBeNull();
    expect(pair!.querySelector(".lv-line")?.textContent).toBe("mazgājos.");
  });
});

describe("InterlinearSentence — page-wide note disclosure", () => {
  const sentenceB: Sentence = {
    id: "sB",
    target: "Tu labi runā.",
    tokens: [
      { lv: "Tu", gloss: "you", lemma: "tu", pos: "pron" },
      { lv: "labi", gloss: "well", lemma: "labi", pos: "adv" },
      { lv: "runā", gloss: "speak", lemma: "runāt", pos: "verb", note: "2sg pres." },
    ],
    natural: "You speak well.",
    audio: "lv-a1-00-sB.mp3",
    audioApproved: false,
  };

  it("opening a note in sentence B closes an open note in sentence A", () => {
    render(<TwoSentenceHarness a={sentence} b={sentenceB} />);

    fireEvent.click(screen.getByText("gribu"));
    expect(screen.getByText("1sg pres.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("runā"));
    expect(screen.queryByText("1sg pres.")).not.toBeInTheDocument();
    expect(screen.getByText("2sg pres.")).toBeInTheDocument();
  });
});
