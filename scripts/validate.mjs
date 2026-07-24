#!/usr/bin/env node
/**
 * Validates third-party Stonetop content files (Markdown + YAML frontmatter)
 * against the shared JSON Schemas. This is the SAME validator that the CI
 * GitHub Action and the Sled Dog authoring skill run — "validate.mjs passes"
 * is the single, deterministic definition of a compliant submission.
 *
 * Usage:
 *   node scripts/validate.mjs                       # validate ./content against ./schema
 *   node scripts/validate.mjs --content <dir> --schema <dir>
 *   node scripts/validate.mjs path/to/one/file.md   # validate specific file(s)
 *
 * Note: cross-repo uniqueness and collisions with the OFFICIAL Stonetop
 * catalog are checked later, in Sled Dog's content loader (which has both
 * sources). Here we enforce schema compliance + uniqueness within this repo.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import matter from "gray-matter";

const KINDS = {
  arcanum: "arcanum.schema.json",
  item: "item.schema.json",
  steading: "steading.schema.json",
  npc: "npc.schema.json",
  group: "group.schema.json",
  location: "location.schema.json",
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
const validators = {};
for (const [kind, fname] of Object.entries(KINDS)) {
  const schema = JSON.parse(readFileSync(join(schemaDir, fname), "utf8"));
  validators[kind] = ajv.compile(schema);
}

const files = opts.files.length ? opts.files.map((f) => resolve(f)) : walk(resolve(opts.content));

const problems = [];
const seen = new Map(); // "kind:slug" -> file

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
  // Files with no frontmatter at all (READMEs, expeditions, plain prose) are not
  // content submissions — skip them silently. A file WITH frontmatter must, however,
  // declare a known `kind`.
  if (!data || Object.keys(data).length === 0) {
    continue;
  }
  const kind = data.kind;
  if (!kind || !validators[kind]) {
    report(rel, lineOf(text, "/kind"), `missing or unknown \`kind\` (expected one of: ${Object.keys(KINDS).join(", ")})`);
    continue;
  }
  const validate = validators[kind];
  if (!validate(data)) {
    for (const err of validate.errors) {
      const where = err.instancePath || "(root)";
      const extra = err.keyword === "additionalProperties" ? ` (\`${err.params.additionalProperty}\`)` : "";
      report(rel, lineOf(text, err.instancePath), `${where} ${err.message}${extra}`);
    }
    continue;
  }
  // Intra-repo uniqueness.
  const slug = kind === "item" ? slugify(data.name) : data.slug;
  const id = `${kind}:${slug}`;
  if (seen.has(id)) {
    report(rel, 1, `duplicate ${kind} \`${slug}\` — also defined in ${seen.get(id)}`);
  } else {
    seen.set(id, rel);
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
