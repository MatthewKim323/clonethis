/**
 * verify: the component gate. Measures the build's component against the reference at every captured width.
 *   clonethis verify <buildUrl> <reference/name> [--select "[data-clone-root]"] [--nth 0] [--w 1440,390]
 *                    [--tol 0.5] [--text-tol 1] [--max-diff 3] [--no-pin] [--no-pixels] [--no-blackout] [--project .]
 *
 * The build marks its component root with `data-clone-root` (or pass --select). Per width:
 *   1. root   width is pinned to the reference width (the component's context decides it, not the component),
 *             height pinned too when the reference height came from its context; then height must match (--tol px)
 *   2. text   every painted text run of the reference (text + glyph box relative to the root) has a run with the
 *             same text in the build within --text-tol px on x, y, w, h and the same line count. That checks font,
 *             size, weight, line-height, letter-spacing, wrapping and position in one go, wrapper-agnostic
 *   3. media  img / svg / video / canvas / iframe boxes, in order per kind, within --text-tol px
 *   4. pixels the build's component shot vs capture/<vp>/component.png, % of pixels off by more than 32/255 on any
 *             channel, video / canvas / iframe masked; gates at --max-diff % (default 3)
 *   5. console zero errors while loading and scrolling the build
 *   6. origin blackout over the project (`clonethis blackout`)
 * Writes <ref>/build/verify.json. Exit 1 on FAIL. This is what the /goal condition points at.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Browser } from 'playwright';
import { Args, usage } from '../lib/args.ts';
import { launch, newCtx, load, reveal, closeCtx, viewportByWidth, VIEWPORTS, log, type Viewport } from '../lib/browser.ts';
import { ct, markRoot, rootRect, type Locator } from '../lib/page.ts';
import { shootRoot, settleMedia } from '../lib/shoot.ts';
import { serveDir } from '../lib/serve.ts';

export type RefVp = { vp: Viewport; texts: any[]; media: any[]; root: { w: number; h: number }; heightFromContext: boolean; shot: string };

export function loadRef(ref: string): RefVp[] {
  const out: RefVp[] = [];
  for (const v of fs.existsSync(path.join(ref, 'capture')) ? fs.readdirSync(path.join(ref, 'capture')) : []) {
    const dir = path.join(ref, 'capture', v);
    if (!fs.existsSync(path.join(dir, 'texts.json'))) continue;
    const ctx = JSON.parse(fs.readFileSync(path.join(dir, 'context.json'), 'utf8'));
    const vp = VIEWPORTS.find((x) => x.name === v) ?? viewportByWidth(ctx.viewport?.width ?? 1440);
    out.push({ vp, texts: JSON.parse(fs.readFileSync(path.join(dir, 'texts.json'), 'utf8')), media: JSON.parse(fs.readFileSync(path.join(dir, 'media.json'), 'utf8')), root: { w: ctx.rootRect.w, h: ctx.rootRect.h }, heightFromContext: !!ctx.heightFromContext?.fromContext, shot: path.join(dir, 'component.png') });
  }
  return out.sort((a, b) => b.vp.width - a.vp.width);
}

export type Measured = { found: boolean; unpinned?: { w: number; h: number }; root?: { w: number; h: number }; texts: any[]; media: any[]; errors: string[]; shot?: string };

/** Load a build url at a width, find its component, pin it like the reference, measure texts / media / shot. */
export async function measure(browser: Browser, url: string, loc: Locator, ref: RefVp, opts: { pin?: boolean; shot?: string; wait?: number }): Promise<Measured> {
  const ctx = await newCtx(browser, ref.vp, 2);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
    await load(page, url, opts.wait ?? 1500);
    await reveal(page);
    if (!(await markRoot(page, loc))) return { found: false, texts: [], media: [], errors };
    await page.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
    await page.waitForTimeout(500);
    await settleMedia(page);
    const u = (await rootRect(page))!;
    if (opts.pin !== false) {
      await ct(page, 'pin', '$root', ref.root.w, ref.heightFromContext ? ref.root.h : null);
      await page.waitForTimeout(150);
    }
    const r = (await rootRect(page))!;
    const texts = await ct<any[]>(page, 'texts', '$root');
    const media = await ct<any[]>(page, 'media', '$root');
    if (opts.shot) { fs.mkdirSync(path.dirname(opts.shot), { recursive: true }); await shootRoot(page, opts.shot, { vp: ref.vp, dsf: 2, settleMs: 400 }); }
    return { found: true, unpinned: { w: +u.w.toFixed(2), h: +u.h.toFixed(2) }, root: { w: +r.w.toFixed(2), h: +r.h.toFixed(2) }, texts, media, errors: [...new Set(errors)], shot: opts.shot };
  } finally { await closeCtx(ctx); }
}

export type TextRow = { text: string; ref: any; build: any | null; dx?: number; dy?: number; dw?: number; dh?: number; lines?: string; ok: boolean };

/** Pair reference text runs with build runs of the same text (nearest first), in document order. */
export function matchTexts(refT: any[], buildT: any[], tol: number): { rows: TextRow[]; extra: any[] } {
  const used = new Set<number>();
  const rows: TextRow[] = [];
  for (const r of refT) {
    let best = -1, bestD = Infinity;
    buildT.forEach((b, i) => { if (used.has(i) || b.text !== r.text) return; const d = Math.abs(b.x - r.x) + Math.abs(b.y - r.y); if (d < bestD) { bestD = d; best = i; } });
    if (best < 0) { rows.push({ text: r.text, ref: r, build: null, ok: false }); continue; }
    used.add(best);
    const b = buildT[best];
    const dx = +(b.x - r.x).toFixed(2), dy = +(b.y - r.y).toFixed(2), dw = +(b.w - r.w).toFixed(2), dh = +(b.h - r.h).toFixed(2);
    const ok = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh)) <= tol && b.lines === r.lines;
    rows.push({ text: r.text, ref: r, build: b, dx, dy, dw, dh, lines: b.lines === r.lines ? '' : `${r.lines}->${b.lines}`, ok });
  }
  return { rows, extra: buildT.filter((_b, i) => !used.has(i)) };
}

export function matchMedia(refM: any[], buildM: any[], tol: number) {
  const kinds = [...new Set([...refM, ...buildM].map((m) => m.kind))];
  const rows: { kind: string; i: number; ref: any; build: any; ok: boolean; d?: string }[] = [];
  for (const k of kinds) {
    const R = refM.filter((m) => m.kind === k), B = buildM.filter((m) => m.kind === k);
    for (let i = 0; i < Math.max(R.length, B.length); i++) {
      const r = R[i], b = B[i];
      if (!r || !b) { rows.push({ kind: k, i, ref: r ?? null, build: b ?? null, ok: false }); continue; }
      const d = [b.x - r.x, b.y - r.y, b.w - r.w, b.h - r.h].map((x) => +x.toFixed(2));
      rows.push({ kind: k, i, ref: r, build: b, ok: d.every((x) => Math.abs(x) <= tol), d: d.join(',') });
    }
  }
  return rows;
}

/** % of pixels off by more than `th` on any channel, masked rects (css px) ignored. Writes a build | ref | mask sheet. */
export async function pixelDiff(buildPng: string, refPng: string, out: string | null, mask: { x: number; y: number; w: number; h: number }[] = [], dsf = 2, th = 32) {
  const [bm, rm] = await Promise.all([sharp(buildPng).metadata(), sharp(refPng).metadata()]);
  const W = Math.min(bm.width!, rm.width!), H = Math.min(bm.height!, rm.height!);
  const sizeDelta = Math.max(Math.abs(bm.width! - rm.width!), Math.abs(bm.height! - rm.height!));
  const flat = (f: string) => sharp(f).extract({ left: 0, top: 0, width: W, height: H }).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer();
  const [b, r] = await Promise.all([flat(buildPng), flat(refPng)]);
  const m = Buffer.alloc(W * H);
  const masked = (x: number, y: number) => mask.some((k) => x >= k.x * dsf && x < (k.x + k.w) * dsf && y >= k.y * dsf && y < (k.y + k.h) * dsf);
  let n = 0, counted = 0;
  for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p++) {
    if (mask.length && masked(x, y)) continue;
    counted++;
    const i = p * 3;
    if (Math.max(Math.abs(b[i] - r[i]), Math.abs(b[i + 1] - r[i + 1]), Math.abs(b[i + 2] - r[i + 2])) > th) { m[p] = 255; n++; }
  }
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const gap = 16;
    await sharp({ create: { width: W * 3 + gap * 2, height: H, channels: 3, background: '#ff00ff' } })
      .composite([
        { input: await sharp(buildPng).extract({ left: 0, top: 0, width: W, height: H }).png().toBuffer(), left: 0, top: 0 },
        { input: await sharp(refPng).extract({ left: 0, top: 0, width: W, height: H }).png().toBuffer(), left: W + gap, top: 0 },
        { input: await sharp(m, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer(), left: 2 * (W + gap), top: 0 },
      ]).png().toFile(out);
  }
  return { differ: counted ? n / counted : 0, sizeDelta, w: W, h: H };
}

type VpResult = { width: number; pass: boolean; root: any; texts: { total: number; ok: number; missing: number; off: number; extra: number; worst: TextRow[] }; media: { total: number; ok: number }; pixels: any; console: string[]; notes: string[] };

export async function verifyCore(url: string, ref: string, opts: { loc: Locator; widths?: number[]; tol: number; textTol: number; maxDiff: number | null; pin: boolean; pixels: boolean; out: string; quiet?: boolean }) {
  const refs = loadRef(ref).filter((r) => !opts.widths?.length || opts.widths.includes(r.vp.width));
  if (!refs.length) usage(`no captured widths in ${ref}/capture. Run clonethis grab first.`);
  fs.mkdirSync(opts.out, { recursive: true });
  const browser = await launch(true);
  const result: { url: string; at: string; viewports: Record<string, VpResult>; pass: boolean } = { url: url.startsWith('http://localhost') || url.startsWith('http://127.') ? url : '(reference)', at: new Date().toISOString(), viewports: {}, pass: true };
  const say = (s: string) => { if (!opts.quiet) console.log(s); };
  try {
    for (const r of refs) {
      const shot = opts.pixels ? path.join(opts.out, `${r.vp.name}.png`) : undefined;
      const m = await measure(browser, url, opts.loc, r, { pin: opts.pin, shot });
      const notes: string[] = [];
      if (!m.found) {
        result.viewports[r.vp.name] = { width: r.vp.width, pass: false, root: null, texts: { total: r.texts.length, ok: 0, missing: r.texts.length, off: 0, extra: 0, worst: [] }, media: { total: r.media.length, ok: 0 }, pixels: null, console: m.errors, notes: ['component root not found: mark it with data-clone-root or pass --select'] };
        result.pass = false;
        say(`\n== ${r.vp.name} ${r.vp.width}px  FAIL  root not found (${opts.loc.selector})`);
        continue;
      }
      const hOk = Math.abs(m.root!.h - r.root.h) <= opts.tol;
      const wOk = Math.abs(m.root!.w - r.root.w) <= opts.tol;
      const { rows, extra } = matchTexts(r.texts, m.texts, opts.textTol);
      const media = matchMedia(r.media, m.media, opts.textTol);
      let pixels: any = null;
      if (shot && fs.existsSync(r.shot)) {
        const mask = r.media.filter((x) => ['video', 'canvas', 'iframe'].includes(x.kind));
        pixels = await pixelDiff(shot, r.shot, path.join(opts.out, 'diff', `${r.vp.name}.png`), mask);
        if (pixels.sizeDelta > 2) notes.push(`shot size differs by ${pixels.sizeDelta}px (2x): compared the overlapping area`);
      }
      const pxOk = !pixels || opts.maxDiff === null || pixels.differ * 100 <= opts.maxDiff;
      const txOk = rows.every((x) => x.ok);
      const mdOk = media.every((x) => x.ok);
      const pass = hOk && wOk && txOk && mdOk && pxOk && m.errors.length === 0;
      if (!opts.pin && !wOk) notes.push('unpinned: the build places the component at a different width; the reference width is its context, not the component');
      const off = rows.filter((x) => x.build && !x.ok);
      const worst = [...rows.filter((x) => !x.build), ...off.sort((a, b) => Math.max(Math.abs(b.dx!), Math.abs(b.dy!), Math.abs(b.dw!), Math.abs(b.dh!)) - Math.max(Math.abs(a.dx!), Math.abs(a.dy!), Math.abs(a.dw!), Math.abs(a.dh!)))].slice(0, 12);
      result.viewports[r.vp.name] = { width: r.vp.width, pass, root: { ref: r.root, build: m.root, unpinned: m.unpinned, pinnedHeight: r.heightFromContext }, texts: { total: rows.length, ok: rows.filter((x) => x.ok).length, missing: rows.filter((x) => !x.build).length, off: off.length, extra: extra.length, worst }, media: { total: media.length, ok: media.filter((x) => x.ok).length }, pixels: pixels ? { differPct: +(pixels.differ * 100).toFixed(2), sheet: path.join(opts.out, 'diff', `${r.vp.name}.png`) } : null, console: m.errors, notes };
      result.pass &&= pass;
      say(`\n== ${r.vp.name} ${r.vp.width}px  ${pass ? 'PASS' : 'FAIL'}`);
      say(`root    ref ${r.root.w}x${r.root.h}  build ${m.root!.w}x${m.root!.h}${opts.pin ? ` (pinned w${r.heightFromContext ? '+h' : ''}; unpinned ${m.unpinned!.w}x${m.unpinned!.h})` : ''}  ${hOk && wOk ? 'ok' : `DELTA h ${(m.root!.h - r.root.h).toFixed(2)} w ${(m.root!.w - r.root.w).toFixed(2)}`}`);
      say(`text    ${rows.filter((x) => x.ok).length}/${rows.length} runs within ${opts.textTol}px${rows.some((x) => !x.build) ? `, ${rows.filter((x) => !x.build).length} missing` : ''}${extra.length ? `, ${extra.length} extra in build` : ''}`);
      for (const w of worst) say(w.build ? `   ~ ${JSON.stringify(w.text.slice(0, 40)).padEnd(44)} dx ${w.dx} dy ${w.dy} dw ${w.dw} dh ${w.dh}${w.lines ? ` lines ${w.lines}` : ''}  (ref ${w.ref.font} / build ${w.build.font})` : `   - ${JSON.stringify(w.text.slice(0, 40)).padEnd(44)} missing (ref at ${w.ref.x},${w.ref.y})`);
      for (const e of extra.slice(0, 4)) say(`   + ${JSON.stringify(e.text.slice(0, 40)).padEnd(44)} only in build (at ${e.x},${e.y})`);
      say(`media   ${media.filter((x) => x.ok).length}/${media.length}${media.filter((x) => !x.ok).map((x) => `  ${x.kind}#${x.i} ${x.ref && x.build ? `d(x,y,w,h)=${x.d}` : x.ref ? 'missing' : 'extra'}`).join('')}`);
      if (pixels) say(`pixels  ${(pixels.differ * 100).toFixed(2)}% differ${opts.maxDiff !== null ? ` (gate ${opts.maxDiff}%)` : ''} -> ${path.relative(process.cwd(), path.join(opts.out, 'diff', `${r.vp.name}.png`))}`);
      if (m.errors.length) say(`console ${m.errors.length} error(s)\n   ${m.errors.slice(0, 4).join('\n   ')}`);
      for (const n of notes) say(`note    ${n}`);
    }
  } finally { await browser.close(); }
  return result;
}

export async function runVerify(argv: string[]) {
  const a = new Args(argv);
  const [url, ref] = a.positional;
  if (!url || !ref) usage('usage: clonethis verify <buildUrl> <reference/name> [--select "[data-clone-root]"] [--nth 0] [--w 1440,390] [--tol 0.5] [--text-tol 1] [--max-diff 3] [--no-pin] [--no-pixels] [--no-blackout] [--project .]');
  const loc: Locator = { selector: a.str('select', '[data-clone-root]'), nth: a.num('nth', 0) };
  const out = a.str('out', path.join(ref, 'build'));
  const maxDiff = a.str('max-diff') === 'off' ? null : a.num('max-diff', 3);
  const result: any = await verifyCore(url, ref, { loc, widths: a.list('w').map(Number), tol: a.num('tol', 0.5), textTol: a.num('text-tol', 1), maxDiff, pin: !a.flag('no-pin'), pixels: !a.flag('no-pixels'), out });
  if (!a.flag('no-blackout')) {
    console.log('\n== origin blackout');
    const { runBlackout } = await import('./blackout.ts');
    const clean = runBlackout([a.str('project', process.cwd()), '--ref', path.resolve(ref)]);
    result.blackout = clean;
    result.pass &&= clean;
    process.exitCode = undefined;
  }
  fs.writeFileSync(path.join(out, 'verify.json'), JSON.stringify(result, null, 1));
  console.log(`\n${result.pass ? 'PASS' : 'FAIL'} -> ${path.join(out, 'verify.json')}`);
  if (!result.pass) process.exitCode = 1;
}

/**
 * The snapshot must pass its own gate: if the static snapshot does not verify, the extraction missed
 * something (a rule behind a selector that needs page context, a script-driven layout, an asset that did
 * not download), and the brief says so before anyone builds from it.
 */
export async function selfCheck(ref: string) {
  const srv = serveDir(ref);
  try {
    log('== snapshot self-check');
    const out = path.join(ref, 'snapshot', 'check');
    const r = await verifyCore(`${srv.url}/snapshot/index.html`, ref, { loc: { selector: '[data-clone-root]' }, tol: 0.5, textTol: 1, maxDiff: 3, pin: true, pixels: true, out, quiet: true });
    for (const [vp, v] of Object.entries(r.viewports)) log(`  ${vp.padEnd(10)} ${v.pass ? 'PASS' : 'FAIL'}  h ${v.root?.build?.h ?? '-'}/${v.root?.ref?.h ?? '-'}  text ${v.texts.ok}/${v.texts.total}  media ${v.media.ok}/${v.media.total}  pixels ${v.pixels?.differPct ?? '-'}%`);
    fs.writeFileSync(path.join(ref, 'snapshot', 'check.json'), JSON.stringify(r, null, 1));
    return r;
  } finally { srv.stop(); }
}
