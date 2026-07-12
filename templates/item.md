---
# ─── Item template ──────────────────────────────────────────────────
# An inventory / special item a character carries. Maps to Sled Dog gear.
# If your item grants a bespoke custom move, put its text in `note` for now
# (Sled Dog can't yet model item-granted moves as a first-class mechanic).
kind: item
name: My Item Name         # Sled Dog derives the slug + key from this
label: misc                # weapons | armor | camp | tools | writing | transport | trade | misc
tags: [a-tag, another-tag]
value: 1                   # relative Value 0–4
# load: 1                  # optional — Load slots per unit (defaults to 1)
# small: false             # optional — a small possession (circle slot, no Load)
# uses: 0                  # optional — consumable use-circles
# note: >-                 # optional — clarifying note / custom-move text
#   Extra details, or the text of a bespoke move this item enables.
author: Your Name
author_url: https://your-site.example
---

Write the human-readable description of the item here (optional prose).
The frontmatter above is the source of truth for the game mechanics.
