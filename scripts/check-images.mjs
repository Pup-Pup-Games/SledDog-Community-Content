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
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { inspectImage } from "./lib/art.mjs";

const IMAGE = /\.(png|jpe?g|webp)$/i;
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => IMAGE.test(f));

let bad = 0;
for (const f of files) {
  const { problems } = inspectImage(readFileSync(f), extname(f));
  if (!problems.length) continue;
  bad++;
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::error file=${f}::identifying metadata: ${problems.join(", ")}`);
  console.error(`✖ ${f}  ${problems.join(", ")} — run \`npm run art:optimize -- ${f}\``);
}
if (bad) {
  console.error(`\n${bad} of ${files.length} tracked image(s) carry metadata.`);
  process.exit(1);
}
console.log(`✓ ${files.length} tracked image(s) carry no identifying metadata.`);
