# Contributing content

Thank you for making content for the community! This repo holds
**third-party, unofficial** content that [Sled Dog](https://sleddog.puppup.games)
can pull in and offer to tables that opt into third-party content — with **your
name and a link on every item**.

Content is organized **by game system**. We currently accept content for:

**Stonetop** (by Jeremy Strandberg) — under `content/stonetop/`:

- **Arcana** — a two-faced magic item / working (a discovery, then a revealed arcanum).
- **Items** — an inventory / special item a character carries.
- **Steadings** — a steading improvement the whole village works toward.
- **NPCs** — one droppable, ready-to-run person and the trouble they carry.
- **Groups** — a faction / organization the party keeps bumping into.
- **Locations** — a place a GM can pin on the map and run cold.

**Forged in the Dark** (based on *Blades in the Dark* by John Harper, One Seven
Design, under CC-BY 3.0) — under `content/forged/`:

- **Scores** — a droppable operation/situation a crew can take on.
- **Factions** — a faction a GM can drop in and play cold.
- **NPCs** — one unforgettable person and the trouble they carry.
- **Districts** — a district or location to pin and run cold.
- **Items** — a loadout item a character carries.

(More systems and types will open up as Sled Dog gains support for them.)

## How it works

Content is **Markdown with YAML frontmatter**. The frontmatter is the source of
truth for the game mechanics; the prose below it is for humans. A file must
validate against the schema in [`schema/`](schema/) before it can be merged — a
GitHub Action checks every pull request and tells you exactly what to fix.

## Submitting a piece of content

1. **Fork** this repo.
2. **Start from a template** in [`templates/<system>/`](templates/) for your
   content kind. Copy it to `content/<system>/<kind>/<slug>/<slug>.md`, where
   `<system>` is `stonetop` or `forged`, `<kind>` is one of that system's kinds
   (Stonetop: `arcana`, `items`, `steadings`, `npcs`, `groups`, `locations`;
   Forged: `scores`, `factions`, `npcs`, `districts`, `items`), and `<slug>` is a
   kebab-case name (no leading `the-`), e.g.
   `content/stonetop/arcana/whisper-jar/whisper-jar.md` or
   `content/forged/scores/the-ledger-run/the-ledger-run.md`.
   *(Using Claude Code? Run the `stonetop-content-submit` skill in this repo — it
   fills the frontmatter from your description and runs the validator for you.)*
3. **Fill in the frontmatter.** Put your real mechanics in — numbers, tags, move
   text, requirements. Every item needs your `author` and a `author_url`
   (your site, itch page, socials — wherever you'd like the credit link to go).
4. **Validate locally** (optional but fast):
   ```
   npm install
   npm run validate
   ```
5. **Open a pull request.** The validator runs automatically. If it fails, read
   the annotations — each points at the field and line to fix — push a fix, and
   it re-runs.
6. A maintainer reviews it, we test it in Sled Dog's staging environment, and
   once it looks good it's promoted to production for everyone who has
   third-party content enabled.

## Ground rules

- **You must have the right to share it.** By submitting, you agree your content
  can be distributed as part of this repo and offered inside Sled Dog, credited
  to you. Don't submit others' work as your own.
- **Stonetop compatibility.** This is unofficial, fan-made material compatible
  with _Stonetop_ by Jeremy Strandberg — not affiliated with or endorsed by
  Lampblack & Brimstone. Players need their own copy of _Stonetop_.
- **AI disclosure.** If you used AI tools to help write it, that's fine — just say
  so in your PR description so we can note it.
- **Keep the mechanics honest.** The validator checks shape, not balance; a
  reviewer reads for that.

## Need help?

Stuck on the format, or the validator won't go green? **[Contact us →](https://puppup.atlassian.net/servicedesk/customer/portal/1/group/4/create/21)**
and we'll help you get it in.
