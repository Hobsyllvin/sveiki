/**
 * Verifies that lesson JSON did not drift from its human-written, DeepL-checked draft.
 * Compares target and natural fields byte-for-byte against content/lv/drafts/<id>.md.
 *
 * Usage: npm run verify-drafts [-- --lesson lv-a1-01]
 */
import fs from "fs";
import path from "path";
import { LessonSchema } from "../src/lib/content/schema";

const DRAFTS_DIR = path.join(process.cwd(), "content", "lv", "drafts");
const LESSONS_DIR = path.join(process.cwd(), "content", "lv", "lessons");

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

type Draft = { latvian: string[]; natural: string[]; speakers: string[] };

function parseDraft(draftPath: string): Draft {
  const md = fs.readFileSync(draftPath, "utf-8");

  const latvian = [...md.matchAll(/^\s*(\d+)\.\s+(.*?)\s*$/gm)]
    .filter((m) => !m[2].startsWith("|"))
    .map((m) => m[2]);

  const rows = [...md.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm)];

  return {
    latvian,
    speakers: rows.map((r) => r[2]),
    natural: rows.map((r) => r[3]),
  };
}

function verify(lessonId: string): boolean {
  const draftPath = path.join(DRAFTS_DIR, `${lessonId}.md`);
  const lessonPath = path.join(LESSONS_DIR, `${lessonId}.json`);

  if (!fs.existsSync(draftPath)) {
    console.log(red(`  no draft found at ${path.relative(process.cwd(), draftPath)}`));
    return false;
  }

  const draft = parseDraft(draftPath);
  const lesson = LessonSchema.parse(JSON.parse(fs.readFileSync(lessonPath, "utf-8")));
  const sentences = lesson.sections.flatMap((s) =>
    s.sentences.map((sen) => ({ ...sen, format: s.format }))
  );

  const problems: string[] = [];

  if (sentences.length !== draft.latvian.length) {
    problems.push(
      `sentence count: lesson has ${sentences.length}, draft has ${draft.latvian.length}`
    );
  }

  const n = Math.min(sentences.length, draft.latvian.length);
  for (let i = 0; i < n; i++) {
    const sen = sentences[i];

    if (sen.target !== draft.latvian[i]) {
      problems.push(
        `[${sen.id}] Latvian drift\n    draft:  ${JSON.stringify(draft.latvian[i])}\n    lesson: ${JSON.stringify(sen.target)}`
      );
    }

    if (draft.natural[i] !== undefined && sen.natural !== draft.natural[i]) {
      problems.push(
        `[${sen.id}] English drift\n    draft:  ${JSON.stringify(draft.natural[i])}\n    lesson: ${JSON.stringify(sen.natural)}`
      );
    }

    const draftSpeaker = draft.speakers[i];
    if (draftSpeaker !== undefined && sen.speaker !== undefined && sen.speaker !== draftSpeaker) {
      problems.push(
        `[${sen.id}] speaker drift: draft "${draftSpeaker}", lesson "${sen.speaker}"`
      );
    }

    // Tokens (lv + punct) must reconstruct the target exactly — see validate.ts checkTokenization.
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    const reconstructed = sen.tokens.map((t) => t.lv + (t.punct ?? "")).join(" ");
    if (normalize(reconstructed) !== normalize(sen.target)) {
      problems.push(
        `[${sen.id}] tokens do not reconstruct target\n    target: ${normalize(sen.target)}\n    tokens: ${normalize(reconstructed)}`
      );
    }

    if (sen.audioApproved) {
      problems.push(`[${sen.id}] audioApproved must be false until a native speaker signs off`);
    }
  }

  if (problems.length > 0) {
    problems.forEach((p) => console.log(red(`  ${p}`)));
    return false;
  }

  console.log(green(`  ${lessonId}: ${sentences.length} sentences match draft exactly`));
  return true;
}

function main() {
  const flagIdx = process.argv.indexOf("--lesson");
  const single = flagIdx !== -1 ? process.argv[flagIdx + 1] : null;

  const lessonIds = (
    single
      ? [single]
      : fs
          .readdirSync(LESSONS_DIR)
          .filter((f) => f.endsWith(".json"))
          .map((f) => path.basename(f, ".json"))
  ).filter((id) => fs.existsSync(path.join(DRAFTS_DIR, `${id}.md`)));

  if (lessonIds.length === 0) {
    console.log("No lessons with drafts to verify.");
    return;
  }

  console.log(bold("\nVerifying lesson JSON against source drafts..."));
  const allPassed = lessonIds.map(verify).every(Boolean);

  console.log(allPassed ? green("\n✓ No drift from drafts") : red("\n✗ Drift detected"));
  process.exit(allPassed ? 0 : 1);
}

main();
