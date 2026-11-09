#!/usr/bin/env node
/**
 * Validates third-party Sled Dog content files (Markdown + YAML frontmatter)
 * against the shared JSON Schemas. This is the SAME validator that the CI
 * GitHub Action and the Sled Dog authoring skill run — "validate.mjs passes"
 * is the single, deterministic definition of a compliant submission.
 *
 * Content is organized SYSTEM-FIRST: content/<system>/<kind>/<slug>/<slug>.md,
 * with one schema set per system under schema/<system>/. The `system` is derived
 * from the path (the directory immediately under `content/`), and the file's
 * `kind` frontmatter must be a kind that system defines.
 *
 * Usage:
 *   node scripts/validate.mjs                       # validate ./content against ./schema
 *   node scripts/validate.mjs --content <dir> --schema <dir>
 *   node scripts/validate.mjs path/to/one/file.md   # validate specific file(s)
 *
 * Note: cross-repo uniqueness and collisions with the OFFICIAL catalogs are
 * checked later, in Sled Dog's content loader (which has every source). Here we
 * enforce schema compliance + uniqueness within this repo (namespaced by system).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, extname, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import matter from "gray-matter";
import { MAX_ART_BYTES, inspectImage } from "./lib/art.mjs";

/**
 * The kinds each system defines, mapped to their schema filename (under
 * schema/<system>/). Adding a system = add an entry here + a schema/<system>/
 * folder + a templates/<system>/ folder. Kind names may repeat across systems
 * (e.g. `npc`, `item`) — they resolve against the system derived from the path.
 */
const SYSTEMS = {
  stonetop: {
    arcanum: "arcanum.schema.json",
    item: "item.schema.json",
    steading: "steading.schema.json",
    expedition: "expedition.schema.json",
    npc: "npc.schema.json",
    group: "group.schema.json",
    location: "location.schema.json",
    follower: "follower.schema.json",
  },
  forged: {
    score: "score.schema.json",
    faction: "faction.schema.json",
    npc: "npc.schema.json",
    district: "district.schema.json",
    item: "item.schema.json",
  },
};
const IN_CI = process.env.GITHUB_ACTIONS === "true";

function parseArgs(argv) {
  const opts = { content: "content", schema: "schema", files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--content") opts.content = argv[++i];
    else if (a === "--schema") opts.schema = argv[++i];
    else opts.files.push(a);
  }
  return opts;
}

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (extname(p) === ".md") out.push(p);
  }
  return out;
}

/**
 * Derive the system for a file from its path: the directory segment immediately
 * following a `content` segment (content/<system>/...). Returns null if the path
 * has no recognizable `content/<system>` prefix.
 */
function systemOf(file) {
  const segs = resolve(file).split(/[\\/]/);
  const idx = segs.lastIndexOf("content");
  if (idx === -1 || idx + 1 >= segs.length) return null;
  return segs[idx + 1];
}

/** Best-effort line number of a frontmatter field, so errors point somewhere useful. */
function lineOf(fileText, instancePath) {
  const lines = fileText.split(/\r?\n/);
  const segs = instancePath.split("/").filter(Boolean);
  // Use the last non-numeric segment as the key to search for.
  let key = "";
  for (let i = segs.length - 1; i >= 0; i--) {
    if (!/^\d+$/.test(segs[i])) { key = segs[i]; break; }
  }
  if (!key) return 1;
  const re = new RegExp("^\\s*" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:");
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return 1;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/^the[-\s]+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const opts = parseArgs(process.argv.slice(2));
const schemaDir = resolve(opts.schema);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

// Compile validators lazily, per system:kind, so a repo that only touches one
// system doesn't require every system's schema folder to exist.
const validatorCache = new Map(); // "system:kind" -> compiled validator (or null if unknown)
function getValidator(system, kind) {
  const cacheKey = `${system}:${kind}`;
  if (validatorCache.has(cacheKey)) return validatorCache.get(cacheKey);
  const fname = SYSTEMS[system]?.[kind];
  if (!fname) {
    validatorCache.set(cacheKey, null);
    return null;
  }
  const schema = JSON.parse(readFileSync(join(schemaDir, system, fname), "utf8"));
  const validate = ajv.compile(schema);
  validatorCache.set(cacheKey, validate);
  return validate;
}

const files = opts.files.length ? opts.files.map((f) => resolve(f)) : walk(resolve(opts.content));

const problems = [];
const seen = new Map(); // "system:kind:slug" -> file

function report(file, line, message) {
  problems.push({ file, line, message });
}

for (const file of files) {
  const rel = relative(process.cwd(), file) || file;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    report(rel, 1, `cannot read file: ${e.message}`);
    continue;
  }
  let data;
  try {
    ({ data } = matter(text));
  } catch (e) {
    report(rel, 1, `invalid YAML frontmatter: ${e.message}`);
    continue;
  }
  // Files with no frontmatter at all (READMEs, plain prose) are not content
  // submissions — skip them silently. A file WITH frontmatter must, however,
  // sit under a known system and declare a `kind` that system defines.
  if (!data || Object.keys(data).length === 0) {
    continue;
  }
  const system = systemOf(file);
  if (!system || !SYSTEMS[system]) {
    report(rel, 1, `cannot determine system from path (expected content/<system>/... where system is one of: ${Object.keys(SYSTEMS).join(", ")})`);
    continue;
  }
  const kind = data.kind;
  const validate = kind ? getValidator(system, kind) : null;
  if (!validate) {
    report(rel, lineOf(text, "/kind"), `missing or unknown \`kind\` for system \`${system}\` (expected one of: ${Object.keys(SYSTEMS[system]).join(", ")})`);
    continue;
  }
  if (!validate(data)) {
    for (const err of validate.errors) {
      const where = err.instancePath || "(root)";
      const extra = err.keyword === "additionalProperties" ? ` (\`${err.params.additionalProperty}\`)` : "";
      report(rel, lineOf(text, err.instancePath), `${where} ${err.message}${extra}`);
    }
    continue;
  }
  // Intra-repo uniqueness, namespaced by system (a stonetop `npc` and a forged
  // `npc` with the same slug do not collide).
  const slug = kind === "item" ? slugify(data.name) : data.slug;
  const id = `${system}:${kind}:${slug}`;
  if (seen.has(id)) {
    report(rel, 1, `duplicate ${system} ${kind} \`${slug}\` — also defined in ${seen.get(id)}`);
  } else {
    seen.set(id, rel);
  }
  checkArt(file, rel, text, data);
}

/** Every file under a directory, as paths relative to it with `/` separators. */
function filesUnder(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, base));
    else out.push(relative(base, p).split(sep).join("/"));
  }
  return out;
}

/**
 * Gallery art is published from GitHub raw, permanently, so the checks here are
 * about what leaves the repo: each `images[].file` must exist, be small enough
 * for a phone, and carry no identifying metadata; and every file in the module's
 * `art/` folder must be listed in `images:` — art that nothing references ships
 * no gallery card, and that silent drop is how ten modules lost theirs.
 */
function checkArt(file, rel, text, data) {
  const moduleDir = dirname(file);
  const referenced = new Set();
  for (const img of Array.isArray(data.images) ? data.images : []) {
    if (typeof img?.file !== "string") continue;
    referenced.add(img.file);
    const line = lineOf(text, "/images");
    const path = join(moduleDir, img.file);
    if (img.file.startsWith("/") || img.file.split("/").includes("..")) {
      report(rel, line, `images: \`${img.file}\` must be a path inside this module folder`);
      continue;
    }
    if (!existsSync(path)) {
      report(rel, line, `images: \`${img.file}\` does not exist`);
      continue;
    }
    const buf = readFileSync(path);
    const where = relative(process.cwd(), path);
    if (buf.length > MAX_ART_BYTES) {
      report(where, 1, `${(buf.length / 1048576).toFixed(1)} MB is over the ${MAX_ART_BYTES / 1048576} MB gallery limit — run \`npm run art:optimize\`, or downscale it`);
    }
    const { problems } = inspectImage(buf, extname(path));
    if (problems.length) {
      report(where, 1, `image carries identifying metadata (${problems.join(", ")}) — run \`npm run art:optimize\``);
    }
  }
  const artDir = join(moduleDir, "art");
  if (!existsSync(artDir)) return;
  for (const f of filesUnder(artDir)) {
    // OS litter (exact names) is ignored. Anything else unlisted is refused, not just images:
    // a source file left beside its export (an Inkscape SVG carries the author's
    // home-directory path) is published just the same.
    if (/(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(f)) continue;
    if (!referenced.has(`art/${f}`)) {
      report(relative(process.cwd(), join(artDir, f)), 1, `art file is not listed in ${relative(process.cwd(), file)}'s \`images:\` — it would ship no gallery card, and is published anyway. List it, or remove it`);
    }
  }
}

if (problems.length) {
  for (const p of problems) {
    if (IN_CI) {
      const msg = p.message.replace(/\n/g, " ");
      console.log(`::error file=${p.file},line=${p.line}::${msg}`);
    }
    console.error(`✖ ${p.file}:${p.line}  ${p.message}`);
  }
  console.error(`\n${problems.length} problem(s) in ${files.length} file(s).`);
  process.exit(1);
}

console.log(`✓ ${files.length} content file(s) valid.`);
