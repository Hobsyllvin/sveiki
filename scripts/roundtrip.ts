/**
 * roundtrip.ts
 * Usage: npm run roundtrip -- --lesson lv-a1-01
 *
 * For each sentence, sends ONLY the gloss line to the model and asks what the
 * sentence means in normal English.  Compares against the stored "natural"
 * field and flags meaningful divergence.
 *
 * This catches decodings that are internally consistent but wrong — the failure
 * mode the critic is worst at.
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { LessonSchema } from "../src/lib/content/schema";

// Roundtrip uses Sonnet — the task is English comprehension, not Latvian morphology.
const ROUNDTRIP_MODEL = "claude-sonnet-5";

const CONTENT_ROOT = path.join(process.cwd(), "content");

interface RoundtripResult {
  sentenceId: string;
  glossLine: string;
  storedNatural: string;
  modelInterpretation: string;
  diverged: boolean;
  note: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const lessonIdx = args.indexOf("--lesson");
  if (lessonIdx === -1 || !args[lessonIdx + 1]) {
    console.error("Usage: npm run roundtrip -- --lesson <id>");
    process.exit(1);
  }
  return { lessonId: args[lessonIdx + 1] };
}

function inferLang(lessonId: string): string {
  return lessonId.split("-")[0];
}

function buildInterpretationPrompt(glossLine: string): string {
  return `The following is a word-for-word literal gloss of a Latvian sentence (Latvian words replaced with their literal English equivalents in the original word order):

"${glossLine}"

What does this sentence mean in normal, natural English?  Reply with a single plain English sentence only — no explanation, no punctuation other than a period.`;
}

function buildDivergenceCheckPrompt(
  storedNatural: string,
  modelInterpretation: string
): string {
  return `Compare these two English sentences:

A: "${storedNatural}"
B: "${modelInterpretation}"

Do they convey the same meaning?  Minor rephrasing or wording differences are fine; only flag if the MEANING differs substantially (different action, different subject, different object, opposite polarity, etc.).

Reply with a JSON object only, nothing else:
{"same_meaning": true, "note": ""}

or

{"same_meaning": false, "note": "brief explanation of how they differ"}`;
}

async function main() {
  const { lessonId } = parseArgs();
  const lang = inferLang(lessonId);
  const langDir = path.join(CONTENT_ROOT, lang);
  const lessonPath = path.join(langDir, "lessons", `${lessonId}.json`);
  const reportsDir = path.join(langDir, "reports");

  if (!fs.existsSync(lessonPath)) {
    console.error(`Lesson file not found: ${lessonPath}`);
    process.exit(1);
  }

  const lesson = LessonSchema.parse(
    JSON.parse(fs.readFileSync(lessonPath, "utf-8"))
  );

  const client = new Anthropic();
  const results: RoundtripResult[] = [];

  const allSentences = lesson.sections.flatMap((s) => s.sentences);

  console.log(
    `Running roundtrip check on ${lessonId} (${allSentences.length} sentences) with model ${ROUNDTRIP_MODEL}...`
  );

  for (const sentence of allSentences) {
    const glossLine = sentence.tokens.map((t) => t.gloss).join(" ");
    process.stdout.write(`  ${sentence.id}... `);

    // Step 1: ask model what the gloss line means
    const interpResponse = await client.messages.create({
      model: ROUNDTRIP_MODEL,
      max_tokens: 256,
      messages: [
        { role: "user", content: buildInterpretationPrompt(glossLine) },
      ],
    });

    const interpretation = interpResponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .join("")
      .replace(/^["']|["']$/g, "");

    // Step 2: ask model if interpretation matches stored natural
    const checkResponse = await client.messages.create({
      model: ROUNDTRIP_MODEL,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: buildDivergenceCheckPrompt(
            sentence.natural,
            interpretation
          ),
        },
      ],
    });

    const checkText = checkResponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .join("")
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();

    let checkResult: { same_meaning: boolean; note: string };
    try {
      checkResult = JSON.parse(checkText);
    } catch {
      checkResult = { same_meaning: false, note: `parse error: ${checkText.slice(0, 80)}` };
    }

    const diverged = !checkResult.same_meaning;
    process.stdout.write(diverged ? "DIVERGED\n" : "ok\n");

    results.push({
      sentenceId: sentence.id,
      glossLine,
      storedNatural: sentence.natural,
      modelInterpretation: interpretation,
      diverged,
      note: checkResult.note,
    });
  }

  fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, `${lessonId}.roundtrip.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nRoundtrip report written to ${outPath}`);

  const diverged = results.filter((r) => r.diverged);
  console.log(`\n${"─".repeat(70)}`);
  console.log(`ROUNDTRIP SUMMARY: ${lessonId}`);
  console.log(`${"─".repeat(70)}`);
  console.log(`  Sentences checked: ${results.length}`);
  console.log(`  Diverged:          ${diverged.length}`);

  if (diverged.length > 0) {
    console.log("\nDivergences:");
    for (const r of diverged) {
      console.log(`\n  [${r.sentenceId}]`);
      console.log(`    Gloss:       ${r.glossLine}`);
      console.log(`    Stored:      ${r.storedNatural}`);
      console.log(`    Model read:  ${r.modelInterpretation}`);
      console.log(`    Note:        ${r.note}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
