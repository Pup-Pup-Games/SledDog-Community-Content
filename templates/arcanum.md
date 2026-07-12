---
# ─── Arcanum template ───────────────────────────────────────────────
# Fill every field. Keep the mechanics EXACTLY as you intend them —
# the validator (and Sled Dog) read this frontmatter, not the prose below.
# Do NOT add a `number:` field; Sled Dog assigns third-party deck numbers.
kind: arcanum
slug: my-arcanum            # kebab-case, no leading "the-"
rarity: minor              # minor | major
# location: false          # optional — true if the unrevealed front is a place
# stats: [WIS]             # optional — STR | DEX | CON | INT | WIS | CHA
author: Your Name
author_url: https://your-site.example
front:                     # the discovery side (before it's unlocked)
  objectName: A found object
  tags: [magical]
  description: >-
    Evocative discovery flavor — what it looks like and where it was found.
  unlockRequirements:      # the checklist the player fulfills to reveal it
    - The first way to learn its use.
    - The second way to learn its use.
  requireCount: 1          # null = need all; a number = need any N of them
  # load: 0                # optional — Load per carried unit
  # small: true            # optional — a small (circle-slot) possession
  # uses: 0                # optional — consumable use-circles
back:                      # the arcanum side (revealed once the front is met)
  arcanumName: The True Name
  description: >-
    How the working manifests once revealed.
  # tags: [magical]        # optional — defaults to the front's tags
  priceText: >-            # optional — the standing price / resource rules
    The cost of using it, as prose.
  moves:
    - name: The Move Name
      text: >-
        The full move text (rolls, 10+ / 7–9 / 6- outcomes).
      # unlockAtConsequences: 1   # optional — major arcana only
  # consequences:          # optional — major arcana checklist
  #   - A consequence line.
  # follower:              # optional — a follower granted on reveal
  #   name: Beast Name
  #   type: animal
  #   hp: 4
  #   damage: d6
  #   instinct: to run
---

Write the human-readable version of the arcanum here (optional prose).
The frontmatter above is the source of truth for the game mechanics.
