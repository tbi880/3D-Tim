import { prologue } from './chapters/prologue.js';
import { interdiction } from './chapters/interdiction.js';
import { graveyard } from './chapters/graveyard.js';
import { theForge } from './chapters/forge.js';
import { holdTheLine } from './chapters/holdTheLine.js';
import { eclipse } from './chapters/eclipse.js';
import { lantern } from './chapters/lantern.js';
import { muster } from './chapters/muster.js';
import { home } from './chapters/home.js';

/**
 * ECHOES OF DAWN - the campaign script.
 *
 * The story is one continuous sequence (no level select): each beat runs when the one
 * before it finishes. Dialogue text lives in i18n/<locale>.js under the keys the chapters use.
 *
 * Each chapter is a module in story/chapters/, read top to bottom; what more than one chapter
 * uses is in chapters/common.js (and chapters/fleet.js for Tim's fleet and the carriers).
 *
 * Conventions:
 *  - `checkpoint(id)` is a save point. Enemies are never saved, so place checkpoints at
 *    lulls, and re-declare anything non-persistent right after one (see `trackCoreCharge` in
 *    chapters/holdTheLine.js).
 *  - Ships the story needs later are spawned with `persistent: true` and a tag.
 *  - Story variables live in `ctx.vars` and must stay plain JSON.
 *  - Distances are metres. Capital ships are hundreds of metres long, so spawn escorts
 *    a couple of kilometres out (`around(tag, distance)` measures from the ship's centre).
 */

/** The full campaign, in order. */
export const CAMPAIGN = Object.freeze([...prologue, ...interdiction, ...graveyard, ...theForge, ...holdTheLine, ...eclipse, ...lantern, ...muster, ...home]);

/** The sector a brand new game starts in. */
export const STARTING_SECTOR = 'collapse';
