---
# ─── Location template ──────────────────────────────────────────────
# A place a GM can pin on the map and run cold. Maps to a Sled Dog World
# location entry. Delete any optional line you don't use.
kind: location
slug: my-location          # kebab-case, no leading "the-"
name: The Place
summary: One-line hook shown on the Manage content page.
description: >-            # The Place — what it is, its history, why folk avoid (or want) it.
  One short flavor paragraph.
# impressions:            # sensory beats on arrival
#   - The first thing the party notices.
#   - The second.
# features:               # keyed features / rooms
#   - name: 1 — The First Feature
#     text: What it is and what it threatens or offers.
# dangers:
#   hazards:
#     - An environmental danger, as a prose line.
#   statBlock:            # optional — what lurks here
#     tags: [Solitary, Large, Amphibious]
#     hp: 14
#     armor: 1
#     damage: d10 (close, forceful)
#     special: How it hunts.
#     instinct: to <verb-phrase>
#     moves:
#       - A GM move that is theirs.
# hooks:
#   - title: A short bold lead-in.
#     text: The reason the place pulls the party out the gate; what it leaves open.
# notes: >-               # optional GM notes
#   Anything else the table should know.
# images:                  # optional — art shipped to the party image gallery
#   - file: art/scene.png    # relative to this folder; commit the file beside this .md
#     caption: A short title for the gallery card.
#     description: Longer notes shown when the card is expanded.
author: Your Name
author_url: https://your-site.example
---

Write the human-readable version of the location here (optional prose).
The frontmatter above is the source of truth for the entry's fields.
