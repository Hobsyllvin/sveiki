// Mirrors generated lesson audio into public/audio/<lang>/ so Next serves it as a
// static asset (byte-range requests, which Safari needs for seeking, come free).
// content/<lang>/audio-elevenlabs/<lessonId>/ stays the committed lesson source;
// public/audio is git-ignored and rebuilt by predev/prebuild.
import fs from "fs";
import path from "path";
import { AUDIO_DIR_NAME } from "../src/lib/content/load";

const CONTENT_ROOT = path.join(process.cwd(), "content");
const PUBLIC_AUDIO = path.join(process.cwd(), "public", "audio");

let copied = 0;
let skipped = 0;
let pruned = 0;

for (const lang of fs.readdirSync(CONTENT_ROOT)) {
  if (lang.startsWith("_") || lang.startsWith(".")) continue;
  const sourceDir = path.join(CONTENT_ROOT, lang, AUDIO_DIR_NAME);
  if (!fs.existsSync(sourceDir)) continue;

  const targetDir = path.join(PUBLIC_AUDIO, lang);
  fs.mkdirSync(targetDir, { recursive: true });

  const sources = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .flatMap((entry): { file: string; source: string }[] => {
      if (entry.isFile() && entry.name.endsWith(".mp3")) {
        return [{ file: entry.name, source: path.join(sourceDir, entry.name) }];
      }
      if (!entry.isDirectory()) return [];

      const file = `${entry.name}.mp3`;
      const source = path.join(sourceDir, entry.name, file);
      return fs.existsSync(source) ? [{ file, source }] : [];
    });
  const sourceFiles = sources.map(({ file }) => file);

  // Audio that no longer exists in content must not keep being served from a stale
  // copy — public/audio survives branch switches and would otherwise ship orphans.
  for (const file of fs.readdirSync(targetDir)) {
    if (file.endsWith(".mp3") && !sourceFiles.includes(file)) {
      fs.rmSync(path.join(targetDir, file));
      pruned++;
    }
  }

  for (const { file, source } of sources) {
    const target = path.join(targetDir, file);
    if (
      fs.existsSync(target) &&
      fs.statSync(target).size === fs.statSync(source).size &&
      fs.readFileSync(target).equals(fs.readFileSync(source))
    ) {
      skipped++;
      continue;
    }
    fs.copyFileSync(source, target);
    copied++;
  }
}

console.log(
  `audio sync: ${copied} copied, ${skipped} already current, ${pruned} stale removed`
);
