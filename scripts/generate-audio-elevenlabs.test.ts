import { describe, it, expect } from "vitest";
import {
  parseScript,
  stripTags,
  checkScriptAgainstLesson,
  buildJobs,
  selectJobs,
  buildBody,
  inputHash,
  shouldRegenerate,
  type Job,
} from "./generate-audio-elevenlabs";
import type { Lesson, Sentence, Voices } from "../src/lib/content/schema";

const voices: Voices = {
  model: "eleven_v3",
  outputFormat: "mp3_44100_128",
  speakers: { Pēteris: "voice-p", Anna: "voice-a" },
};

function sentence(id: string, speaker: string, target: string): Sentence {
  return {
    id,
    speaker,
    target,
    tokens: [{ lv: "Vārds", gloss: "word", lemma: "vārds", pos: "noun" }],
    natural: "A word.",
    audio: `lv-a1-01-${id}.mp3`,
    audioApproved: false,
  };
}

const lesson: Lesson = {
  lessonId: "lv-a1-01",
  title: "Test",
  cefr: "A1",
  newLemmas: [],
  sections: [
    {
      format: "dialogue",
      title: "Saruna",
      sentences: [
        sentence("s1", "Pēteris", "Labdien!"),
        sentence("s2", "Anna", "Sveiki!"),
        sentence("s3", "Pēteris", "Kā tev iet?"),
      ],
    },
    {
      format: "drill",
      title: "Drills",
      sentences: [sentence("s4", "Anna", "Paldies.")],
    },
  ],
};

const script = `# lv-a1-01 — audio script

Some prose about register that must be ignored.

s1 | Pēteris | [warmly] Labdien!
s2 | Anna | [cheerfully] Sveiki!
s3 | Pēteris | Kā tev iet?
s4 | Anna | Paldies.
`;

describe("parseScript", () => {
  it("reads id, speaker and tagged text, ignoring prose", () => {
    const lines = parseScript(script);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({ id: "s1", speaker: "Pēteris", text: "[warmly] Labdien!" });
  });
});

describe("stripTags", () => {
  it("removes tags and collapses the space they leave", () => {
    expect(stripTags("[warmly] Labdien!")).toBe("Labdien!");
    expect(stripTags("Es [slowly] runāju")).toBe("Es runāju");
  });
});

describe("checkScriptAgainstLesson", () => {
  const sentences = lesson.sections.flatMap((s) => s.sentences);

  it("accepts a script that matches", () => {
    expect(checkScriptAgainstLesson(parseScript(script), sentences)).toEqual([]);
  });

  it("accepts a case difference, since shouting is a delivery instruction", () => {
    const shouted = parseScript(script.replace("Labdien!", "LABDIEN!"));
    expect(checkScriptAgainstLesson(shouted, sentences)).toEqual([]);
  });

  it("rejects drifted text", () => {
    const drifted = parseScript(script.replace("Kā tev iet?", "Kā tev klājas?"));
    expect(checkScriptAgainstLesson(drifted, sentences)[0]).toMatch(/s3: text differs/);
  });

  it("rejects a wrong speaker", () => {
    const swapped = parseScript(script.replace("s2 | Anna", "s2 | Pēteris"));
    expect(checkScriptAgainstLesson(swapped, sentences)[0]).toMatch(/s2: speaker/);
  });

  it("rejects a missing line", () => {
    const short = parseScript(script.replace("s4 | Anna | Paldies.\n", ""));
    expect(checkScriptAgainstLesson(short, sentences).join(" ")).toMatch(/3 line\(s\).*4 sentence/);
  });
});

describe("buildJobs", () => {
  const jobs = buildJobs(lesson, parseScript(script), voices);

  it("resolves each sentence to its speaker's voice and the lesson's filename", () => {
    expect(jobs.map((j) => [j.sentenceId, j.voiceId, j.filename])).toEqual([
      ["s1", "voice-p", "lv-a1-01-s1.mp3"],
      ["s2", "voice-a", "lv-a1-01-s2.mp3"],
      ["s3", "voice-p", "lv-a1-01-s3.mp3"],
      ["s4", "voice-a", "lv-a1-01-s4.mp3"],
    ]);
  });

  it("sends the tagged text, not the lesson target", () => {
    expect(jobs[0].text).toBe("[warmly] Labdien!");
  });

  it("takes context from section neighbours only", () => {
    expect(jobs[0].previousText).toBeNull();
    expect(jobs[0].nextText).toBe("[cheerfully] Sveiki!");
    expect(jobs[1].previousText).toBe("[warmly] Labdien!");
    // s3 ends its section, s4 opens the next: neither sees the other.
    expect(jobs[2].nextText).toBeNull();
    expect(jobs[3].previousText).toBeNull();
    expect(jobs[3].nextText).toBeNull();
  });

  it("refuses to guess a voice for an unmapped speaker", () => {
    const unmapped: Voices = { ...voices, speakers: { Pēteris: "voice-p" } };
    expect(() => buildJobs(lesson, parseScript(script), unmapped)).toThrow(/Anna/);
  });
});

describe("selectJobs", () => {
  const jobs = buildJobs(lesson, parseScript(script), voices);

  it("filters by sentence id", () => {
    expect(selectJobs(jobs, { sentenceIds: ["s2", "s4"] }).map((j) => j.sentenceId)).toEqual([
      "s2",
      "s4",
    ]);
  });

  it("filters by speaker, so one voice can be regenerated alone", () => {
    expect(selectJobs(jobs, { speaker: "Anna" }).map((j) => j.sentenceId)).toEqual(["s2", "s4"]);
  });

  it("returns everything with no filters", () => {
    expect(selectJobs(jobs, {})).toHaveLength(4);
  });
});

describe("buildBody", () => {
  const job = buildJobs(lesson, parseScript(script), voices)[1];

  it("omits context by default, since eleven_v3 rejects it", () => {
    expect(JSON.parse(buildBody(job, voices, false))).toEqual({
      text: "[cheerfully] Sveiki!",
      model_id: "eleven_v3",
    });
  });

  it("includes context when asked", () => {
    const body = JSON.parse(buildBody(job, voices, true));
    expect(body.previous_text).toBe("[warmly] Labdien!");
    expect(body.next_text).toBe("Kā tev iet?");
  });
});

describe("inputHash", () => {
  const [first, second] = buildJobs(lesson, parseScript(script), voices);

  it("is stable for the same inputs", () => {
    expect(inputHash(first, voices)).toBe(inputHash(first, voices));
  });

  it("changes with the text, the voice and the model", () => {
    expect(inputHash({ ...first, text: "[sadly] Labdien!" }, voices)).not.toBe(
      inputHash(first, voices)
    );
    expect(inputHash({ ...first, voiceId: "other" }, voices)).not.toBe(inputHash(first, voices));
    expect(inputHash(first, { ...voices, model: "eleven_multilingual_v2" })).not.toBe(
      inputHash(first, voices)
    );
  });

  it("ignores neighbour context, so a neighbour's edit cannot invalidate an approved clip", () => {
    const recontexted: Job = { ...second, previousText: "[angrily] Labdien!" };
    expect(inputHash(recontexted, voices)).toBe(inputHash(second, voices));
  });
});

describe("shouldRegenerate", () => {
  const entry = {
    hash: "a".repeat(64),
    voice: "voice-p",
    durationSeconds: 1.5,
    generatedAt: "2026-08-23T00:00:00.000Z",
  };

  it("skips an unchanged clip that is on disk", () => {
    expect(shouldRegenerate(entry, entry.hash, true, false)).toBe(false);
  });

  it("regenerates when the inputs changed, the file is gone, or forced", () => {
    expect(shouldRegenerate(entry, "b".repeat(64), true, false)).toBe(true);
    expect(shouldRegenerate(entry, entry.hash, false, false)).toBe(true);
    expect(shouldRegenerate(entry, entry.hash, true, true)).toBe(true);
    expect(shouldRegenerate(undefined, entry.hash, false, false)).toBe(true);
  });
});
