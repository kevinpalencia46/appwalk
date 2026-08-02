// src/tui/mascot.js — the appwalk character: a duck holding a lantern.
// Rubber-duck debugging reversed: the duck explains *your* code to *you*.
//
// PLACEHOLDER — NO-OP. Kevin is drawing the real character in Procreate and will
// spec the ASCII from it later. Until then this module ships empty on purpose: the
// ASCII duck (14 rows x ~40 cols, 4-frame walk cycle, amber lantern flame) spent 14
// rows communicating nothing on the home screen, so it is gone for now. This file
// keeps the import surface STABLE so dropping the art back in is a pure file edit —
// no restructuring anywhere else.
//
// Contract (keep these export names stable):
//   MASCOT_FRAMES  — array of raw frame strings (14 rows x 40 cols, `*` = flame)
//   MASCOT_ROWS    — frame height in rows
//   MASCOT_COLS    — frame width in columns
//   MASCOT_STATIC  — the home pose, colored, ready to print
//   renderMascot(i, flick) — one colored frame as a string
//   animateMascot(stdout, at) — walk-cycle overlay; returns a cleanup function
export const MASCOT_FRAMES = [];
export const MASCOT_ROWS = 0;
export const MASCOT_COLS = 0;

export const renderMascot = () => '';

export const MASCOT_STATIC = '';

export function animateMascot() {
  return () => {};
}
