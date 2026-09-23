#!/usr/bin/env bun
/**
 * clonethis: clone one component off a live site, 1:1.
 *
 * choose it
 *   find <url> "<query>"              hits for a selector / text / layer name, with ancestor chains + outlined shots
 *   find <url> --like <shot.png>      the elements that look like a screenshot of it, at every width
 *   pick <url>                        point at it in a real window ([ ] to change level, click to take it)
 *
 * grab it (reference/<name>/)
 *   grab <url> --select <css> [--nth N] | --name <layer> | --text "<text>" [--up N] | --like <shot.png>
 *        [--as name] [--brand Name] [--tokens a,b] [--viewports 1440,1024,810,390] [--headless] [--no-states] [--no-frames]
 *                                    subtree + used css + fonts + assets + states + frames + snapshot + self-check + REBUILD.md
 *   grab-image <shot.png> [<shot-390.png>] --as name [--vp 1440,390] [--dsf 2]
 *                                    no url: the screenshot is the reference (size, OCR text, palette, row bands)
 *   rip <ref>                         (Framer) module motion windows focused on the component
 *   brief <ref>                       (re)write REBUILD.md
 *   init <project> [--ref reference/<name>]   CONVENTIONS.md + GOAL.md for this project's stack
 *
 * build loop (your component's root carries data-clone-root)
 *   shot <url> <out.png> [--ref <ref>] [--w 1440] [--hover css] [--click css]   the component, pinned like the reference
 *   compare <url> <ref> [--w 1440] [--all]      every text run + media box: yours vs reference, deltas
 *   boxes <url> <w> [--ref <ref>]               element boxes relative to the root (same columns as refboxes)
 *   refboxes <ref> <vp|w>                       the reference's element boxes
 *   states <url> <ref>                          hover / press / focus / open: yours vs reference
 *   frames <url> <out> --scenario enter|load|hover|toggle|loop [--ref <ref>] [--target N]
 *   sheet <framesDir> <out.png> [--step 200]    contact sheet at fixed time steps
 *   diff <a.png> <b.png> [out.png]              pixel diff with a sheet
 *   cssq <ref> <@cN | fragment>                 rules that style an element
 *   serve <ref>                                 serve the reference (snapshot/index.html)
 *   verify <url> <ref> [--w ...] [--max-diff 3] THE GATE: root, text runs, media, pixels, console, blackout. PASS / FAIL
 *
 * origin blackout (the clone never says where it came from)
 *   blackout <project> [--fix] [--strict]       fail on any mention of the origin in the project
 *   origin <ref> [--url|--host|--selector]      what a reference was taken from, for scripting rigs
 */
import fs from 'node:fs';
import { usage } from './lib/args.ts';

const [cmd, ...rest] = process.argv.slice(2);
const HELP = fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith(' *')).map((l) => l.replace(/^ \*\s?/, '')).join('\n');

async function main() {
  switch (cmd) {
    case 'find': return (await import('./rig/find.ts')).runFind(rest);
    case 'pick': return (await import('./rig/find.ts')).runPick(rest);
    case 'grab': case 'clone': return (await import('./grab.ts')).runGrab(rest);
    case 'grab-image': case 'image': return (await import('./grabimage.ts')).runGrabImage(rest);
    case 'rip': return (await import('./rip.ts')).runRip(rest);
    case 'brief': return (await import('./brief.ts')).runBrief(rest);
    case 'init': return (await import('./init.ts')).runInit(rest);
    case 'shot': return (await import('./rig/measure.ts')).runShot(rest);
    case 'compare': return (await import('./rig/measure.ts')).runCompare(rest);
    case 'boxes': return (await import('./rig/measure.ts')).runBoxes(rest);
    case 'refboxes': return (await import('./rig/measure.ts')).runRefboxes(rest);
    case 'states': return (await import('./rig/states.ts')).runStates(rest);
    case 'frames': return (await import('./rig/states.ts')).runFrames(rest);
    case 'sheet': return (await import('./rig/states.ts')).runSheet(rest);
    case 'diff': return (await import('./rig/misc.ts')).runDiff(rest);
    case 'cssq': return (await import('./rig/misc.ts')).runCssq(rest);
    case 'serve': return (await import('./rig/misc.ts')).runServe(rest);
    case 'verify': return (await import('./rig/verify.ts')).runVerify(rest);
    case 'blackout': return (await import('./rig/blackout.ts')).runBlackout(rest);
    case 'origin': return (await import('./rig/blackout.ts')).runOrigin(rest);
    case undefined: case 'help': case '--help': case '-h':
      console.log(HELP);
      return;
    default:
      usage(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
