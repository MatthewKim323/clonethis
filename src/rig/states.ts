/**
 * states: run the reference's states pass on your build and put the two side by side. Targets are paired by
 * kind + text (then by order); for each state (hover / press / focus / open) it prints what changed on the
 * target itself in the reference vs the build, and the pixel diff of the two state shots.
 *   clonethis states <url> <reference/name> [--select "[data-clone-root]"] [--out <ref>/build/states]
 *
 * frames: record your build the way the reference was recorded, cropped to your component.
 *   clonethis frames <url> <outDir> --scenario enter|load|hover|toggle|loop [--ref <reference/name>] [--target N] [--select ...]
 *   then `clonethis sheet` on both folders at the same step and compare.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Args, usage } from '../lib/args.ts';
import { launch, newCtx, load, reveal, closeCtx, viewportByWidth, sleep, log } from '../lib/browser.ts';
import { ct, markRoot, viewportRect, parkMouse, type Locator, type Rect } from '../lib/page.ts';
import { statesPass } from '../lib/states.ts';
import { Screencast, contactSheet } from '../lib/screencast.ts';
import { loadRef, pixelDiff } from './verify.ts';

const locOf = (a: Args): Locator => ({ selector: a.str('select', '[data-clone-root]'), nth: a.num('nth', 0) });

/** Pair each reference target with a build target: same kind + text first, then same kind in order. */
function pairTargets(refT: any[], buildT: any[]) {
  const used = new Set<number>();
  return refT.map((r) => {
    let i = buildT.findIndex((b, k) => !used.has(k) && b.kind === r.kind && (b.text ?? '') === (r.text ?? ''));
    if (i < 0) i = buildT.findIndex((b, k) => !used.has(k) && b.kind === r.kind);
    if (i < 0) return { ref: r, build: null };
    used.add(i);
    return { ref: r, build: buildT[i] };
  });
}

export async function runStates(argv: string[]) {
  const a = new Args(argv);
  const [url, refDir] = a.positional;
  if (!url || !refDir) usage('usage: clonethis states <url> <reference/name> [--select css] [--out dir]');
  const sfile = path.join(refDir, 'capture', 'states', 'states.json');
  if (!fs.existsSync(sfile)) usage(`no ${sfile}: the reference has no states`);
  const refStates = JSON.parse(fs.readFileSync(sfile, 'utf8'));
  const vp = refStates.viewport;
  const ref = loadRef(refDir).find((r) => r.vp.width === vp.width);
  const out = a.str('out', path.join(refDir, 'build', 'states'));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch(true);
  try {
    const ctx = await newCtx(browser, vp, 2);
    const page = await ctx.newPage();
    await load(page, url, 1500);
    await reveal(page);
    if (!(await markRoot(page, locOf(a)))) usage('component not found. Mark its root with data-clone-root or pass --select.');
    if (ref) await ct(page, 'pin', '$root', ref.root.w, ref.heightFromContext ? ref.root.h : null);
    await page.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
    await page.waitForTimeout(900);
    await ct(page, 'tag', '$root');
    await ct(page, 'hideOverlays', '$root');
    const buildTargets = await ct<any[]>(page, 'interactive', '$root', 16);
    const pairs = pairTargets(refStates.targets, buildTargets);
    const mine = { targets: [] as any[] };
    await statesPass(page, vp, out, mine, { targets: pairs.map((p) => p.build).filter(Boolean), quiet: true });
    await closeCtx(ctx);
    const byCid = new Map(mine.targets.map((t: any) => [t.cid, t]));
    console.log(`states at ${vp.width}px: ${pairs.filter((p) => p.build).length}/${pairs.length} reference targets found in the build`);
    for (const p of pairs) {
      const r = p.ref;
      console.log(`\n${r.index}. ${r.kind} ${r.text ? JSON.stringify(r.text) : `<${r.tag}>`}${p.build ? '' : '   NOT FOUND in build'}`);
      if (!p.build) continue;
      const b = byCid.get(p.build.cid);
      for (const k of ['hover', 'press', 'focus', 'open']) {
        const rs = r[k], bs = b?.[k];
        if (!rs && !bs) continue;
        const own = (s: any, cid: string) => (s?.changes ?? []).filter((c: any) => c.cid === cid && c.prop !== '__rect').map((c: any) => `${c.prop}: ${String(c.to).slice(0, 60)}`);
        const ro = own(rs, r.cid), bo = own(bs, p.build.cid);
        let px = '';
        if (rs && bs) {
          const rp = path.join(refDir, rs.shot), bp = path.join(out, path.basename(bs.shot));
          if (fs.existsSync(rp) && fs.existsSync(bp)) { const d = await pixelDiff(bp, rp, path.join(out, 'diff', `${r.index}-${k}.png`)); px = `  pixels ${(d.differ * 100).toFixed(2)}%`; }
        }
        console.log(`  ${k.padEnd(5)} ref ${rs ? rs.changes.length : '-'} changes / build ${bs ? bs.changes.length : '-'}${px}`);
        const miss = ro.filter((x: string) => !bo.includes(x)), more = bo.filter((x: string) => !ro.includes(x));
        for (const x of miss.slice(0, 8)) console.log(`     ref only   ${x}`);
        for (const x of more.slice(0, 8)) console.log(`     build only ${x}`);
        const rt = rs?.transitions?.[r.cid], bt = bs?.transitions?.[p.build.cid];
        if (rt !== bt && (rt || bt)) console.log(`     transition ref "${rt ?? 'none'}" / build "${bt ?? 'none'}"`);
      }
    }
    fs.writeFileSync(path.join(out, 'states.json'), JSON.stringify({ pairs: pairs.map((p) => ({ ref: p.ref.cid, build: p.build?.cid ?? null })), build: mine }, null, 1));
    console.log(`\nshots + diffs -> ${out}`);
  } finally { await browser.close(); }
}

export async function runFrames(argv: string[]) {
  const a = new Args(argv);
  const [url, outDir] = a.positional;
  const scenario = a.str('scenario', 'enter');
  if (!url || !outDir) usage('usage: clonethis frames <url> <outDir> --scenario enter|load|hover|toggle|loop [--ref reference/name] [--target N] [--w 1440] [--select css]');
  const vp = viewportByWidth(a.num('w', 1440));
  const loc = locOf(a);
  const refDir = a.str('ref');
  const ref = refDir ? loadRef(refDir).find((r) => r.vp.width === vp.width) : undefined;
  const pad = 24;
  const cropOf = (r: Rect | null) => (r ? { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad } : null);
  const browser = await launch(true);
  try {
    const ctx = await newCtx(browser, vp, 1);
    const page = await ctx.newPage();
    const pin = async () => { if (ref) await ct(page, 'pin', '$root', ref.root.w, ref.heightFromContext ? ref.root.h : null); };
    let res: any;
    if (scenario === 'load') {
      const sc = new Screencast(outDir);
      await sc.start(page, vp);
      page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(a.num('ms', 5500));
      const r = (await markRoot(page, loc)) ? await viewportRect(page) : null;
      res = await sc.finish({ crop: cropOf(r), vp, extra: { description: 'build: fresh page, recording from before navigation' } });
    } else if (scenario === 'enter') {
      await load(page, url, 1500);
      const r = await markRoot(page, loc);
      if (!r) usage('component not found');
      await pin();
      const endY = Math.max(0, r.y + r.h / 2 - vp.height / 2);
      const startY = Math.max(0, r.y - vp.height - 40);
      await page.evaluate((y) => window.scrollTo(0, y), startY);
      await page.waitForTimeout(500);
      const sc = new Screencast(outDir);
      await sc.start(page, vp);
      await page.waitForTimeout(250);
      await page.evaluate(({ from, to, dur }) => new Promise<void>((res) => {
        const t0 = performance.now();
        const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
        const step = () => { const p = Math.min(1, (performance.now() - t0) / dur); window.scrollTo(0, from + (to - from) * ease(p)); if (p < 1) requestAnimationFrame(step); else res(); };
        requestAnimationFrame(step);
      }), { from: startY, to: endY, dur: 1500 });
      await page.waitForTimeout(2500);
      res = await sc.finish({ crop: cropOf(await viewportRect(page)), vp, extra: { description: 'build: scrolled in from below the fold like the reference' } });
    } else {
      await load(page, url, 1500);
      await reveal(page);
      if (!(await markRoot(page, loc))) usage('component not found');
      await pin();
      await ct(page, 'tag', '$root');
      await page.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
      await parkMouse(page);
      await page.waitForTimeout(900);
      const vr = await viewportRect(page);
      const sc = new Screencast(outDir);
      if (scenario === 'loop') {
        await sc.start(page, vp);
        await page.waitForTimeout(4000);
        if (vr) await page.mouse.move(vr.x + vr.w / 2, vr.y + vr.h / 2, { steps: 10 });
        await page.waitForTimeout(2000);
        res = await sc.finish({ crop: cropOf(vr), vp });
      } else {
        const targets = await ct<any[]>(page, 'interactive', '$root', 16);
        let t = targets[a.num('target', 0)];
        if (refDir && a.str('target') !== undefined) {
          const rs = JSON.parse(fs.readFileSync(path.join(refDir, 'capture', 'states', 'states.json'), 'utf8'));
          const want = rs.targets.find((x: any) => x.index === a.num('target', 0));
          if (want) t = pairTargets([want], targets)[0].build ?? t;
        }
        if (!t) usage('no interactive target in the component');
        const c = await page.evaluate((cid) => { const e = document.querySelector(`[data-ct-id="${cid}"]`)!; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, t.cid);
        await sc.start(page, vp);
        await page.waitForTimeout(300);
        await page.mouse.move(c.x, c.y, { steps: 10 });
        await page.waitForTimeout(1400);
        if (scenario === 'toggle') { await page.mouse.click(c.x, c.y); await page.waitForTimeout(1800); await page.mouse.click(c.x, c.y); await page.waitForTimeout(1800); }
        await parkMouse(page);
        await page.waitForTimeout(1200);
        const after = await viewportRect(page);
        const box = vr && after ? { x: Math.min(vr.x, after.x), y: Math.min(vr.y, after.y), w: Math.max(vr.x + vr.w, after.x + after.w) - Math.min(vr.x, after.x), h: Math.max(vr.y + vr.h, after.y + after.h) - Math.min(vr.y, after.y) } : vr;
        res = await sc.finish({ crop: cropOf(box), vp, extra: { target: t.cid, kind: t.kind } });
      }
    }
    await closeCtx(ctx);
    log(`${outDir}: ${res.frameCount} frames, motion ${res.firstMotionMs ?? '-'} -> ${res.lastMotionMs ?? '-'}ms`);
  } finally { await browser.close(); }
}

export async function runSheet(argv: string[]) {
  const a = new Args(argv);
  const [dir, out] = a.positional;
  if (!dir || !out) usage('usage: clonethis sheet <framesDir> <out.png> [--step 200] [--count 12] [--width 220] [--from 0]');
  const n = await contactSheet(dir, out, { step: a.num('step', 200), count: a.num('count', 12), width: a.num('width', 220), from: a.num('from', 0) });
  log(`sheet ${out}: ${n} frames`);
}
