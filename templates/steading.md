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
author: Your Name
author_url: https://your-site.example
---

Write the human-readable description of the improvement here (optional prose).
The frontmatter above is the source of truth for the game mechanics.
