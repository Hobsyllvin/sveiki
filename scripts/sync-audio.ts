// Mirrors the per-sentence clips into public/audio/<lang>/ so Next serves them as
// static assets. content/<lang>/audio/ stays the only committed copy; public/audio is
// git-ignored and rebuilt by predev/prebuild.
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

  const sourceFiles = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".mp3"));

  // A clip that is gone from content must not keep being served from a stale copy.
  for (const file of fs.readdirSync(targetDir)) {
    if (file.endsWith(".mp3") && !sourceFiles.includes(file)) {
      fs.rmSync(path.join(targetDir, file));
      pruned++;
    }
  }

  for (const file of sourceFiles) {
    const source = path.join(sourceDir, file);
    const target = path.join(targetDir, file);
    if (
      fs.existsSync(target) &&
      fs.statSync(target).size === fs.statSync(source).size
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
