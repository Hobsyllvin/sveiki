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

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · Zod · deployed on Vercel
