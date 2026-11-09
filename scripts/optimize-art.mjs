#!/usr/bin/env node
/**
 * Strip identifying metadata from gallery art and recompress it losslessly.
 *
 * For each PNG it drops every metadata chunk (author, prompt, job id, creation
 * time, EXIF) and writes back an XMP packet holding ONLY the AI-provenance label —
 * kept if the file already had one, added with `--ai`. Stripping is chunk-level,
 * so pixels cannot change. Plain 8-bit truecolour PNGs are then recompressed
 * (an all-opaque alpha channel dropped, maximum effort) and the result is kept
 * only if it is smaller and its decoded pixels match; anything else — 16-bit,
 * palette, wide-gamut, animated — is stripped and otherwise left alone. Files
 * already clean and no smaller recompressed are left byte-for-byte alone, so the
 * tool is safe to rerun.
 *
 * Usage:
 *   npm run art:optimize                         # every content/**\/art/*.png
 *   npm run art:optimize -- --ai                 # ...and label them AI-generated
 *   npm run art:optimize -- --check              # report only; exit 1 if any file would change
 *   npm run art:optimize -- path/to/art/x.png    # specific files
 *
 * JPEG and WebP are not rewritten here — re-encoding them is lossy. Strip those
 * with your image editor's "export without metadata" before committing.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { AI_SOURCE_TYPE, inspectImage, pngChunks, pngSourceType, provenanceXmp, stripPng } from "./lib/art.mjs";

function artFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...artFiles(p));
    else if (p.split(sep).includes("art")) out.push(p);
  }
  return out;
}

/**
 * Strip a PNG, then recompress it when that is provably lossless and smaller.
 *
 * Stripping is chunk-level, so it never touches a pixel. Recompression goes
 * through sharp, whose raw output is 8-bit sRGB — so it is attempted only for
 * plain 8-bit truecolour PNGs with no colour or gamma chunks and no animation, where an
 * 8-bit comparison really is the whole truth. Anything else (16-bit, palette,
 * grayscale, wide-gamut, APNG) is stripped and left otherwise as it was.
 */
export async function optimizePng(src, sourceType) {
  const stripped = stripPng(src, sourceType);
  const meta = await sharp(src).metadata();
  const chunkTypes = new Set(pngChunks(src).map((c) => c.type));
  const plain =
    meta.depth === "uchar" && !meta.isPalette && (meta.channels === 3 || meta.channels === 4) &&
    !["iCCP", "acTL", "sBIT", "gAMA", "cHRM", "sRGB"].some((t) => chunkTypes.has(t)); // sharp drops these
  if (!plain) return stripped;
  const { isOpaque } = await sharp(src).stats();
  let img = sharp(src);
  if (isOpaque) img = img.removeAlpha();
  img = img.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10, palette: false });
  if (sourceType) img = img.withXmp(provenanceXmp(sourceType));
  const out = await img.toBuffer();
  const [a, b] = await Promise.all([
    sharp(src).ensureAlpha().raw().toBuffer(),
    sharp(out).ensureAlpha().raw().toBuffer(),
  ]);
  if (!a.equals(b)) throw new Error("re-encoded pixels differ from the original");
  return out.length < stripped.length ? out : stripped;
}

async function main() {
  const args = process.argv.slice(2);
  const ai = args.includes("--ai");
  const check = args.includes("--check");
  const paths = args.filter((a) => !a.startsWith("--"));
  const files = (paths.length ? paths : artFiles("content")).filter((f) => extname(f).toLowerCase() === ".png");

  let changed = 0, failed = 0, before = 0, after = 0;
  for (const file of files) {
    const rel = relative(process.cwd(), file);
    const src = readFileSync(file);
    const { problems, sourceType } = inspectImage(src, ".png");
    // Carry the label from whatever packet the file has (Midjourney's included).
    const label = pngSourceType(src) ?? (ai ? AI_SOURCE_TYPE : null);
    let out;
    try {
      out = await optimizePng(src, label);
    } catch (e) {
      console.error(`✖ ${rel}  ${e.message}`);
      failed++;
      continue;
    }
    const needsWrite = problems.length > 0 || label !== sourceType || out.length < src.length;
    before += src.length;
    after += needsWrite ? out.length : src.length;
    if (!needsWrite) continue;
    changed++;
    const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
    const why = problems.length ? `stripped ${problems.join(", ")}` : label !== sourceType ? "added AI label" : "recompressed";
    console.log(`${check ? "would fix" : "✓"} ${rel}  ${kb(src.length)} → ${kb(out.length)}  (${why})`);
    if (!check) writeFileSync(file, out);
  }
  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(`\n${files.length} PNG(s), ${changed} ${check ? "need fixing" : "rewritten"}; ${mb(before)} MB → ${mb(after)} MB.`);
  if (failed || (check && changed)) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
