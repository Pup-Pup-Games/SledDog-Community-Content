#!/usr/bin/env node
/**
 * Every image this repo tracks is public — module art, and the README and
 * social-card art in repo-assets/ alike — so every one is checked for
 * identifying metadata, not only the files `images:` lists. The validator
 * covers module art in depth (size, listing); this is the repo-wide floor.
 *
 *   npm run check:images
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { inspectImage } from "./lib/art.mjs";

const IMAGE = /\.(png|jpe?g|webp)$/i;
/** Image formats this check cannot inspect. Refused outright rather than passed
 *  unread — SVG in particular carries editor paths with the author's username. */
const UNINSPECTABLE =
  /\.(svgz?|gif|avif|heic|heif|jxl|jp2|j2k|ico|tiff?|bmp|psd|psb|xcf|kra|clip|procreate|afphoto|afdesign|ai|eps|xmp|dng|raw|cr2|cr3|nef|arw|orf|rw2)$/i;
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const files = tracked.filter((f) => IMAGE.test(f) && existsSync(f)); // a local deletion is not yet committed

let bad = 0;
for (const f of tracked.filter((f) => UNINSPECTABLE.test(f))) {
  bad++;
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::error file=${f}::image type cannot be checked for metadata`);
  console.error(`✖ ${f}  cannot be checked for identifying metadata — export it as PNG, JPG or WebP`);
}
for (const f of files) {
  const { problems } = inspectImage(readFileSync(f), extname(f));
  if (!problems.length) continue;
  bad++;
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::error file=${f}::identifying metadata: ${problems.join(", ")}`);
  const fix = /\.png$/i.test(f) ? `run \`npm run art:optimize -- ${f}\`` : "re-export it without metadata";
  console.error(`✖ ${f}  ${problems.join(", ")} — ${fix}`);
}
if (bad) {
  console.error(`\n${bad} of ${files.length} tracked image(s) carry metadata.`);
  process.exit(1);
}
console.log(`✓ ${files.length} tracked image(s) carry no identifying metadata.`);
