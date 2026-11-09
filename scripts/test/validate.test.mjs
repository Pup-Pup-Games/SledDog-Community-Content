/**
 * Runs the real validator against a throwaway content tree, so the art rules are
 * tested exactly as CI runs them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_ART_BYTES, provenanceXmp } from "../lib/art.mjs";
import { chunk, midjourneyChunks, png, tEXt } from "./fixtures.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

/** A valid Stonetop item module with the given `images:` and art files. */
function run({ images = [], art = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "art-validate-"));
  try {
    const mod = join(dir, "content", "stonetop", "items", "test-horn");
    mkdirSync(join(mod, "art"), { recursive: true });
    const yamlImages = images.length
      ? "images:\n" + images.map((f) => `  - file: ${f}\n    caption: A card\n`).join("")
      : "";
    writeFileSync(
      join(mod, "test-horn.md"),
      `---\nkind: item\nname: Test Horn\nsummary: A horn for testing.\nlabel: misc\ntags:\n- loud\nvalue: 1\n${yamlImages}author: Test Author\nauthor_url: https://example.com\n---\n`,
    );
    for (const [name, buf] of Object.entries(art)) writeFileSync(join(mod, "art", name), buf);
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/validate.mjs"), "--content", join(dir, "content"), "--schema", join(ROOT, "schema")], {
      cwd: dir,
      encoding: "utf8",
    });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a module whose listed art is clean passes", () => {
  const r = run({ images: ["art/horn.png"], art: { "horn.png": png({ extra: [tEXt("XML:com.adobe.xmp", provenanceXmp())] }) } });
  assert.equal(r.code, 0, r.out);
});

test("art carrying Midjourney metadata fails and names the fix", () => {
  const r = run({ images: ["art/horn.png"], art: { "horn.png": png({ extra: midjourneyChunks() }) } });
  assert.equal(r.code, 1);
  assert.match(r.out, /horn\.png.*identifying metadata.*npm run art:optimize/);
});

test("art in art/ that images: does not list fails — the silent drop", () => {
  const r = run({ images: ["art/horn.png"], art: { "horn.png": png(), "forgotten.png": png() } });
  assert.equal(r.code, 1);
  assert.match(r.out, /forgotten\.png.*not listed/);
  assert.doesNotMatch(r.out, /horn\.png.*not listed/);
});

test("OS litter in art/ is ignored", () => {
  const r = run({ images: ["art/horn.png"], art: { "horn.png": png(), ".DS_Store": Buffer.from("x"), "Thumbs.db": Buffer.from("x") } });
  assert.equal(r.code, 0, r.out);
});

test("a dotfile in art/ that is not OS litter fails", () => {
  const r = run({ images: ["art/horn.png"], art: { "horn.png": png(), ".notes.txt": Buffer.from("someone") } });
  assert.equal(r.code, 1);
  assert.match(r.out, /\.notes\.txt.*not listed/);
});

test("an unlisted source file in art/ fails — it is published all the same", () => {
  const svg = '<svg inkscape:export-filename="/home/someone/art/horn.png"/>';
  const r = run({ images: ["art/horn.png"], art: { "horn.png": png(), "horn.svg": Buffer.from(svg) } });
  assert.equal(r.code, 1);
  assert.match(r.out, /horn\.svg.*not listed/);
});

test("a module with art but no images: at all fails", () => {
  const r = run({ art: { "horn.png": png() } });
  assert.equal(r.code, 1);
  assert.match(r.out, /horn\.png.*not listed/);
});

test("a listed image that does not exist fails", () => {
  const r = run({ images: ["art/missing.png"] });
  assert.equal(r.code, 1);
  assert.match(r.out, /art\/missing\.png` does not exist/);
});

test("an image over the size limit fails", () => {
  const big = png({ extra: [chunk("pHYs", Buffer.alloc(9)), chunk("bKGD", Buffer.alloc(MAX_ART_BYTES))] });
  const r = run({ images: ["art/horn.png"], art: { "horn.png": big } });
  assert.equal(r.code, 1);
  assert.match(r.out, /over the 2 MB gallery limit/);
});
