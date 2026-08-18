# GLOSSING_RULES.md — Birkenbihl Decoding Conventions (Latvian → English)

Version 0.1 — the contract shared by content generation, validation, review, and rendering.
Every gloss in `dictionary.json` and every token in `lessons/*.json` must follow these rules.

## Core principle

The decode line is a **word-for-word literal rendering, in Latvian word order**, readable
top-to-bottom as a strange-but-understandable English sentence. Grammar is made visible
through structure and literal glosses — not through linguistic annotation. Case, tense,
and morphology details live in the `note` field, never in the gloss itself.

A gloss answers: *"What is this exact word doing in this exact sentence?"*

## R1 — One token, one gloss

- Each Latvian token gets exactly one gloss.
- Multi-word English renderings are joined with hyphens: `pirkt` → `to-buy`, `jāiet` → `is-to-go`.
- Hyphens never join glosses *across* tokens. Concatenating all `lv` tokens (plus punctuation)
  must reconstruct the target sentence exactly.

## R2 — Verbs are person-free

Latvian verb endings carry person; we do **not** echo it in the gloss.

- `gribu` → `want` (not `want-I`, not `I-want`)
- `dzīvo` → `live`
- Person is recoverable from the subject pronoun or from `note` (`"1sg pres."`).
- Infinitives always get `to-`: `pirkt` → `to-buy`, `iet` → `to-go`.

## R3 — No articles

Latvian has no articles, so the decode line has none either.

- `maizi` → `bread` (not `the-bread`)
- Exception: none. If English feels broken without an article, good — that friction is the method.

## R4 — Case: absorbed only when it replaces a preposition

- **Locative** absorbs into the gloss with `in-`/`at-`: `Rīgā` → `in-Riga`, `tirgū` → `in-market`.
  (The locative *is* the preposition; hiding it would lose meaning.)
- **Locative noun phrases containing a modifier**: the `in-` attaches to the **leftmost element**
  of the phrase; the head noun is glossed bare with `note: "loc."`.
  `brīvajā laikā` → `in-free` + `time`, not `free` + `in-time`.
  Absorbing onto the head noun would strand the modifier outside the phrase it modifies.
  An *unmodified* locative is unaffected: `laikā` on its own is still `in-time`.
- **The `in-` prefix marks locative absorption only.** Manner adverbs in `-iski` are glossed with
  the bare language name and take no note: `latviski` → `Latvian`, `angliski` → `English`.
  They carry no case ending, so mirroring English "in Latvian" would make the decode line
  misreport the morphology. (Applies to language adverbs; `lieliski` "wonderful" is unrelated.)
- **All other cases** (accusative, dative, genitive, instrumental) are NOT marked in the gloss.
  The bare meaning is glossed; the case goes in `note`: `maizi` → `bread`, note `"acc."`.
- **Dative experiencers** are glossed with `to-`: `man` → `to-me`, `tev` → `to-you`, `viņai` → `to-her`.
  This is meaning-critical (see R6) and reads naturally in decode.
- **Dative of purpose** is glossed with `for-`, parallel to the experiencer `to-`:
  `priekam` → `for-joy`, note `"dat. of purpose"`. Without it the dative collapses to a bare
  noun and the purpose reading survives only in the note.

## R5 — Reflexive verbs: invariant `-oneself`

- `mazgāties` family → `wash-oneself` / inflected `mazgājas` → `washes-oneself`
- Invariant `-oneself` regardless of subject person, consistent with R2 (person-free verbs).
  `note` may add `"refl. 3sg"`.
- Where the reflexive is lexicalized and no longer literally reflexive (`smieties` "to laugh"),
  gloss the meaning and record the decision in `dictionary.json`: `smejas` → `laughs`,
  note `"refl. form, non-reflexive meaning"`.

## R6 — Debitive: fully literal

The `jā-` construction is decoded exactly as built:

- `Man jāiet.` → `to-me is-to-go` (natural: "I have to go")
- `jā-` + verb → `is-to-X`: `jāstrādā` → `is-to-work`, `jāpērk` → `is-to-buy`
- The dative experiencer keeps its `to-` gloss (R4). The weirdness is the pedagogy.

## R7 — Negation is visible

- `ne-` prefix → `not-` prefix: `negribu` → `not-want`, `nezinu` → `not-know`
- `nav` → `is-not`; `nē` → `no`

## R8 — Prepositions: literal core meaning, consistently

Gloss the literal spatial/basic meaning even when English would idiomatically differ:

- `no rīta` → `from morning` (natural: "in the morning")
- `uz darbu` → `to work` (uz + acc = direction); `uz galda` → `on table` (uz + gen = location)
- Each preposition's allowed glosses are enumerated in `dictionary.json`
  (e.g. `uz: ["to", "on"]`); the validator rejects anything outside the list.

## R9 — Idioms and fixed phrases: decode literally anyway

- `Kā tev iet?` → `how to-you goes` (natural: "How are you?")
- The `natural` field carries the idiomatic meaning; the decode line never smooths it over.
  Seeing the literal machinery is the point of the method.

## R10 — Questions

- Question words glossed directly: `kur` → `where`, `kas` → `what/who` (sense chosen per sentence),
  `kad` → `when`, `kāpēc` → `why`
- `vai` (yes/no question particle) → `whether`: `Vai tu nāc?` → `whether you come`

## R11 — Proper nouns and numbers

- Proper nouns pass through unchanged, minus Latvian inflection: `Rīgā` → `in-Riga`, `Anna` → `Anna`.
- Numbers are glossed as words: `divi` → `two`.

## R12 — The `note` field

Short, telegraphic, for the curious learner and the reviewer — not required reading:

- Case: `"acc."`, `"gen. after no"`, `"loc."`, `"voc."`
- Verb form: `"1sg pres."`, `"inf."`, `"debitive of iet"`, `"refl. 3sg"`
- Gender on role nouns (R15): `"masc."`, `"fem."`
- Adjective and pronoun form: `"def. adj."`, `"demonstr."`

## R13 — Dictionary consistency

- `dictionary.json` maps lemma → list of approved glosses (most lemmas have exactly one).
- A lemma is always glossed identically across the whole course unless the dictionary
  explicitly lists multiple senses (`uz`, `kas`). New lemma = new dictionary entry =
  human review before merge.

## R14 — Vocative case

Latvian address forms drop or alter the noun ending. Gloss the **base form** and mark the
case in `note` as `"voc."`.

- `Pēteri!` → `Pēteris` (lemma `Pēteris`, note `"voc."`)
- `skolotāj!` → `teacher` (lemma `skolotājs`, note `"voc."`)
- `Anna!` → `Anna` (lemma `Anna`, note `"voc."`) — form unchanged, still marked

Rationale: the vocative carries no meaning English can render. Marking it in the gloss
would add noise; the `note` keeps it visible to the curious learner without cluttering
the decode line.

Edge cases:

- An unchanged form (`Anna`, `Marta`) still gets `"voc."` when it is an address, so the
  reviewer can see the decoder recognised the construction rather than missed it.
- A name in subject position is **not** vocative and takes no note: `Anna smaida.` → `Anna smiles`.
- Vocative and greeting are separate tokens: `Sveika, Marta!` → `hello` + `Marta`,
  only the second carrying `"voc."`.

## R15 — Gendered profession and role nouns

Latvian marks gender on many role nouns. Gloss both genders with the **same neutral
English word** and put the gender in `note`.

- `skolotājs` → `teacher` (note `"masc."`) / `skolotāja` → `teacher` (note `"fem."`)
- `students` → `student` (note `"masc."`) / `studente` → `student` (note `"fem."`)
- `draugs` → `friend` (note `"masc."`) / `draudzene` → `friend` (note `"fem."`)

The dictionary treats the two genders as **separate lemmas** with identical glosses,
cross-referenced with `seeAlso`:

```json
"skolotājs": { "glosses": ["teacher"], "note": "masc.", "seeAlso": ["skolotāja"] },
"skolotāja": { "glosses": ["teacher"], "note": "fem.", "seeAlso": ["skolotājs"] }
```

Rationale: English has no gendered equivalent, and duplicating gender in the gloss
(`teacher-fem`) would break R2's person-free principle and make the same role read as
two different words.

Edge cases:

- Do **not** collapse the pair into one lemma. `skolotāja` is not an inflected form of
  `skolotājs`; they are distinct words and each needs its own dictionary entry.
- Beware the syncretism: `skolotāja` is both the feminine nominative *and* the masculine
  genitive singular of `skolotājs`. Choose the lemma from the sentence's syntax, not the
  surface form alone.
- Where a role noun has no gender pair in use (`ārsts` covering both), a single lemma
  with no gender note is correct until the counterpart actually appears.

## Punctuation

Punctuation is a data convention, not a numbered gloss rule — it never appears in `gloss`.

- Punctuation lives in the token's optional `punct` field, attached to the **preceding**
  word — the token it immediately follows in the source sentence with no space.
  `dzīvo` + `punct: "?"` → renders `dzīvo?`. Combined punctuation (`?!`) is one `punct` value.
- `lv` stays punctuation-free — it is the pure word form, so lemma lookup and dictionary
  checks are unaffected by punctuation placement.
- Tokenization is checked by exact reconstruction: `lv + (punct ?? "")` for every token,
  joined with single spaces and whitespace-normalized, must equal `target` exactly.
- **Em dash convention**: a free-standing em dash used as a mid-sentence break (spaces on
  both sides, e.g. `Es tev saku — tās ir fantastiskas`) is *not* attached punctuation in
  the usual sense — there is no word it glues to without a space. It is represented as
  `punct` on the **preceding** token with a **leading space**: `saku` → `punct: " —"`.
  The join's separator space supplies the space before the next token, so `"saku"` +
  `" —"` + `" "` + `"tās"` reconstructs `saku — tās` exactly.

## Worked micro-examples

| Latvian | Decode | Rules exercised |
|---|---|---|
| Es gribu pirkt maizi. | I want to-buy bread | R2, R3, R4 |
| Man jāiet uz darbu. | to-me is-to-go to work | R4, R6, R8 |
| Viņa mazgājas no rīta. | she washes-oneself from morning | R5, R8 |
| Es dzīvoju Rīgā. | I live in-Riga | R2, R4, R11 |
| Kā tev iet? | how to-you goes | R4, R9 |
| Sveiks, Pēteri! | hello Pēteris | R14 |
| Es esmu studente. | I am student | R2, R3, R15 |
