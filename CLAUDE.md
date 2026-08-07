@AGENTS.md

# Valoda Project Guide

## Project context

- **Product**: Web app for learning Latvian (A1/A2) via the Birkenbihl method: (1) Decoding — word-for-word interlinear translation, (2) Active Listening — audio + decoded text with highlighting, (3) Passive Listening — background audio loops, (4) pointers to further activities.
- **Architecture principle**: content is data, code is a player. All lesson content lives as JSON under `content/<languageCode>/`, validated in CI. Adding a language later means adding a content folder, never rewriting features. No presentation information (colors, layout, HTML) ever appears in content files.
- **Stack**: Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel. Content validation scripts in TypeScript run with `tsx`. Zod is the single source of truth for the content schema.
- **Pipeline stages**: 1 curriculum plan → 2 LLM lesson draft → 3 mechanical validation (`scripts/validate.ts`, CI) → 4 LLM critic pass → 5 human review UI (approves glosses into `dictionary.json`) → 6 TTS audio + native-speaker check.

## Directory structure

```
content/
  lv/
    course.json          ← lesson manifest for Latvian
    dictionary.json      ← approved lemma→gloss mappings
    lessons/
      lv-a1-00.json      ← lesson files (validated in CI)
    audio/               ← mp3 files (empty until TTS stage)
  _shared/
    GLOSSING_RULES.md    ← authoritative gloss contract
scripts/
  validate.ts            ← CLI validator (npm run validate)
  validate.test.ts       ← vitest suite
src/lib/content/
  schema.ts              ← Zod schemas + inferred TS types
.github/workflows/
  validate.yml           ← CI: validate + test + lint + tsc
```

## Standing instructions

- `content/_shared/GLOSSING_RULES.md` is authoritative for all gloss decisions. Never invent a gloss convention; if a rule is missing, add it to the rules doc first.
- Never add presentation/layout information (colors, CSS classes, HTML) to content JSON files.
- All content changes must pass `npm run validate` before commit.
- New lemmas require a `dictionary.json` entry; flag them explicitly in commit messages for human review.
- Latvian language content is DRAFT until reviewed by a native speaker; never mark `audioApproved: true` automatically.

## Common commands

```bash
npm run validate    # validate all content files
npm run test        # run vitest suite
npm run lint        # ESLint
npx tsc --noEmit    # type check
npm run dev         # dev server
```
