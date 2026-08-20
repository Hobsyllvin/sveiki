# Handoff brief — lean pass + audio (drafted 2026-08-18)

Disposable working document. Delete once the work is merged.

You are picking up a decided plan. The decisions below were made deliberately by Christian after an
audit of the three critic reports in `content/lv/reports/`. **Do not relitigate them** — in
particular, do not "improve" the glossing choices in Phase 2 back toward what the critic reports
recommend, because two of them were overruled on purpose and the reason is recorded here.

Read first: `CLAUDE.md`, `content/_shared/GLOSSING_RULES.md`, `content/lv/dictionary.json`.

## Why this pass exists

The three critic reports contain ~5 errors and ~44 warnings. They were triaged into five classes:

| Class | Count | Doing it now? |
| --- | --- | --- |
| Decode line teaches something false | ~5 | **Yes — Phase 2** |
| Rules-doc gap that changes decode output | 3 | **Yes — Phase 2** |
| Rules-doc gap that only changes `note` fields | ~7 | No — deferred |
| `note` granularity inconsistency | ~15 | No — deferred |
| `natural` drifts from decode (English side only) | ~8 | No — deferred |
| `newLemmas` desync | 1 root cause, 3 reports | **Yes — Phase 3** |

The deferred classes are documentation debt, not defects. They are deferred because a paid native
Latvian teacher will review the Latvian shortly and some of that work would be overturned.

## Phase 1 — remove the `needsNativeReview` apparatus

Native review is now handled by a hired Latvian teacher who will review the sentences and the site
directly, so per-entry review flags are dead weight.

1. `src/lib/content/schema.ts` line 73 — delete `needsNativeReview: z.boolean().optional(),` from
   `DictionaryEntrySchema`.
2. `content/lv/dictionary.json` — remove the key from all 132 entries that carry it. Script the
   edit; then `grep -c needsNativeReview content/lv/dictionary.json` must return 0.
   **Note:** Zod `z.object` strips unknown keys rather than rejecting them, so leftovers would pass
   validation silently. The grep is the real check, not `npm run validate`.
3. `CLAUDE.md` — in *Standing instructions*, delete the clause about Latvian content being DRAFT
   until reviewed by a native speaker. Keep the `audioApproved` half of that line and keep
   "New lemmas require a `dictionary.json` entry; flag them explicitly in commit messages".
4. Leave `content/lv/reports/*.md` untouched. They are dated audit artifacts and their references to
   `needsNativeReview` were true when written.
5. `audioApproved` stays in the schema for now. Do not remove it in this pass.

## Phase 2 — three `GLOSSING_RULES.md` amendments and the five real defects

Amend the rules doc **before** editing tokens, per the standing instruction.

### 2a — R4: dative of purpose takes `for-`

Currently R4 grants `to-` only to dative experiencers, so `priekam` degrades to bare `joy` and
`lv-a1-03` s27 decodes as *"no, I run only joy!"* — the meaning survives only in the note.

- R4: add a clause — a dative of purpose is glossed `for-X`, parallel to the experiencer `to-X`.
- `dictionary.json` -> `prieks`: add `for-joy` to `glosses` (result: `["joy", "for-joy"]`).
- `lv-a1-03` s27 token 4 `priekam`: `gloss` `joy` -> `for-joy`; keep `note: "dat. of purpose"`
  (drop the `= for fun` tail, now redundant).
- Resulting decode: `no, I run only for-joy! and you?`

### 2b — R4: `-iski` language adverbs lose the `in-` prefix

**This overrules the critic reports.** All three suggested adding `note: "adv.; manner, not loc."`
to keep the `in-` prefix. Christian's decision is the opposite and simpler: drop the prefix. The
`in-` prefix is reserved for locative absorption; `latviski` just means "Latvian", and forcing the
gloss to mirror English "in Latvian" makes the decode line lie about the morphology. A learner does
not need the English preposition to understand the sentence.

- R4: add a clause — the `in-` prefix marks locative absorption **only**. Manner adverbs in `-iski`
  are glossed with the bare language name.
- `dictionary.json`: `latviski` -> `["Latvian"]`, `angliski` -> `["English"]`,
  `igauniski` -> `["Estonian"]`, `lietuviski` -> `["Lithuanian"]`, `poliski` -> `["Polish"]`.
- Retokenise these 8 tokens; add **no** `note` to any of them:

| Lesson | Sentence | Token |
| --- | --- | --- |
| lv-a1-01 | s13 | `latviski` |
| lv-a1-01 | s14 | `latviski` |
| lv-a1-02 | s13 | `igauniski`, `angliski`, `latviski` |
| lv-a1-02 | s14 | `lietuviski`, `poliski`, `latviski` |

- **Do not touch `lieliski`.** It ends in `-iski` but is an unrelated adverb glossed `wonderful`
  (lv-a1-03 s14, s38). This rule covers language adverbs only.
- Resulting decode, lv-a1-02 s13: `I speak Estonian, English and a-little Latvian.`
- Consequence to surface, not to fix now: when `latviešu valoda` eventually appears, two different
  Latvian words will both gloss to `Latvian`. Same shape as the existing `darbs`/`strādāt` -> `work`
  collision flagged in the lv-a1-02 report. Note it in the commit message.

### 2c — R4: locative absorption attaches to the leftmost element of the NP

`brīvajā laikā` currently decodes as `free in-time`: the absorbed preposition lands inside the head
noun, so the modifier dangles outside the phrase it modifies.

- R4: add a clause — where a locative NP contains a modifier, the `in-` prefix attaches to the
  **leftmost element** of the NP; the head noun is glossed bare with `note: "loc."`.
- `dictionary.json` -> `brīvs`: add `in-free` (result: `["free", "in-free"]`). Update its note, which
  currently says `brīvajā laikā = in free time, def. adj. loc.`, to match the new convention.
- `laiks` keeps both `["time", "in-time"]` — an *unmodified* locative `laikā` is still `in-time`.
- Four tokens, in two copies of the same sentence `Ko tu dari brīvajā laikā?`:

| Lesson | Sentence | Token | Change |
| --- | --- | --- | --- |
| lv-a1-02 | s29 | `brīvajā` | gloss `free` -> `in-free`; note -> `"def. adj.; masc. loc."` |
| lv-a1-02 | s29 | `laikā` | gloss `in-time` -> `time`; note stays `"loc."` |
| lv-a1-03 | s23 | `brīvajā` | gloss `free` -> `in-free`; note -> `"def. adj.; masc. loc."` |
| lv-a1-03 | s23 | `laikā` | gloss `in-time` -> `time`; note stays `"loc."` |

- Resulting decode: `what you do in-free time?`

### 2d — the remaining defects

**`Cik` sense selection (lv-a1-01 s11, token 0).** `Cik ilgi tu dzīvo Rīgā?` glosses `Cik` as
`how-much`, giving `how-much long you live in-Riga`. The `cik` dictionary note already prescribes
the rule (`cik ilgi = how long; cik + adj./adv. = how`), and lv-a1-03 applies it correctly three
times (s10, s26, s33, each with a note). lv-a1-01 s11 is the lone outlier.

- Change `gloss` to `how`, add `note: "cik ilgi = how long"`.

**`paldies` glossed two ways course-wide (R13 violation).** `thanks` in lv-a1-01 (s6, s7, s15) and
lv-a1-02 (s16); `thank-you` in lv-a1-03 (s21, s22). One lemma, one sense, two glosses.

- `dictionary.json` -> `paldies`: collapse `glosses` to `["thanks"]`.
- Re-decode lv-a1-03 s21 token 4 and s22 token 0 to `thanks`.

**`ar` note is factually wrong.** The `ar` dictionary note says `+ acc.`, but `ar` governs the
accusative in the singular and the **dative in the plural**. This is the only place in the corpus
where the data teaches incorrect grammar, and it is live: lv-a1-03 s20/s21 pair `ar` with the
genitive plural `auzu`.

- `dictionary.json` -> `ar` note: `"+ acc. sg.; dat. in pl."`
- Same correction on the token notes: lv-a1-03 s20 token 2 (`ar`) and s21 token 0 (`Ar`).
- **Verify against a grammar reference before committing.** This is a factual claim about Latvian,
  not a convention choice. If you cannot confirm it, leave the note unchanged and flag it for the
  teacher's review list instead of guessing.

### Explicitly out of scope for Phase 2

Do not touch, even though the critic reports ask for them: `note` granularity (nominative `es` vs
`tu`, gender on adjectives, number on genitives, `ir` note variants), `natural`-line drift (`Prieks`
-> "Likewise!", `braukt` -> "going", `Kādu` -> "Which", `Labdien` -> "Hello!", the dropped `ļoti`),
the `pos` questions (`nulle` as `num`, `sveiks` as `interj`), diminutives, reciprocal reflexives,
plural-only and locative-only gloss lists, and the nominative-marking policy. These are deferred
until after the teacher's review.

## Phase 3 — three validator rules

In `scripts/validate.ts`, with tests in `scripts/validate.test.ts`. Each rule exists because a real
defect passed the current gate.

**Rule 1 — `newLemmas` coherence.** Every token `lemma` must be declared in its own lesson's
`newLemmas` or in an earlier lesson's; each lesson's `newLemmas` must equal `course.json`'s list for
that lesson; no lemma may be declared new twice in the course. This will fail immediately on
existing data, which is the point — fix the data too: remove from `lv-a1-01`'s `newLemmas` the 7
lemmas already taught in lv-a1-00 (`iet`, `no`, `es`, `Rīga`, `tu`, `dzīvot`, `uz`), and add to
`lv-a1-02`'s the 8 it omits (`jā`, `valoda`, `angliski`, `patikt`, `lasīt`, `mūzika`, `sports`,
`ceļot`). lv-a1-03 is already clean.

**Rule 2 — course-wide gloss uniqueness.** Error if a lemma is used with more than one distinct
gloss across all lessons, unless its `dictionary.json` note documents the senses as genuinely
distinct. Catches `paldies`. Must not fire on `cik`, whose two glosses are real distinct senses
recorded in its note — so the exemption mechanism has to work before you enable the rule. Note that
`prieks` gains a second gloss in Phase 2a (`joy` / `for-joy`); make sure its treatment is deliberate.

**Rule 3 — sense-selection disclosure.** The `Cik` error passed validation because both candidate
glosses were dictionary-approved. Do not attempt to parse the sense rules in prose notes. Implement
the mechanical version: if a lemma has more than one approved gloss **and** its dictionary note
contains a sense rule (heuristic: the note contains `=`), then every token using that lemma must
carry a `note`. That forces the decoder to state which sense it picked, and would have caught
lv-a1-01 s11, which had no note at all.

While you are in the file, implement the stubbed recycling report at `scripts/validate.ts:129` as
warning-only: 86 of the course's 187 lemmas currently appear exactly once across all four lessons.
Report them; change no content. Editing Latvian source text is out of scope for any agent — see
"Fixed inputs" in the project rules.

## Phase 4 — TTS pipeline

Separate commit, separate session if convenient. Christian has tested Latvian TTS before and is
satisfied with the quality, so no A/B probe is required — but keep the pipeline cheap to re-run,
because the Latvian is still unreviewed and every sentence may need regenerating after the teacher
comes back.

- `scripts/tts.ts`, run with `tsx`. Provider behind a small adapter interface with ElevenLabs and
  Google Cloud implementations, selected by env var; API keys from env only, never committed.
- **Output filenames come from the `audio` field already present on every sentence** — do not invent
  a naming scheme. All 102 sentences across the four lessons already carry unique values
  (`lv-a1-03-s27.mp3` and so on). Write to `content/lv/audio/`.
- Skip files that already exist unless `--force`. Support `--lesson lv-a1-03` to regenerate one
  lesson.
- Add a concatenation step: one mp3 per lesson, sentences in order with a configurable pause between
  them (ffmpeg), so passive listening works on a phone with no app running. Written to
  `content/lv/audio/` alongside the per-sentence files.
- `.gitignore`: decide whether generated audio is committed. Recommendation — ignore the mp3s while
  the Latvian is unreviewed and regeneration is one command; revisit when the teacher's recordings
  replace them.
- Do not set `audioApproved: true` anywhere. TTS output is not approved audio.

## Phase 5 — player wiring

The app currently has no audio at all; `audio` and `audioApproved` exist in the schema and are
otherwise unused. Add, in `src/components/`:

- A per-sentence play control in `InterlinearSentence`.
- A sequential play-all for active listening: audio advancing sentence by sentence with the decode
  line visible, current sentence marked.
- Access to the per-lesson concatenated file for passive listening.

Constraints: no presentation data enters content JSON — the components own all layout and styling.
Do not install browser tooling or attempt automated visual checks; Christian does those by eye.

## Gate

`npm run validate`, `npm run test`, `npm run lint`, `npx tsc --noEmit` must all pass before commit.
Commit in phase order, and per the standing instruction call out new or changed lemmas explicitly in
commit messages. Two things to surface in the Phase 2 message: the future `latviski`/`latviešu`
gloss collision, and whether the `ar` dative-plural claim was verified or left for the teacher.
