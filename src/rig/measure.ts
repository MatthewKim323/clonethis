/**
 * The build-side loop.
 *
 * shot: your component (or the reference page's, if you point it there) exactly as verify sees it.
 *   clonethis shot <url> <out.png> [--w 1440] [--ref <reference/name> (pin like the reference)] [--select "[data-clone-root]"] [--nth 0]
 *                  [--margin 0] [--hover <css inside the component>] [--click <css inside the component>] [--wait 1500]
 *
 * compare: every reference text run and media box next to yours at one width, with deltas. The fastest way
 * from "verify says FAIL" to "this element, this many pixels".
 *   clonethis compare <url> <reference/name> [--w 1440] [--select ...] [--all] [--no-pin]
 *
 * boxes / refboxes: element boxes relative to the component root, same columns on both sides.
 *   clonethis boxes <url> <width> [--ref <reference/name> to pin] [--select ...] [--filter text] [--depth N]
 *   clonethis refboxes <reference/name> <vp|width> [--filter text] [--depth N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { Args, usage } from '../lib/args.ts';
import { launch, newCtx, load, reveal, viewportByWidth, closeCtx, log, VIEWPORTS } from '../lib/browser.ts';
import { ct, markRoot, parkMouse, type Locator } from '../lib/page.ts';
import { shootRoot, settleMedia } from '../lib/shoot.ts';
import { loadRef, measure, matchTexts, matchMedia } from './verify.ts';
import { tokensFor, scrub } from '../lib/anon.ts';

const locOf = (a: Args): Locator => ({ selector: a.str('select', '[data-clone-root]'), nth: a.num('nth', 0) });

export async function runShot(argv: string[]) {
  const a = new Args(argv);
  const [url, out] = a.positional;
  if (!url || !out) usage('usage: clonethis shot <url> <out.png> [--w 1440] [--ref reference/name] [--select css] [--nth 0] [--margin 0] [--hover css] [--click css]');
  const W = a.num('w', 1440);
  const vp = viewportByWidth(W);
  const refDir = a.str('ref');
  const ref = refDir ? loadRef(refDir).find((r) => r.vp.width === W) : undefined;
  if (refDir && !ref) usage(`${refDir} has no capture at ${W}px`);
  const browser = await launch(true);
  try {
    const ctx = await newCtx(browser, vp, 2);
    const page = await ctx.newPage();
    await load(page, url, a.num('wait', 1500));
    await reveal(page);
    if (!(await markRoot(page, locOf(a)))) usage(`component not found (${locOf(a).selector}). Mark its root with data-clone-root or pass --select.`);
    await page.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
    await parkMouse(page);
    await page.waitForTimeout(400);
    await settleMedia(page);
    if (ref) await ct(page, 'pin', '$root', ref.root.w, ref.heightFromContext ? ref.root.h : null);
    for (const k of ['click', 'hover'] as const) {
      const sel = a.str(k);
      if (!sel) continue;
      const loc = page.locator('[data-ct-root]').locator(sel).first();
      if (k === 'click') await loc.click(); else await loc.hover();
      await page.waitForTimeout(a.num('statewait', 1200));
    }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    const r = await shootRoot(page, out, { vp, dsf: 2, margin: a.num('margin', 0), noScroll: !!(a.str('hover') || a.str('click')) });
    log(`saved ${out} (${r.w.toFixed(1)}x${r.h.toFixed(1)} css px${ref ? `, pinned to ${ref.root.w}` : ''})`);
  } finally { await browser.close(); }
}

export async function runCompare(argv: string[]) {
  const a = new Args(argv);
  const [url, refDir] = a.positional;
  if (!url || !refDir) usage('usage: clonethis compare <url> <reference/name> [--w 1440] [--select css] [--all] [--no-pin] [--tol 1]');
  const W = a.num('w', 1440);
  const ref = loadRef(refDir).find((r) => r.vp.width === W);
  if (!ref) usage(`${refDir} has no capture at ${W}px`);
  const { tokens, brand } = tokensFor(refDir);
  const clean = (t: string) => scrub(t, tokens, brand);
  const browser = await launch(true);
  try {
    const m = await measure(browser, url, locOf(a), ref, { pin: !a.flag('no-pin') });
    if (!m.found) usage('component not found. Mark its root with data-clone-root or pass --select.');
    const tol = a.num('tol', 1);
    console.log(`root   ref ${ref.root.w}x${ref.root.h}   build ${m.root!.w}x${m.root!.h}   (unpinned ${m.unpinned!.w}x${m.unpinned!.h})   dh ${(m.root!.h - ref.root.h).toFixed(2)}`);
    const { rows, extra } = matchTexts(ref.texts, m.texts, tol);
    console.log(`\ntext runs (reference order): ${rows.filter((r) => r.ok).length}/${rows.length} within ${tol}px`);
    console.log('   ok    ref y     x       w      h  | build y     x       w      h  |   dx    dy    dw    dh  text / font');
    for (const r of rows) {
      if (r.ok && !a.flag('all')) continue;
      const f = (v: number | undefined) => (v === undefined ? '     -' : v.toFixed(1).padStart(6));
      const b = r.build;
      console.log(`   ${r.ok ? ' ok ' : r.build ? ' ~~ ' : ' -- '} ${f(r.ref.y)} ${f(r.ref.x)} ${f(r.ref.w)} ${f(r.ref.h)} | ${f(b?.y)} ${f(b?.x)} ${f(b?.w)} ${f(b?.h)} | ${f(r.dx)}${f(r.dy)}${f(r.dw)}${f(r.dh)}  ${JSON.stringify(clean(r.text).slice(0, 36))}${r.lines ? ` lines ${r.lines}` : ''}${r.note ? ` (${r.note})` : ''}  ${b && b.font !== r.ref.font ? `font ${r.ref.font} -> ${b.font}` : ''}${b && b.color !== r.ref.color ? ` color ${r.ref.color} -> ${b.color}` : ''}`);
    }
    for (const e of extra) console.log(`   +    only in build: ${JSON.stringify(e.text.slice(0, 40))} at ${e.x},${e.y} ${e.w}x${e.h}`);
    const media = matchMedia(ref.media, m.media, tol);
    if (media.length) {
      console.log(`\nmedia: ${media.filter((x) => x.ok).length}/${media.length}`);
      for (const x of media) console.log(`   ${x.ok ? ' ok ' : ' ~~ '} ${x.kind}#${x.i}  ref ${x.ref ? `${x.ref.x},${x.ref.y} ${x.ref.w}x${x.ref.h}` : '-'}  build ${x.build ? `${x.build.x},${x.build.y} ${x.build.w}x${x.build.h}` : '-'}${x.d ? `  d ${x.d}` : ''}`);
    }
    if (m.errors.length) console.log(`\nconsole errors:\n   ${m.errors.join('\n   ')}`);
  } finally { await browser.close(); }
}

const row = (e: any, clean = (t: string) => t) => {
  const r = e.rect, st = e.style ?? {};
  const label = clean((e.name || (e.classes ?? '').split(' ').filter((c: string) => c && !/^framer-v-|^framer-[a-z0-9]{5,}$|^css-|^sc-/.test(c)).slice(0, 2).join('.') || '').slice(0, 22));
  return `${r.y.toFixed(1).padStart(7)} ${r.x.toFixed(1).padStart(7)} ${r.w.toFixed(1).padStart(7)} ${r.h.toFixed(1).padStart(7)}  ${' '.repeat(Math.min(e.depth ?? 0, 8))}${(e.tag ?? '').padEnd(8)} ${label.padEnd(22)} ${JSON.stringify(clean(e.text ?? '').slice(0, 22)).padEnd(24)} pad=${st.paddingTop}/${st.paddingRight}/${st.paddingBottom}/${st.paddingLeft} gap=${st.gap} ${st.display}${st.display?.includes('flex') ? ':' + st.flexDirection : ''} ${st.fontSize}/${st.lineHeight}`;
};
const HEAD = '      y       x       w       h  tag      name / class           text                     box model';
const keep = (a: Args) => (e: any) => e.visible !== false && !['path', 'g', 'use', 'rect', 'circle', 'line', 'polygon', 'defs', 'stop', 'lineargradient', 'clippath'].includes(e.tag) && (!a.str('filter') || `${e.name ?? ''} ${e.classes ?? ''} ${e.text ?? ''}`.includes(a.str('filter')!)) && (e.depth ?? 0) <= a.num('depth', 99);

export async function runBoxes(argv: string[]) {
  const a = new Args(argv);
  const [url, wArg] = a.positional;
  if (!url) usage('usage: clonethis boxes <url> <width> [--ref reference/name] [--select css] [--filter text] [--depth N]');
  const W = +(wArg ?? 1440);
  const ref = a.str('ref') ? loadRef(a.str('ref')!).find((r) => r.vp.width === W) : undefined;
  const browser = await launch(true);
  try {
    const ctx = await newCtx(browser, viewportByWidth(W), 1);
    const page = await ctx.newPage();
    await load(page, url, a.num('wait', 1500));
    await reveal(page);
    if (!(await markRoot(page, locOf(a)))) usage('component not found. Mark its root with data-clone-root or pass --select.');
    if (ref) await ct(page, 'pin', '$root', ref.root.w, ref.heightFromContext ? ref.root.h : null);
    await ct(page, 'tag', '$root');
    const L = await ct<any[]>(page, 'layout', '$root');
    console.log(HEAD);
    for (const e of L.filter(keep(a))) console.log(row(e));
    await closeCtx(ctx);
  } finally { await browser.close(); }
}

export function runRefboxes(argv: string[]) {
  const a = new Args(argv);
  const [root, vpArg] = a.positional;
  if (!root || !vpArg) usage('usage: clonethis refboxes <reference/name> <vp|width> [--filter text] [--depth N]');
  const vp = /^\d+$/.test(vpArg) ? (VIEWPORTS.find((v) => v.width === +vpArg)?.name ?? `w${vpArg}`) : vpArg;
  const file = path.join(root, 'capture', vp, 'layout.json');
  if (!fs.existsSync(file)) usage(`no ${file}`);
  const { tokens, brand } = tokensFor(root);
  const clean = (t: string) => scrub(t, tokens, brand);
  const L = JSON.parse(fs.readFileSync(file, 'utf8')) as any[];
  console.log(HEAD);
  for (const e of L.filter(keep(a))) console.log(row(e, clean));
}
