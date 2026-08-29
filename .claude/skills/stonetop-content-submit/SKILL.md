---
name: stonetop-content-submit
description: Turn an author's description of a Stonetop arcanum, item, steading improvement, NPC, group, location, or follower into a schema-compliant content file for this repo (Markdown + YAML frontmatter under content/stonetop/<kind>/<slug>/<slug>.md), then verify it with the repo's own validator. Use when someone wants to submit/add/author third-party Stonetop content for Sled Dog, or says "add my arcanum", "make this item compliant", "turn this into a submission", "prep my steading improvement for a PR", "add my NPC/group/location", "add my follower", "ship art with my module". (Forged in the Dark content lives under content/forged/ with its own templates/schemas.) Runs in this repo (SledDog-Community-Content). Does NOT open the PR for the user or invent game mechanics.
---

# Stonetop content submission

Convert an author's content into a compliant submission file, **deterministically**.
The single definition of "compliant" is: **`node scripts/validate.mjs <file>` exits 0.**
Your job is to reach that state without changing the author's intended mechanics.

This skill authors **Stonetop** content, which lives under `content/stonetop/`
(schemas in `schema/stonetop/`, templates in `templates/stonetop/`). The repo is
organized system-first (`content/<system>/<kind>/<slug>/`); Forged in the Dark
content lives under `content/forged/` with its own kinds and templates.

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

1. **Determine the `kind`** — `arcanum`, `item`, `steading`, `npc`, `group`,
   `location`, or `follower`. If the author hasn't said, ask. (This is the only
   judgment call in the process.)
   - Two-faced magic item / working with a discovery + reveal → **arcanum**
   - Something a character carries in their pack → **item**
   - A building/upgrade the whole steading works toward → **steading**
   - One droppable person and the trouble they carry → **npc**
   - A faction / organization the party bumps into → **group**
   - A place a GM pins on the map and runs cold → **location**
   - Someone (or something) a *character* takes on and keeps — with Loyalty, HP,
     an instinct, and a cost → **follower**

   **NPC vs. follower** is the one that trips people up: an NPC is a person the GM
   drops into the world (a World-tab entry); a follower is a person, band, or beast
   that joins a character and lives on their sheet. If the author's pitch is "the
   party could hire them" it's a follower; if it's "they run the tannery and hate
   the Marshal" it's an NPC. Ask when it's genuinely both.

2. **Copy the template verbatim.** Start from `templates/stonetop/<kind>.md` — do not
   hand-write the frontmatter from memory. It already has the right keys and comments.

3. **Compute the slug** with this fixed rule: lowercase the name/title, strip a
   leading `the ` / `the-`, replace every run of non-alphanumerics with a single `-`,
   and trim leading/trailing `-`. (Items have no `slug` field — the slug is only used
   for the folder/filename; the folder is still `content/stonetop/items/<slug>/<slug>.md`.)
   Example: `The Whisper-Jar` → `whisper-jar`.

4. **Fill each field from the author's content.** Read `schema/stonetop/<kind>.schema.json` and
   fill every `required` field; include optional fields only when the author gave a
   value for them (delete the commented-out optional lines you don't use). Put prose
   the app doesn't need (flavor, illustrations) in the body, not the frontmatter.
   - For an **item** whose author describes a bespoke custom move, put the move's text
     in `note:` (Sled Dog can't model item-granted moves as a first-class mechanic yet).
   - For a **follower**, the same applies — a bespoke move goes in `notes:`. Set `type`
     (`individual` / `group` / `animal`) when the author says which; leave `loyalty` /
     `maxLoyalty` out unless they gave numbers (Sled Dog defaults to 1 / 3). Name the
     standouts of a band under `individuals:`.
   - Always set `author` and `author_url` to the author's real credit + link.

5. **Write the file** to `content/stonetop/<kind>/<slug>/<slug>.md`.

6. **Validate — this is the oracle.** Run:
   ```
   node scripts/validate.mjs content/stonetop/<kind>/<slug>/<slug>.md
   ```
   If it exits non-zero, read each `file:line message`, fix the frontmatter (without
   altering mechanics — if a real value is missing, ask the author), and re-run until
   it exits 0. Do not consider the task done until the validator passes.

7. **Report next steps** to the author (do NOT do these for them):
   > Your content is at `content/stonetop/<kind>/<slug>/<slug>.md` and passes validation.
   > To submit it: create a branch, commit the file, push to your fork, and open a
   > pull request. The GitHub Action will re-run this same validator on the PR.


## Art (any kind)

Every kind accepts an `images:` list, and it works identically for all of them. If the
author has art to ship:

1. Put the files in an `art/` folder **inside the content folder**:
   `content/stonetop/<kind>/<slug>/art/<name>.png`.
2. List them in the frontmatter, `file` relative to the content folder:
   ```yaml
   images:
     - file: art/portrait.png
       caption: Short title for the gallery card.
       description: Longer notes shown when the card is expanded.
   ```
3. **Verify each file exists on disk** before you write the frontmatter — Sled Dog
   serves these from GitHub raw, so a path that isn't committed becomes a broken card.
   Never invent an image entry the author didn't give you.

When a GM installs the module, these arrive as a named folder of cards on their party's
image gallery (hidden from players until the GM shows them). Only list art the author
says they have the right to share; don't list a storefront cover as gallery art.

## Notes

- If `node_modules` isn't installed, run `npm install` first (the validator needs
  `ajv`, `ajv-formats`, and `gray-matter`).
- Cross-repo uniqueness and collisions with the *official* Stonetop catalog are
  checked later by Sled Dog's loader, not here. Here, only this repo's schema and
  intra-repo uniqueness are enforced.
