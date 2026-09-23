/**
 * REBUILD.md for a grabbed component: what it is at each width, where the truth lives, how far the static
 * snapshot got, and the build / verify loop. Written by `grab` and `clonethis brief <reference/name>`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Args, usage } from './lib/args.ts';
import { readOrigin } from './lib/anon.ts';

export function writeBrief(root: string) {
  const j = (rel: string) => (fs.existsSync(path.join(root, rel)) ? JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) : null);
  const meta = j('component.json') ?? {};
  const check = j('snapshot/check.json');
  const states = j('capture/states/states.json');
  const frames = j('capture/frames/report.json');
  const origin = readOrigin(root);
  const brand = origin?.brand ?? meta.brand ?? 'Brand';
  const rel = path.relative(process.cwd(), root) || '.';
  const name = path.basename(root);
  if (meta.mode === 'image') return writeImageBrief(root, meta, brand, rel, name);
  const L: string[] = [];
  L.push(`# REBUILD: ${name}`, '', `> Captured ${meta.capturedAt ?? '?'} by clonethis. One component, measured at every width. Build from these files; never eyeball a number.`, '');
  L.push('## Origin blackout (not optional)', '');
  L.push(`This is ${brand}'s component now. Nothing you write may say where it came from: not a file name, class name, comment, alt text, commit message or reply. The source url and the source selector live in \`${rel}/.origin.json\` for the rigs and nowhere else.`, '');
  L.push(`- Everything in this folder is already scrubbed: the origin's words read as \`${brand}\`, its links are route-relative, assets are content addressed (\`img-<hash>.webp\`, \`font-<hash>.woff2\`). Copy from here and you stay clean. Never copy from a live browser tab.`);
  L.push(`- A logo or wordmark inside the component still carries the origin visually: keep it as a placeholder, name it neutrally, flag it.`);
  L.push(`- \`clonethis blackout .\` must print CLEAN; \`clonethis verify\` runs it.`, '');
  L.push('## The component', '', '| width | root (w x h) | elements | text runs | media | height from | html variant |', '|---|---|---|---|---|---|---|');
  for (const [vp, v] of Object.entries<any>(meta.viewports ?? {})) {
    if (v.found === false) { L.push(`| ${vp} ${v.width} | not rendered at this width | | | | | |`); continue; }
    L.push(`| ${vp} ${v.width} | ${v.root.w} x ${v.root.h} | ${v.elements} | ${v.textRuns} | ${v.media} | ${v.heightFromContext ? '**context** (pinned in verify)' : 'content'} | ${v.htmlVariant} |`);
  }
  const variants = new Set(Object.values<any>(meta.viewports ?? {}).filter((v) => v.found !== false).map((v) => v.htmlVariant));
  L.push('');
  if (variants.size > 1) L.push(`**The page renders ${variants.size} different subtrees across widths** (html variant column). Build each one (or one component that switches at the same breakpoints): \`dom/<vp>.html\` holds each.`, '');
  L.push(`Stack of the page: ${meta.stack?.framework ?? '?'}. ${(meta.stack?.notes ?? []).join(' ')}`, '');
  L.push(`CSS: ${meta.css?.rules ?? 0} rules used (${meta.css?.conditional ?? 0} behind a breakpoint / condition, ${meta.css?.stateful ?? 0} for states), ${meta.css?.keyframes ?? 0} keyframes, ${meta.css?.fontFaces ?? 0} font faces, ${meta.css?.vars ?? 0} custom properties. Assets: ${meta.assets ?? 0}.`, '');

  L.push('## Ground truth in this folder', '');
  L.push('- `spec/component.txt`: START HERE. The tree (tag, `@cN` id, layer name, classes, inline style, text) then every css rule that applies, split into at rest / by breakpoint / for states, each with the ids it matched per width.');
  L.push('- `css/used.css`: those rules as a stylesheet, in cascade order, with the @font-face and @keyframes they need, urls pointing at `assets/`. `css/rules.json` is the same with matches; `css/vars.json` the custom property values per width.');
  L.push('- `dom/component.html` (desktop) and `dom/<vp>.html`: the subtree as rendered, urls local. `dom/symbols.svg`: svg defs it references from elsewhere on the page.');
  L.push('- `capture/<vp>/component.png` (2x, exactly the root\'s box), `context.png` (40px around it), `layout.json` (every element: rect relative to the root + computed styles + ::before/::after), `texts.json` (every painted text run with its glyph box: what verify checks), `media.json`, `context.json` (inherited type, backdrop, ancestor chain, whether its height came from its container), `interactive.json`, `animations.json`.');
  L.push('- `capture/states/` + `motion/states.md`: hover / press / focus / open, every computed property that changed and the transition in effect, with shots.');
  L.push('- `capture/frames/` + `motion/frames.md`: 60fps screencasts cropped to the component: entrance (load or scroll-in), each hover / toggle, loops.');
  L.push('- `motion/transitions.json`, `motion/animations.json` (running WAAPI / CSS animations with keyframes and timing), `motion/keyframes.css`. Framer pages: `motion/framer-appear.json`, `motion/rip.md` + `constants.json` (focused on this component), `modules/`.');
  L.push('- `snapshot/index.html`: the component standing alone (html + used css + fonts + assets + inherited context). Static: no script runs in it.', '');

  if (check) {
    L.push('## Snapshot self-check', '', '> The snapshot run through the same gate your build will face. Where it fails, the static extraction is not enough on its own and the reason is usually script: a JS-measured layout, a spring mid-flight, a canvas. Build from the spec and the frames there.', '', '| width | gate | height | text runs | media | pixels |', '|---|---|---|---|---|---|');
    for (const [vp, v] of Object.entries<any>(check.viewports ?? {})) L.push(`| ${vp} | ${v.pass ? 'PASS' : 'FAIL'} | ${v.root?.build?.h ?? '-'} / ${v.root?.ref?.h ?? '-'} | ${v.texts.ok}/${v.texts.total}${v.texts.missing ? ` (${v.texts.missing} missing)` : ''} | ${v.media.ok}/${v.media.total} | ${v.pixels?.differPct ?? '-'}% |`);
    L.push('');
  }
  if (states?.targets?.length) {
    L.push('## States', '', '| # | target | hover | press | focus | open | back to rest |', '|---|---|---|---|---|---|---|');
    for (const t of states.targets) L.push(`| ${t.index} | ${t.kind} ${t.text ? `"${t.text}"` : t.tag} | ${t.hover?.changes.length ?? '-'} | ${t.press?.changes.length ?? '-'} | ${t.focus?.changes.length ?? '-'} | ${t.open?.changes.length ?? '-'} | ${t.restored === false ? 'no' : 'yes'} |`);
    L.push('', 'Numbers are changed properties. Details and transitions in `motion/states.md`.', '');
  }
  if (frames && Object.keys(frames).length) {
    L.push('## Motion recorded', '', '| scenario | frames | motion ms | |', '|---|---|---|---|');
    for (const [k, v] of Object.entries<any>(frames)) L.push(`| ${k} | ${v.frameCount} | ${v.firstMotionMs ?? '-'} -> ${v.lastMotionMs ?? '-'} | ${v.hover?.verdict ?? ''} |`);
    L.push('');
  }
  if (meta.errors?.length) L.push('## Capture errors', '', ...meta.errors.map((e: string) => `- ${e}`), '');
  L.push('## The loop', '', 'Put `data-clone-root` on your component\'s root element and render it on a page of the dev server.', '', '```bash');
  L.push(`clonethis shot http://localhost:3777/<page> ${rel}/build/1440.png --ref ${rel} --w 1440      # your component, pinned like the reference`);
  L.push(`clonethis compare http://localhost:3777/<page> ${rel} --w 1440                             # every text run + media box: yours vs reference, deltas`);
  L.push(`clonethis boxes http://localhost:3777/<page> 1440 --ref ${rel}  /  clonethis refboxes ${rel} desktop   # element boxes, same columns`);
  L.push(`clonethis states http://localhost:3777/<page> ${rel}                                     # hover / press / focus / open: yours vs reference`);
  L.push(`clonethis frames http://localhost:3777/<page> ${rel}/build/frames/enter --scenario enter --ref ${rel} && clonethis sheet ${rel}/build/frames/enter a.png && clonethis sheet ${rel}/capture/frames/enter b.png`);
  L.push(`clonethis verify http://localhost:3777/<page> ${rel}                                      # THE GATE: PASS at every width or keep going`);
  L.push(`clonethis blackout .`);
  L.push('```', '', 'Rules for the build are in `reference/CONVENTIONS.md` (written by `clonethis init`). Method: the clonethis skill `docs/METHOD.md`.', '');
  fs.writeFileSync(path.join(root, 'REBUILD.md'), L.join('\n'));
  return path.join(root, 'REBUILD.md');
}

/** REBUILD.md for a reference grabbed from screenshots: no DOM, no CSS, so the brief is about reading pixels well. */
function writeImageBrief(root: string, meta: any, brand: string, rel: string, name: string) {
  const L: string[] = [];
  L.push(`# REBUILD: ${name} (from screenshots)`, '', `> Captured ${meta.capturedAt} by clonethis grab-image. There is no page behind this reference: no DOM, no css, no states, no motion. What is here was measured off the pixels. Look at the images first, every width.`, '');
  L.push('## Origin blackout', '', `The pixels may show another brand's name or logo. The clone is ${brand}'s: write ${brand}'s copy where a brand name appears, use a placeholder mark, and never name where the screenshot came from in code, comments, alt text or commits. \`clonethis blackout .\` (with \`--tokens\` for any name you know is in the image).`, '');
  L.push('## Sizes', '', '| width | component (css px) | screenshot dsf | text lines | row bands |', '|---|---|---|---|---|');
  for (const [vp, v] of Object.entries<any>(meta.viewports ?? {})) L.push(`| ${vp} ${v.width} | ${v.root.w} x ${v.root.h} | ${v.dsf} | ${v.ocrLines} | ${v.rows} |`);
  L.push('', 'The css size is the screenshot size divided by its pixel ratio (`--dsf`, 2 for a Retina screenshot). If the text looks too big or too small against a known font size, the ratio is wrong: re-run `grab-image` with `--dsf` or `--css-width`.', '');
  for (const [vp] of Object.entries<any>(meta.viewports ?? {})) {
    const dir = path.join(root, 'capture', vp);
    const o = JSON.parse(fs.readFileSync(path.join(dir, 'ocr.json'), 'utf8'));
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'palette.json'), 'utf8'));
    const b = JSON.parse(fs.readFileSync(path.join(dir, 'bands.json'), 'utf8'));
    L.push(`## ${vp}`, '', `\`capture/${vp}/component.png\` (2x). Background ${p.background}.`, '', '**Text (OCR, ink boxes in css px: x, y, w, h. Ink height is roughly cap height; font size is usually 1.3 to 1.5x it)**', '');
    for (const l of o) L.push(`- ${l.x}, ${l.y}, ${l.w} x ${l.h}  "${l.text}"${l.confidence < 0.5 ? ' (low confidence: read it off the image)' : ''}`);
    L.push('', '**Colors (share of the area)**', '', p.colors.map((c: any) => `\`${c.color}\` ${(c.share * 100).toFixed(1)}%`).join(', '), '', '**Row bands (content separated by background; the gaps between them are your paddings and gaps)**', '');
    let prev = 0;
    for (const r of b.rows) { L.push(`- y ${r.y} h ${r.h} (gap above ${+(r.y - prev).toFixed(1)})${r.cols.length > 1 ? `, columns: ${r.cols.map((c: any) => `${c.x}+${c.w}`).join(' ')}` : ''}`); prev = r.y + r.h; }
    L.push('');
  }
  L.push('## How to build from pixels', '');
  L.push('- Identify the font from the glyphs (ask the user when it is not obvious: the gate reads text boxes, so a wrong font shows up). Check your guess: render the OCR lines at a candidate size and compare widths with the ink boxes above.');
  L.push('- Sizes from the bands, colors from the palette (sample exact pixels from component.png with sharp or an eyedropper when a color is small), radii and shadows by eye, then tighten with the pixel diff.');
  L.push('- Hover, focus and motion are not in a screenshot. Build sensible defaults only if the user asks, and say they are not from the reference.', '');
  L.push('## The loop', '', '```bash');
  L.push(`clonethis shot http://localhost:3777/<page> ${rel}/build/1440.png --ref ${rel} --w 1440`);
  L.push(`clonethis diff ${rel}/build/1440.png ${rel}/capture/desktop/component.png ${rel}/build/diff-1440.png   # Read the sheet: build | reference | mask`);
  L.push(`clonethis compare http://localhost:3777/<page> ${rel} --w 1440      # every OCR line present? where is it vs the ink box`);
  L.push(`clonethis verify http://localhost:3777/<page> ${rel}               # size + text present + pixels under 6%`);
  L.push('```', '');
  fs.writeFileSync(path.join(root, 'REBUILD.md'), L.join('\n'));
  return path.join(root, 'REBUILD.md');
}

export function runBrief(argv: string[]) {
  const a = new Args(argv);
  const root = a.positional[0];
  if (!root || !fs.existsSync(root)) usage('usage: clonethis brief <reference/name>');
  console.log('wrote', writeBrief(path.resolve(root)));
}
