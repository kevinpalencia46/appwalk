# appwalk — visual identity & mascot spec

**Source:** Claude chat (Kevin's design pass) + Kevin's approval. Two deliverables, one
character (a duck holding a lantern — rubber duck debugging reversed: the duck explains
*your* code to *you*). This repo implements the TERMINAL side (ASCII mascot + palette +
layout); the BRAND side (illustration, CRT landing page, favicons) is the web track.

## Character
A duck holding a lantern. Friendly, curious, **slightly concerned on your behalf** — never
smug. Half-humanised: round head/body, rubber-hose arms (no elbows, oversized hands), small
feet, lantern raised in one hand. Simple dot eyes.

## Style DNA
1930s-50s rubber-hose + mid-century public-information illustration: thick uniform black
outlines, flat fill, noodle limbs. Public-domain style; avoid the specific franchise
character (no blue/yellow jumpsuit, no signature poses).

## Scene (brand, later)
Dark library of code, shelves labelled `src` `lib` `api` `?`, the duck walking with lantern
raised, the light pooling on ONE file: `.env` with `sk-••••••` visible. One joke in the
character, one in the scene — nothing else.

## Palette — monochrome phosphor (adopt in the TUI)
```
phosphor green  #33FF66  primary text, linework, mascot
dim green       #1F9940  borders, inactive, shelf labels
lantern amber   #FFB300  lantern glow ONLY, nothing else
danger red      #FF4444  real secrets only, nothing else
black           #000000  ground
```
Amber is reserved for the lantern — one warm point in a cold monochrome screen. Red stays
strictly secrets. Commit to green; no theme switcher at v1.

## Terminal mascot (IMPLEMENT)
- src/tui/mascot.js: 4-frame walk cycle (contact/passing mirrored, 200ms/frame = 5fps),
  lantern flicker on a SEPARATE 370ms interval so the cycles drift (never divide evenly),
  ~14 rows x <=40 cols, fixed width.
- Home screen ONLY — strip it from tour steps (it currently repeats and costs 3 rows).
- Never repaint the whole screen: save cursor (\x1b[s), jump to mascot rows, rewrite,
  restore (\x1b[u). Hide cursor (\x1b[?25l) + restore in exit handler AND on SIGINT.
  Guard on process.stdout.isTTY (piped/NO_COLOR/CI -> one static frame). Stop animation on
  first keypress (clear intervals). SSH fallback: ~3s then settle to a static pose.

## Screen layout fixes (IMPLEMENT)
1. Kill the void: draw the box to full terminal height, pin the hint bar to the bottom row
   (looks like an application, crops clean to 9:16).
2. Cap line length at 72-76 chars (currently 140+).
3. Quiet the hint bar: dim background, muted foreground, highlight only the one active key.
4. Rebuild tour step 5 (choose-your-model) as a SELECTABLE LIST: 4 rows
   (lite/pro/local/Claude Code), each with cost + one-line "good at", arrow to move, Enter
   to expand setup detail — not a wall of prose.

## Testing
- Evaluate in a stock/default terminal (Kevin's Termius theme recolors pink — that's the
  terminal, not us). Use the pink theme deliberately for TikTok captures.

## Build order
1. Terminal mascot frames + animation (ships with CLI, unblocks the demo capture)
2. Layout fixes — bigger visual win than the mascot, do together
3. Brand illustration + CRT landing page (web track, later)
4. Derived assets (favicons/avatars) last
