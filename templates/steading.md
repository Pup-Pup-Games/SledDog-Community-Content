---
# ─── Steading improvement template ──────────────────────────────────
# A building/upgrade the whole steading works toward. Maps to Sled Dog's
# steading improvements picker.
kind: steading
slug: my-improvement       # kebab-case, no leading "the-"
name: The Improvement
summary: One-line pitch shown in the picker.
requirements:              # lines the party checks off as they fulfill them
  - The first thing you need.
  - The second thing you need.
requireCount: null         # null = need all; a number = need any N of them
effects: >-
  What acquiring it does (resource/track changes), its henceforth move in
  prose, and its upkeep — all as descriptive text.
impacts:                   # resource tracks it impacts (colored labels + filters); [] if none
  - fortunes               # fortunes | prosperity | surplus | defenses | population
seasons: 2                 # minimum seasons to complete; omit or null if the rules state none
# grants_moves:            # optional: Home Front move(s) granted to every character on acquire
#   - name: The Move Name
#     text: When you …, roll +Fortunes: on a 10+ …
author: Your Name
author_url: https://your-site.example
---

Write the human-readable description of the improvement here (optional prose).
The frontmatter above is the source of truth for the game mechanics.
