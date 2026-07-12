---
name: stonetop-content-submit
description: Turn an author's description of a Stonetop arcanum, item, or steading improvement into a schema-compliant content file for this repo (Markdown + YAML frontmatter under content/<kind>/<slug>/<slug>.md), then verify it with the repo's own validator. Use when someone wants to submit/add/author third-party Stonetop content for Sled Dog, or says "add my arcanum", "make this item compliant", "turn this into a submission", "prep my steading improvement for a PR". Runs in this repo (SledDog-3rd-Party-Content). Does NOT open the PR for the user or invent game mechanics.
---

# Stonetop content submission

Convert an author's content into a compliant submission file, **deterministically**.
The single definition of "compliant" is: **`node scripts/validate.mjs <file>` exits 0.**
Your job is to reach that state without changing the author's intended mechanics.

## Hard rules

- **Do not invent, rebalance, or reword mechanics.** Numbers, dice outcomes, tags,
  requirements, and move text come from the author, copied faithfully. If a required
  mechanical field is missing, ASK the author — do not fill it in yourself.
- **The schema is the contract.** Read the matching file in `schema/` and put every
  value where the schema says. Never add fields the schema doesn't define
  (`additionalProperties: false` will reject them).
- **Never set `number` on an arcanum.** Sled Dog assigns third-party deck numbers.
- The frontmatter is the source of truth; prose goes in the body and is optional.

## Procedure (follow in order)

1. **Determine the `kind`** — `arcanum`, `item`, or `steading`. If the author hasn't
   said, ask. (This is the only judgment call in the process.)
   - Two-faced magic item / working with a discovery + reveal → **arcanum**
   - Something a character carries in their pack → **item**
   - A building/upgrade the whole steading works toward → **steading**

2. **Copy the template verbatim.** Start from `templates/<kind>.md` — do not
   hand-write the frontmatter from memory. It already has the right keys and comments.

3. **Compute the slug** with this fixed rule: lowercase the name/title, strip a
   leading `the ` / `the-`, replace every run of non-alphanumerics with a single `-`,
   and trim leading/trailing `-`. (Items have no `slug` field — the slug is only used
   for the folder/filename; the folder is still `content/items/<slug>/<slug>.md`.)
   Example: `The Whisper-Jar` → `whisper-jar`.

4. **Fill each field from the author's content.** Read `schema/<kind>.schema.json` and
   fill every `required` field; include optional fields only when the author gave a
   value for them (delete the commented-out optional lines you don't use). Put prose
   the app doesn't need (flavor, illustrations) in the body, not the frontmatter.
   - For an **item** whose author describes a bespoke custom move, put the move's text
     in `note:` (Sled Dog can't model item-granted moves as a first-class mechanic yet).
   - Always set `author` and `author_url` to the author's real credit + link.

5. **Write the file** to `content/<kind>/<slug>/<slug>.md`.

6. **Validate — this is the oracle.** Run:
   ```
   node scripts/validate.mjs content/<kind>/<slug>/<slug>.md
   ```
   If it exits non-zero, read each `file:line message`, fix the frontmatter (without
   altering mechanics — if a real value is missing, ask the author), and re-run until
   it exits 0. Do not consider the task done until the validator passes.

7. **Report next steps** to the author (do NOT do these for them):
   > Your content is at `content/<kind>/<slug>/<slug>.md` and passes validation.
   > To submit it: create a branch, commit the file, push to your fork, and open a
   > pull request. The GitHub Action will re-run this same validator on the PR.

## Notes

- If `node_modules` isn't installed, run `npm install` first (the validator needs
  `ajv`, `ajv-formats`, and `gray-matter`).
- Cross-repo uniqueness and collisions with the *official* Stonetop catalog are
  checked later by Sled Dog's loader, not here. Here, only this repo's schema and
  intra-repo uniqueness are enforced.
