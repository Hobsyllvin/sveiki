/**
 * One-off backfill: derive each token's `punct` field by mechanically aligning
 * the sentence's existing tokens against its `target` string.
 *
 * This is pure string alignment — it never touches lv, gloss, lemma, pos, note,
 * target, or natural. If a sentence can't be aligned unambiguously, the script
 * stops and reports it rather than guessing.
 *
 * Convention (see GLOSSING_RULES.md):
 *   - Punctuation that directly follows a word with no space (. ? ! , or a
 *     combination like ?!) attaches to that token's `punct`, no leading space.
 *   - A free-standing em dash (space on both sides) attaches to the preceding
 *     token's `punct` with a leading space (e.g. "saku" -> punct " —"), since
 *     the separator space before the next token is supplied by the join.
 *
 * Usage: npx tsx scripts/backfill-punctuation.ts
 */
import fs from "fs";
import path from "path";

const LESSONS_DIR = path.join(process.cwd(), "content", "lv", "lessons");

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

type RawToken = Record<string, unknown> & { lv: string };
type RawSentence = Record<string, unknown> & { id: string; target: string; tokens: RawToken[] };
type RawSection = Record<string, unknown> & { sentences: RawSentence[] };
type RawLesson = Record<string, unknown> & { lessonId: string; sections: RawSection[] };

// A trailing-punctuation gap: punctuation glued directly to the previous word.
const TRAILING_PUNCT = /^([.,!?]{1,2})$/;
// A free-standing em dash: one space, the dash, one space.
const FREESTANDING_DASH = /^ (—) $/;

/**
 * Parses the gap between the end of one token and the start of the next
 * (or end of string, for the last token) into a punct value (or undefined).
 * Returns { ok: false } if the gap doesn't match a known pattern.
 */
function parseGap(gap: string, isFinal: boolean): { ok: true; punct?: string } | { ok: false } {
  if (isFinal) {
    if (gap === "") return { ok: true };
    const m = gap.match(TRAILING_PUNCT);
    if (m) return { ok: true, punct: m[1] };
    return { ok: false };
  }

  if (gap === " ") return { ok: true };

  const dashMatch = gap.match(FREESTANDING_DASH);
  if (dashMatch) return { ok: true, punct: ` ${dashMatch[1]}` };

  const trailingMatch = gap.match(/^([.,!?]{1,2}) $/);
  if (trailingMatch) return { ok: true, punct: trailingMatch[1] };

  return { ok: false };
}

type AlignResult =
  | { ok: true; tokens: RawToken[] }
  | { ok: false; reason: string };

function alignSentence(sentence: RawSentence): AlignResult {
  const { target, tokens } = sentence;
  const newTokens: RawToken[] = [];
  let cursor = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const idx = target.indexOf(token.lv, cursor);
    if (idx === -1) {
      return {
        ok: false,
        reason: `token #${i} "${token.lv}" not found in target at or after position ${cursor} (target: "${target}")`,
      };
    }
    if (idx !== cursor) {
      return {
        ok: false,
        reason: `unexpected gap before token #${i} "${token.lv}": "${target.slice(cursor, idx)}" (target: "${target}")`,
      };
    }

    const end = idx + token.lv.length;
    const isFinal = i === tokens.length - 1;
    const gapEnd = isFinal ? target.length : target.indexOf(tokens[i + 1].lv, end);

    if (!isFinal && gapEnd === -1) {
      return {
        ok: false,
        reason: `token #${i + 1} "${tokens[i + 1].lv}" not found in target at or after position ${end} (target: "${target}")`,
      };
    }

    const gap = target.slice(end, gapEnd === -1 ? undefined : gapEnd);
    const parsed = parseGap(gap, isFinal);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: `unrecognized gap after token #${i} "${token.lv}": "${gap}" (target: "${target}")`,
      };
    }

    const { punct: _punct, ...rest } = token as RawToken & { punct?: string };
    newTokens.push(parsed.punct ? { ...rest, punct: parsed.punct } : rest);

    cursor = isFinal ? target.length : gapEnd;
  }

  return { ok: true, tokens: newTokens };
}

// JSON.stringify(lesson, null, 2) expands every object onto multiple lines.
// The house style keeps each token object and each newLemmas array on one
// line, so collapse those back down to avoid reformatting the whole file
// for a one-field addition.
function collapseTokenObjects(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\{\s*$/.test(line) && lines[i + 1] && /"lv":/.test(lines[i + 1])) {
      const indent = line.match(/^\s*/)![0];
      let j = i + 1;
      const fields: string[] = [];
      while (j < lines.length && !/^\s*\},?\s*$/.test(lines[j])) {
        fields.push(lines[j].trim().replace(/,$/, ""));
        j++;
      }
      const trailingComma = lines[j].trim().endsWith(",") ? "," : "";
      out.push(`${indent}{ ${fields.join(", ")} }${trailingComma}`);
      i = j;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function collapseNewLemmas(text: string): string {
  return text.replace(/"newLemmas": \[\n([\s\S]*?)\n\s*\]/g, (_match, body: string) => {
    const items = body
      .split("\n")
      .map((l) => l.trim().replace(/,$/, ""))
      .filter(Boolean);
    return `"newLemmas": [${items.join(", ")}]`;
  });
}

function serialize(lesson: RawLesson): string {
  return collapseNewLemmas(collapseTokenObjects(JSON.stringify(lesson, null, 2))) + "\n";
}

function main() {
  const lessonFiles = fs
    .readdirSync(LESSONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(LESSONS_DIR, f));

  const failures: string[] = [];
  const updates: { file: string; lesson: RawLesson; touchedSentences: number }[] = [];

  for (const file of lessonFiles) {
    const lesson: RawLesson = JSON.parse(fs.readFileSync(file, "utf-8"));
    let touchedSentences = 0;

    for (const section of lesson.sections) {
      for (const sentence of section.sentences) {
        const result = alignSentence(sentence);
        if (!result.ok) {
          failures.push(`  ${path.basename(file)} [${sentence.id}]: ${result.reason}`);
          continue;
        }
        if (result.tokens.some((t) => "punct" in t)) touchedSentences++;
        sentence.tokens = result.tokens;
      }
    }

    updates.push({ file, lesson, touchedSentences });
  }

  if (failures.length > 0) {
    console.log(red(bold("\nAlignment failed for one or more sentences — no files written:")));
    failures.forEach((f) => console.log(red(f)));
    process.exit(1);
  }

  for (const { file, lesson, touchedSentences } of updates) {
    fs.writeFileSync(file, serialize(lesson));
    console.log(green(`  ${path.basename(file)}: backfilled punct on ${touchedSentences} sentence(s)`));
  }

  console.log(green(bold("\n✓ Punctuation backfill complete")));
}

main();
