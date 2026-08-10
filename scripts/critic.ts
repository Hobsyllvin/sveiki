/**
 * critic.ts
 * Usage: npm run critic -- --lesson lv-a1-01
 *
 * Sends the generated lesson to a separate API call framed as adversarial
 * peer review.  Writes the issue report to content/lv/reports/<id>.critic.json
 * and prints a summary table.
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { LessonSchema } from "../src/lib/content/schema";

const CRITIC_MODEL = "claude-fable-5";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const GLOSSING_RULES_PATH = path.join(
  CONTENT_ROOT,
  "_shared",
  "GLOSSING_RULES.md"
);

interface CriticIssue {
  sentenceId: string;
  tokenIndex?: number;
  severity: "error" | "warning";
  category: string;
  description: string;
  suggestedFix: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const lessonIdx = args.indexOf("--lesson");
  if (lessonIdx === -1 || !args[lessonIdx + 1]) {
    console.error("Usage: npm run critic -- --lesson <id>");
    process.exit(1);
  }
  return { lessonId: args[lessonIdx + 1] };
}

function inferLang(lessonId: string): string {
  return lessonId.split("-")[0];
}

function buildCriticPrompt(glossingRules: string, lessonJson: string): string {
  return `You are a senior Latvian-language editor reviewing a junior translator's work before publication.

Your standard is the Birkenbihl decoding method: every token must be decoded with strict, rule-following precision.

The glossing rules are the authoritative standard for every decision:

## GLOSSING RULES

${glossingRules}

## LESSON TO REVIEW

${lessonJson}

## YOUR TASK

Review this lesson adversarially, as if looking for reasons NOT to publish it.

Finding zero issues in a generated lesson is suspicious — look harder.  Small issues compound for language learners who rely on the decode line as their primary learning tool.

For every sentence, check:

(a) **Latvian correctness**: Is the Latvian grammatically correct and natural for A1 level?  Would a native speaker say this?
(b) **Lemma accuracy**: For each inflected token, is the lemma the true dictionary (nominative/infinitive) form?  E.g., "maizi" → lemma "maize" ✓;  "maizi" → lemma "maizi" ✗
(c) **Gloss correctness**: Does the gloss follow the rules exactly?  Is it the correct literal meaning of THAT specific inflected form (not a general translation)?
(d) **Decode readability**: Does the decode line, read in order, convey the sentence's meaning?  Is it strange-but-understandable English?
(e) **Natural translation accuracy**: Is the "natural" field an accurate idiomatic English translation of the Latvian?
(f) **Note accuracy**: Do notes correctly identify case, verb form, etc.?

Output a JSON array of issues — and ONLY the JSON array, nothing else.  Each issue:

{
  "sentenceId": "s1",
  "tokenIndex": 2,        // optional — omit if the issue is sentence-level
  "severity": "error",    // "error" (must fix) | "warning" (should fix)
  "category": "lemma",    // short slug: lemma / gloss / latvian / decode / natural / note / structure
  "description": "...",
  "suggestedFix": "..."
}

If there are truly no issues, output an empty array: []

Output ONLY the JSON array, nothing else.`;
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

  const lessonRaw = fs.readFileSync(lessonPath, "utf-8");
  const lesson = LessonSchema.parse(JSON.parse(lessonRaw));
  const glossingRules = fs.readFileSync(GLOSSING_RULES_PATH, "utf-8");

  const prompt = buildCriticPrompt(glossingRules, JSON.stringify(lesson, null, 2));

  console.log(`Running critic on ${lessonId} with model ${CRITIC_MODEL}...`);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: CRITIC_MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") {
    console.error("Model refused.");
    process.exit(1);
  }

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonText = rawText
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  let issues: CriticIssue[];
  try {
    issues = JSON.parse(jsonText);
    if (!Array.isArray(issues)) throw new Error("not an array");
  } catch {
    console.error("Critic output is not valid JSON:");
    console.error(jsonText.slice(0, 500));
    process.exit(1);
  }

  fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, `${lessonId}.critic.json`);
  fs.writeFileSync(outPath, JSON.stringify(issues, null, 2) + "\n");
  console.log(`\nCritic report written to ${outPath}`);

  // Summary table
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  console.log(`\n${"─".repeat(70)}`);
  console.log(`CRITIC SUMMARY: ${lessonId}`);
  console.log(`${"─".repeat(70)}`);
  console.log(`  Errors:   ${errors.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Total:    ${issues.length}`);

  if (issues.length > 0) {
    console.log("\nIssues:");
    for (const issue of issues) {
      const loc =
        issue.tokenIndex !== undefined
          ? `${issue.sentenceId}[token ${issue.tokenIndex}]`
          : issue.sentenceId;
      const tag = issue.severity === "error" ? "ERROR  " : "warning";
      console.log(`  [${tag}] ${loc} (${issue.category})`);
      console.log(`           ${issue.description}`);
      console.log(`           Fix: ${issue.suggestedFix}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n${errors.length} error(s) require resolution before proceeding.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
