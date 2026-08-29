# valoda

Latvian language learning platform built on the **Birkenbihl method** — a four-step approach that prioritizes understanding over memorisation: (1) **Decoding** — every word translated literally in source word order, creating a strange-but-readable interlinear text; (2) **Active Listening** — audio plays alongside the decoded text with word-level highlighting; (3) **Passive Listening** — the same audio loops in the background while you do other things; (4) further activities like shadowing and free production.

## Content as data

The guiding architecture principle is _content is data, code is a player_. All lesson material lives as validated JSON under `content/<languageCode>/` — no HTML, no layout, no colour decisions inside the content layer. Adding a new target language means adding a content folder; it never means rewriting application logic. The Zod schemas in `src/lib/content/schema.ts` are the single source of truth for what valid lesson data looks like, and CI enforces them on every push.

## Running validation

```bash
npm install
npm run validate   # checks schema, tokenization, and dictionary coverage for every lesson
npm run test       # vitest unit tests for the validator
npm run lint       # ESLint
npx tsc --noEmit   # TypeScript type check
```

The validator reports a coloured PASS/FAIL per lesson and exits with code 1 on any failure, making it safe to use as a CI gate.

## Dialogue audio

Each lesson is synthesized in one Text-to-Dialogue request so ElevenLabs sees
the complete conversation and can keep voices, pacing, and prosody coherent.
Generated source files live together under
`content/<lang>/audio-elevenlabs/<lessonId>/`; `npm run sync-audio` copies only
the lesson MP3 to the public directory used by the app.

```bash
npm run audio -- --lesson lv-a1-03    # regenerate the complete lesson take
npm run timings -- --lesson lv-a1-03  # review/correct sentence boundaries
npm run sync-audio                    # copy lesson MP3s into public/audio
```

The generator refuses scripts above ElevenLabs' recommended 2,000-character
limit for a single reliable dialogue request. Timing corrections remain visible
after regeneration, but must be reviewed because they refer to the previous take.

## Decoding view

The heart of the app is the lesson page at `/lessons/<lessonId>`. Each sentence is displayed interlinear-style: the Latvian word sits above its word-for-word gloss, pairs flowing left-to-right and wrapping as units on narrow screens so a gloss is never orphaned from its word.

Three reading modes — **Decode** (full interlinear), **Natural** (Latvian + idiomatic translation), **Latvian only** (target text alone for self-testing) — switch from a pill toggle at the top of the page. All three draw from the same loaded lesson data; no refetch on mode change. Tokens with grammatical notes reveal them on tap (mobile) or hover/focus (desktop) via an accessible disclosure. Natural translations are collapsed by default in Decode mode.

_[Screenshot placeholder — to be added after native-speaker review]_

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · Zod · deployed on Vercel
