---
# ─── Follower template ──────────────────────────────────────────────
# A ready-made follower — a person, a band, or a beast a character can
# take on. Maps to Sled Dog's follower catalog: adding one from the
# Followers tab seeds a card with these stats already filled in.
# Delete any optional line you don't use.
kind: follower
slug: my-follower          # kebab-case, no leading "the-"
name: The Name
summary: >-                # 1–2 sentences on who this is (shown in the picker
                           # and on the Manage content page)
  Who they are and why a character would want them at their back.
# type: individual         # individual | group | animal (defaults to individual)
# descriptor: The short line under the name — their look, their bearing.
# loyalty: 1               # starting Loyalty (defaults to 1)
# maxLoyalty: 3            # Loyalty track size (defaults to 3)
# hp: 6
# armor: 0
# damage: d6 (hand)
# tags: [loyal, green, knows-the-fens]
# instinct: to settle it with fists
# cost: What keeps them following — drink, coin, a share of the take.
# notes: >-                # clarifying notes carried onto the follower's card
#   Anything the player should know. A bespoke move's text goes here for now.
# individuals:             # group followers only — the standouts, by name
#   - name: A Member
#     tag: The one quality that sets them apart.
#     traits: [a trait, another]
# images:                  # optional — art shipped to the party image gallery
#   - file: art/portrait.png     # relative to this folder; commit the file beside this .md
#     caption: A short title for the gallery card.
#     description: Longer notes shown when the card is expanded.
author: Your Name
author_url: https://your-site.example
---

Write the human-readable version of the follower here (optional prose).
The frontmatter above is the source of truth for the entry's fields.
