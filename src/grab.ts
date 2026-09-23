/**
 * grab: one component off a live page into reference/<name>/, measured the same way at every width.
 *
 *   clonethis grab <url> (--select <css> [--nth N] | --name <framer name> | --text "<visible text>" [--up N]) [--as pricing]
 *                  [--brand Name] [--tokens a,b] [--viewports 1440,1024,810,390] [--headless] [--no-frames] [--no-states] [--max-states 8]
 *
 * Per width (1440 / 1024 / 810 / 390): component.png (2x, the root's border box and nothing else), context.png
 * (40px around it), layout.json (every element in the subtree, rect relative to the root + computed styles
 * + ::before/::after), texts.json (painted text runs), media.json, context.json (what it inherits, what it
 * sits on), interactive.json, animations.json, the subtree html.
 * Once: css/used.css (every rule in every stylesheet whose selector matches something in the subtree, all
 * breakpoints and states, cascade order), fonts + keyframes it uses, assets it paints with, states (hover /
 * press / focus / open diffs + shots), frames (enter or load, hovers, toggles, loops), Framer appear + module
 * rip when the page is Framer, and a standalone snapshot that renders the component on its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { request, type Browser, type Page } from 'playwright';
import { Args, usage } from './lib/args.ts';
import { VIEWPORTS, UA, newCtx, load, reveal, log, closeCtx, BrowserPool, guard, sleep, type Viewport } from './lib/browser.ts';
import { ct, markRoot, viewportRect, type Locator, type Rect } from './lib/page.ts';
import { shootRoot, settleMedia } from './lib/shoot.ts';
import { Screencast } from './lib/screencast.ts';
import { statesPass } from './lib/states.ts';
import { parseCss, splitSelectors, testable, stateOf, writeCss, animationNames, varRefs, fontFaceFamily, cssUrls, rewriteUrls, type Rule, type StyleRule } from './lib/css.ts';
import { originTokens, writeOrigin, readOrigin, brandFor, scrub, scrubSource, neutralAssetName, neutralComponentName, isReservedToken, type Origin } from './lib/anon.ts';

const DSF = 2;

export type VpData = {
  vp: Viewport; found: boolean; rect?: Rect; count?: number;
  layout?: any[]; texts?: any[]; media?: any[]; context?: any; hfc?: any; interactive?: any[]; animations?: any[];
  refs?: { urls: string[]; families: string[] }; symbols?: { id: string; html: string }[]; html?: string;
  keys?: { classes: string[]; ids: string[]; tags: string[]; attrs: string[] }; matches?: Record<number, string[]>;
  error?: string;
};

type Sheet = { href: string | null; base: string; text: string | null; media: string; index: number };

/** Resolve --select / --name / --text into a locator on a loaded page. --text picks the hit and climbs --up levels. */
async function initialLocator(page: Page, a: Args): Promise<Locator> {
  const sel = a.str('select');
  const name = a.str('name');
  const text = a.str('text');
  if (sel) return { selector: sel, nth: a.num('nth', 0), text: text || undefined };
  if (name) return { selector: `[data-framer-name="${name.replace(/"/g, '\\"')}"]`, nth: a.num('nth', 0), name };
  if (text) {
    const cands = await ct<any[]>(page, 'candidates', text, 20);
    if (!cands.length) usage(`no visible element contains "${text}". Try \`clonethis find <url> "<query>"\`.`);
    const hit = cands[Math.min(a.num('nth', 0), cands.length - 1)];
    const up = a.num('up', 0);
    const link = hit.chain[Math.min(up, hit.chain.length - 1)];
    return { selector: link.selector, nth: link.nth };
  }
  usage('say which component: --select "<css>" | --name "<framer layer name>" | --text "<visible text>" [--up N]. `clonethis find <url> <query>` or `clonethis pick <url>` help choose.');
}

export async function runGrab(argv: string[]) {
  const a = new Args(argv);
  const url = a.positional[0];
  if (!url) usage('usage: clonethis grab <url> --select <css> | --name <layer> | --text "<text>" [--up N] [--nth N] [--as name] [--brand Name] [--tokens a,b] [--headless] [--no-frames] [--no-states]');
  const t0 = Date.now();
  const outRoot = path.join(process.cwd(), a.str('out', 'reference'));
  const extra = a.list('tokens');
  const pre = originTokens(url, undefined, extra);
  const name = neutralComponentName(a.str('as'), pre);
  const REF = path.join(outRoot, name);
  const prior = readOrigin(REF);
  if (prior && prior.url !== url && !a.flag('force')) usage(`${path.relative(process.cwd(), REF)} already holds a component from another page. Pick another --as, or --force.`);
  fs.mkdirSync(REF, { recursive: true });
  const widths = a.list('viewports').map(Number);
  const vps: Viewport[] = widths.length ? widths.map((w) => VIEWPORTS.find((v) => v.width === w) ?? { name: `w${w}`, width: w, height: w < 600 ? 844 : 900 }) : [...VIEWPORTS];
  const headless = a.flag('headless');
  const errors: string[] = [];
  const pool = new BrowserPool(true);

  // ---------------------------------------------------------------- 1. resolve the target on a desktop load (headed so the user sees it)
  log(`grab -> ${path.relative(process.cwd(), REF)} (headed=${!headless})`);
  const first = await (await import('./lib/browser.ts')).launch(headless);
  const fctx = await newCtx(first, vps[0], 1);
  const fpage = await fctx.newPage();
  await load(fpage, url);
  const title = await fpage.title();
  await reveal(fpage);
  const loc0 = await initialLocator(fpage, a);
  const r0 = await markRoot(fpage, loc0);
  if (!r0) usage(`nothing visible matches ${JSON.stringify(loc0)} at ${vps[0].width}px. Try \`clonethis find\`.`);
  // a canonical selector for re-finding it at every width (kept in .origin.json: it can carry origin words)
  const canon = await fpage.evaluate(() => {
    const c = (window as any).__ct;
    const el = document.querySelector('[data-ct-root]')!;
    const s = c.selectorFor(el);
    const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined;
    // several visible matches: pin it by its text too, with nth counted among the ones that carry that text
    let nthText: number | undefined;
    if (s.count > 1 && text) { const l = (c.visibleMatches(s.selector) || []).filter((e: Element) => (e.textContent || '').replace(/\s+/g, ' ').includes(text)); nthText = l.indexOf(el); }
    return { ...s, nthText, tag: el.tagName.toLowerCase(), name: el.getAttribute('data-framer-name') || undefined, text };
  });
  const locator: Locator = a.str('select') ? { ...loc0, tag: canon.tag, name: canon.name } : { selector: canon.selector, nth: canon.nth, tag: canon.tag, name: canon.name };
  if (!a.str('select') && canon.count > 1 && canon.text && (canon.nthText ?? -1) >= 0) { locator.text = canon.text; locator.nth = canon.nthText; }

  const stack = await detectStack(fpage);
  const fullHtml = await fpage.content();
  const sheets = await collectSheets(fpage);
  await fpage.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
  await fpage.evaluate(() => { const e = document.querySelector('[data-ct-root]') as HTMLElement; e.style.outline = '3px solid #ff2d55'; e.style.outlineOffset = '2px'; });
  log(`  target: ${canon.tag}${canon.name ? ` [${scrub(canon.name, pre)}]` : ''} ${Math.round(r0.w)}x${Math.round(r0.h)} at y=${Math.round(r0.y)}`);
  if (!headless) await sleep(1200);
  await closeCtx(fctx);
  await first.close().catch(() => {});

  const brand = brandFor(process.cwd(), a.str('brand') ?? (prior?.brand && prior.brand !== 'brand' ? prior.brand : undefined));
  const tokens = originTokens(url, title, extra);
  const host = new URL(url).hostname;
  const origin: Origin = { url, host, title, tokens, brand, capturedAt: new Date().toISOString(), locator };
  writeOrigin(REF, origin);
  const risky = tokens.filter(isReservedToken);
  if (risky.length) log(`  blackout: ${risky.join(', ')} also read as web vocabulary, so only the capitalized spelling is scrubbed`);
  log(`  blackout: ${tokens.length} origin token(s) -> "${brand}"; origin kept only in ${name}/.origin.json`);
  const clean = (t: string) => scrubSource(t, tokens, brand, host);

  // parse every stylesheet once; keep style rule selector parts with their testable form
  const cssFetch = await request.newContext({ userAgent: UA, extraHTTPHeaders: { referer: url } });
  for (const s of sheets) {
    if (s.text !== null || !s.href) continue;
    try { const r = await cssFetch.get(s.href, { timeout: 20_000 }); if (r.ok()) s.text = await r.text(); } catch {}
  }
  const allRules: (Rule & { sheet: number; base: string })[] = [];
  for (const s of sheets) {
    if (!s.text) continue;
    const conds = s.media && s.media !== 'all' ? [`@media ${s.media}`] : [];
    for (const r of parseCss(s.text)) allRules.push({ ...r, conds: [...conds, ...r.conds], order: s.index * 1_000_000 + r.order, sheet: s.index, base: s.base });
  }
  const testables: string[] = [];
  const tIndex = new Map<string, number>();
  const partsOf = new Map<number, { part: string; t: number }[]>();
  allRules.forEach((r, i) => {
    if (r.kind !== 'style') return;
    const parts = splitSelectors(r.selector).map((part) => {
      const t = testable(part);
      if (!t) return { part, t: -1 };
      if (!tIndex.has(t)) { tIndex.set(t, testables.length); testables.push(t); }
      return { part, t: tIndex.get(t)! };
    });
    partsOf.set(i, parts);
  });
  log(`  ${sheets.length} stylesheet(s), ${allRules.length} rules, ${testables.length} distinct selectors`);

  // ---------------------------------------------------------------- 2. every width
  const data: Record<string, VpData> = {};
  for (const vp of vps) {
    const g = await guard(`viewport ${vp.name}`, a.num('viewport-timeout', 300) * 1000, async () => {
      data[vp.name] = await captureViewport(await pool.get(), url, locator, vp, REF, testables);
    });
    if (!g.ok) {
      errors.push(`[${vp.name}] ${g.reason}`);
      await pool.reset();
      const g2 = await guard(`viewport ${vp.name} (retry)`, a.num('viewport-timeout', 300) * 1000, async () => { data[vp.name] = await captureViewport(await pool.get(), url, locator, vp, REF, testables); });
      if (!g2.ok) { errors.push(`[${vp.name} retry] ${g2.reason}`); data[vp.name] = { vp, found: false, error: g2.reason }; }
    }
  }
  const found = Object.values(data).filter((d) => d.found);
  if (!found.length) { await pool.close(); usage('the component was not found at any width.'); }

  // ---------------------------------------------------------------- 3. css the component uses
  const matchedAt = new Map<number, Record<string, string[]>>();   // testable index -> vp -> cids
  for (const d of found) for (const [ti, cids] of Object.entries(d.matches ?? {})) {
    const m = matchedAt.get(+ti) ?? {};
    m[d.vp.name] = cids;
    matchedAt.set(+ti, m);
  }
  const kept: (StyleRule & { sheet: number; base: string; states: string[]; matches: Record<string, string[]> })[] = [];
  allRules.forEach((r, i) => {
    if (r.kind !== 'style') return;
    const parts = partsOf.get(i) ?? [];
    const hit = parts.filter((p) => p.t >= 0 && matchedAt.has(p.t));
    if (!hit.length) return;
    const matches: Record<string, string[]> = {};
    for (const p of hit) for (const [vpn, cids] of Object.entries(matchedAt.get(p.t)!)) matches[vpn] = [...new Set([...(matches[vpn] ?? []), ...cids])];
    kept.push({ ...(r as StyleRule & { sheet: number; base: string }), selector: hit.map((p) => p.part).join(', '), states: [...new Set(hit.flatMap((p) => stateOf(p.part)))], matches });
  });
  // what those rules pull in: keyframes, fonts, @property
  const families = new Set(found.flatMap((d) => d.refs?.families ?? []).map((f) => f.toLowerCase()));
  const animNames = new Set<string>([...kept.flatMap((r) => animationNames(r.body)), ...found.flatMap((d) => (d.layout ?? []).flatMap((e: any) => animationNames(`animation:${e.style?.animation ?? ''}`)))]);
  const usedVars = new Set(kept.flatMap((r) => varRefs(r.body)));
  const atoms = allRules.filter((r): r is Rule & { kind: 'atom'; sheet: number; base: string } => r.kind === 'atom');
  const keyframes = atoms.filter((r) => /keyframes$/.test(r.name) && animNames.has(r.prelude.replace(/["']/g, '')));
  const fontFaces = atoms.filter((r) => r.name === 'font-face' && families.has((fontFaceFamily(r.body) ?? '').toLowerCase()));
  const properties = atoms.filter((r) => r.name === 'property' && usedVars.has(r.prelude));
  // root variables in scope, per width, resolved on the component root
  const varNames = [...usedVars];
  log(`css: ${kept.length} rules used (${kept.filter((r) => r.states.some((s) => !s.startsWith('::'))).length} stateful, ${kept.filter((r) => r.conds.length).length} conditional), ${keyframes.length} keyframes, ${fontFaces.length} font faces, ${varNames.length} vars`);

  // ---------------------------------------------------------------- 4. states + frames (desktop), vars per width
  const desk = found.find((d) => d.vp.name === vps[0].name) ?? found[0];
  let states: any = null;
  if (!a.flag('no-states')) {
    const g = await guard('states', a.num('scenario-timeout', 240) * 1000, async () => { states = await captureStates(await pool.get(), url, locator, desk.vp, REF, a.num('max-states', 8)); });
    if (!g.ok) { errors.push(`[states] ${g.reason}`); await pool.reset(); }
  }
  let frames: Record<string, any> = {};
  if (!a.flag('no-frames')) {
    const g = await guard('frames', a.num('scenario-timeout', 240) * 1000 * 2, async () => { frames = await captureFrames(await pool.get(), url, locator, desk, REF, states, errors); });
    if (!g.ok) { errors.push(`[frames] ${g.reason}`); await pool.reset(); }
  }
  for (const d of found) {
    if (!varNames.length) break;
    const g = await guard(`vars ${d.vp.name}`, 120_000, async () => {
      const ctx = await newCtx(await pool.get(), d.vp, 1);
      try {
        const page = await ctx.newPage();
        await load(page, url);
        await reveal(page);
        if (await markRoot(page, locator)) d.context = { ...d.context, vars: (await ct<any>(page, 'context', '$root', varNames)).vars };
      } finally { await closeCtx(ctx); }
    });
    if (!g.ok) errors.push(`[vars ${d.vp.name}] ${g.reason}`);
  }
  await pool.close();

  // ---------------------------------------------------------------- 5. assets
  const want = new Set<string>();
  for (const d of found) for (const u of d.refs?.urls ?? []) want.add(u);
  for (const r of [...kept, ...fontFaces]) for (const u of cssUrls(r.body, r.base)) want.add(u);
  const assets = await downloadAssets([...want], REF, cssFetch, errors);
  await cssFetch.dispose();
  const local = (from: string) => (abs: string) => { const f = assets.get(abs); return f ? path.relative(from, path.join(REF, f)).split(path.sep).join('/') : null; };

  // ---------------------------------------------------------------- 6. write it all down
  const { writeReference } = await import('./assemble.ts');
  await writeReference({ REF, name, url, origin, stack, data, vps, found, kept, keyframes, fontFaces, properties, varNames, states, frames, assets, local, clean, fullHtml, errors });
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${path.relative(process.cwd(), REF)} (errors: ${errors.length})`);
  return { REF, name };
}

// ---------------------------------------------------------------- per width
async function captureViewport(browser: Browser, url: string, loc: Locator, vp: Viewport, REF: string, testables: string[]): Promise<VpData> {
  log(`== ${vp.name} ${vp.width}x${vp.height}`);
  const ctx = await newCtx(browser, vp, DSF);
  try {
    const page = await ctx.newPage();
    await load(page, url);
    await reveal(page);
    const rect = await markRoot(page, loc);
    if (!rect) { log(`  not visible at ${vp.width}px`); return { vp, found: false }; }
    await page.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
    await page.waitForTimeout(900);
    await settleMedia(page);
    const count = await ct<number>(page, 'tag', '$root');
    const dir = path.join(REF, 'capture', vp.name);
    fs.mkdirSync(dir, { recursive: true });
    const shot = await shootRoot(page, path.join(dir, 'component.png'), { vp, dsf: DSF, settleMs: 600 });
    await shootRoot(page, path.join(dir, 'context.png'), { vp, dsf: DSF, margin: 40, settleMs: 300 });
    await page.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
    await page.waitForTimeout(300);
    const [layout, texts, media, context, hfc, interactive, animations, refs, symbols, html] = await Promise.all([
      ct<any[]>(page, 'layout', '$root'), ct<any[]>(page, 'texts', '$root'), ct<any[]>(page, 'media', '$root'), ct<any>(page, 'context', '$root', []),
      ct<any>(page, 'heightFromContext', '$root'), ct<any[]>(page, 'interactive', '$root', 12), ct<any[]>(page, 'animations', '$root'), ct<any>(page, 'refs', '$root'),
      ct<any[]>(page, 'symbols', '$root'), ct<string>(page, 'html', '$root'),
    ]);
    const matches = await matchSelectors(page, testables);
    log(`  ${Math.round(shot.w)}x${Math.round(shot.h)}, ${count} elements, ${texts.length} text runs, ${Object.keys(matches).length} selectors match, height ${hfc.fromContext ? 'set by context' : 'own'}`);
    return { vp, found: true, rect, count, layout, texts, media, context, hfc, interactive, animations, refs, symbols, html, matches };
  } finally { await closeCtx(ctx); }
}

/**
 * Which selectors match the subtree. Prefilter on the rightmost compound (class / id / tag must exist in the
 * subtree), then test the survivors in the page: root.matches + root.querySelectorAll.
 */
async function matchSelectors(page: Page, testables: string[]): Promise<Record<number, string[]>> {
  const keys = await page.evaluate(() => {
    const root = document.querySelector('[data-ct-root]')!;
    const classes = new Set<string>(), ids = new Set<string>(), tags = new Set<string>();
    for (const e of [root, ...root.querySelectorAll('*')]) {
      tags.add(e.tagName.toLowerCase());
      if (e.id) ids.add(e.id);
      for (const c of (e.getAttribute('class') || '').split(/\s+/)) if (c) classes.add(c);
    }
    return { classes: [...classes], ids: [...ids], tags: [...tags] };
  });
  const C = new Set(keys.classes), I = new Set(keys.ids), T = new Set(keys.tags);
  const cand: number[] = [];
  testables.forEach((t, i) => {
    const last = lastCompound(t);
    const bare = last.replace(/:[\w-]+\((?:[^()]|\([^()]*\))*\)/g, '');
    const unesc = (s: string) => s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1');
    const cls = [...bare.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => unesc(m[1]));
    const id = [...bare.matchAll(/#((?:\\.|[\w-])+)/g)].map((m) => unesc(m[1]));
    const tag = bare.match(/^([a-zA-Z][\w-]*)/)?.[1]?.toLowerCase();
    if (cls.some((c) => !C.has(c))) return;
    if (id.some((x) => !I.has(x))) return;
    if (tag && !T.has(tag)) return;
    cand.push(i);
  });
  const out: Record<number, string[]> = {};
  const BATCH = 1500;
  for (let k = 0; k < cand.length; k += BATCH) {
    const chunk = cand.slice(k, k + BATCH).map((i) => [i, testables[i]] as [number, string]);
    const res = await page.evaluate((chunk) => {
      const root = document.querySelector('[data-ct-root]')!;
      const r: Record<number, string[]> = {};
      for (const [i, sel] of chunk) {
        try {
          const ids: string[] = [];
          if (root.matches(sel)) ids.push(root.getAttribute('data-ct-id')!);
          for (const e of root.querySelectorAll(sel)) ids.push(e.getAttribute('data-ct-id')!);
          if (ids.length) r[i] = ids;
        } catch {}
      }
      return r;
    }, chunk);
    Object.assign(out, res);
  }
  return out;
}

/** The rightmost compound selector of a complex selector (split on top-level combinators). */
function lastCompound(sel: string) {
  let depth = 0, q = '', lastSplit = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) lastSplit = i + 1;
  }
  return sel.slice(lastSplit).trim();
}

// ---------------------------------------------------------------- states
async function captureStates(browser: Browser, url: string, loc: Locator, vp: Viewport, REF: string, max: number) {
  log('== states (hover / press / focus / open)');
  const dir = path.join(REF, 'capture', 'states');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await newCtx(browser, vp, DSF);
  const out: any = { viewport: vp, targets: [] };
  try {
    const page = await ctx.newPage();
    await load(page, url);
    await reveal(page);
    if (!(await markRoot(page, loc))) throw new Error('component not found for states');
    await page.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
    await page.waitForTimeout(900);
    await ct(page, 'tag', '$root');
    await ct(page, 'hideOverlays', '$root');
    await statesPass(page, vp, dir, out, { max, shotPrefix: 'capture/states/' });
    fs.writeFileSync(path.join(dir, 'states.json'), JSON.stringify(out, null, 1));
  } finally { await closeCtx(ctx); }
  return out;
}

// ---------------------------------------------------------------- frames
async function captureFrames(browser: Browser, url: string, loc: Locator, desk: VpData, REF: string, states: any, errors: string[]) {
  const vp = desk.vp;
  const FR = path.join(REF, 'capture', 'frames');
  fs.rmSync(FR, { recursive: true, force: true });
  fs.mkdirSync(FR, { recursive: true });
  const report: Record<string, any> = {};
  const pad = 24;
  const cropOf = (r: Rect | null) => (r ? { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad } : null);
  const aboveFold = !!desk.context?.root?.inViewportAtLoad;
  log(`== frames (${aboveFold ? 'load' : 'enter'}, hovers, toggles, loops)`);

  // entrance: on-mount for a component above the fold, scroll-in for one below it
  {
    const ctx = await newCtx(browser, vp, 1);
    try {
      const page = await ctx.newPage();
      if (aboveFold) {
        const sc = new Screencast(path.join(FR, 'load'));
        await sc.start(page, vp);
        page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) => errors.push('load goto: ' + e.message));
        await sleep(5500);
        const r = (await markRoot(page, loc)) ? await viewportRect(page) : null;
        report.load = await sc.finish({ crop: cropOf(r), vp, extra: { description: 'fresh page, recording from before navigation, 5.5s, cropped to the component' } });
      } else {
        await load(page, url);
        const r = await markRoot(page, loc);
        if (r) {
          const endY = Math.max(0, r.y + r.h / 2 - vp.height / 2);
          const startY = Math.max(0, r.y - vp.height - 40);
          await page.evaluate((y) => window.scrollTo(0, y), startY);
          await page.waitForTimeout(500);
          const sc = new Screencast(path.join(FR, 'enter'));
          await sc.start(page, vp);
          await page.waitForTimeout(250);
          const scrollStart = sc.now();
          await page.evaluate(({ from, to, dur }) => new Promise<void>((res) => {
            const t0 = performance.now();
            const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
            const step = () => { const p = Math.min(1, (performance.now() - t0) / dur); window.scrollTo(0, from + (to - from) * ease(p)); if (p < 1) requestAnimationFrame(step); else res(); };
            requestAnimationFrame(step);
          }), { from: startY, to: endY, dur: 1500 });
          await page.waitForTimeout(2500);
          const vr = await viewportRect(page);
          report.enter = await sc.finish({ crop: cropOf(vr), vp, extra: { description: 'component scrolled from just below the fold to the viewport center over 1500ms (ease-in-out), then 2500ms hold; fresh page so entrance effects replay', scrollFrom: startY, scrollTo: endY, scrollStartMs: scrollStart } });
        }
      }
    } catch (e: any) { errors.push(`[frames entrance] ${e.message}`); } finally { await closeCtx(ctx); }
  }

  // hovers + toggles, one fresh page each so nothing carries over
  const targets = (states?.targets ?? []).filter((t: any) => t.hover && (t.hover.changes.length || t.open?.changes.length)).slice(0, 6);
  for (const t of targets) {
    const nameOf = `${t.click ? 'toggle' : 'hover'}-${String(t.index).padStart(2, '0')}-${t.kind}`;
    const ctx = await newCtx(browser, vp, 1);
    try {
      const page = await ctx.newPage();
      await load(page, url);
      await reveal(page);
      if (!(await markRoot(page, loc))) continue;
      await ct(page, 'tag', '$root');
      await page.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
      await page.mouse.move(2, 2);
      await page.waitForTimeout(900);
      const c = await page.evaluate((cid) => { const e = document.querySelector(`[data-ct-id="${cid}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, t.target ?? t.cid);
      if (!c) continue;
      const before = await viewportRect(page);
      const sc = new Screencast(path.join(FR, nameOf));
      await sc.start(page, vp);
      await page.waitForTimeout(300);
      const marks: Record<string, number> = {};
      marks.enter = sc.now();
      await page.mouse.move(c.x, c.y, { steps: 10 });
      await page.waitForTimeout(1400);
      if (t.click) {
        marks.open = sc.now(); await page.mouse.click(c.x, c.y); await page.waitForTimeout(1800);
        marks.close = sc.now(); await page.mouse.click(c.x, c.y); await page.waitForTimeout(1800);
      }
      marks.leave = sc.now();
      await page.mouse.move(2, 2, { steps: 10 });
      await page.waitForTimeout(1200);
      const after = await viewportRect(page);
      const box = before && after ? { x: Math.min(before.x, after.x), y: Math.min(before.y, after.y), w: Math.max(before.x + before.w, after.x + after.w) - Math.min(before.x, after.x), h: Math.max(before.y + before.h, after.y + after.h) - Math.min(before.y, after.y) } : before;
      report[nameOf] = await sc.finish({ crop: cropOf(box), vp, extra: { description: `${t.click ? 'hover, click open, click close' : 'hover on, hold, off'}: target ${t.kind}${t.text ? ` "${scrub(t.text, [])}"` : ''}`, marksMs: marks, target: t.cid } });
    } catch (e: any) { errors.push(`[${nameOf}] ${e.message}`); } finally { await closeCtx(ctx); }
  }

  // loops: anything in the subtree that keeps moving with no input
  {
    const infinite = (desk.animations ?? []).filter((x: any) => x.timing?.iterations === 'Infinity');
    const ctx = await newCtx(browser, vp, 1);
    try {
      const page = await ctx.newPage();
      await load(page, url);
      await reveal(page);
      if (await markRoot(page, loc)) {
        await page.evaluate(() => (window as any).__ct.scrollToRoot(document.querySelector('[data-ct-root]'), 'center'));
        await page.mouse.move(2, 2);
        await page.waitForTimeout(1500);
        const moving = await page.evaluate(async () => {
          const root = document.querySelector('[data-ct-root]')!;
          const sample = () => Array.from([root, ...root.querySelectorAll('*')]).map((e) => { const cs = getComputedStyle(e); return cs.transform + '|' + cs.opacity + '|' + cs.backgroundPosition + '|' + (e as HTMLElement).getBoundingClientRect().x.toFixed(1); }).join(';');
          const a = sample(); await new Promise((r) => setTimeout(r, 700)); const b = sample(); await new Promise((r) => setTimeout(r, 700)); const c = sample();
          return a !== b && b !== c || !!root.querySelector('canvas, video');
        });
        if (moving || infinite.length) {
          const vr = await viewportRect(page);
          const sc = new Screencast(path.join(FR, 'loop'));
          await sc.start(page, vp);
          await page.waitForTimeout(4000);
          const hoverAt = sc.now();
          if (vr) await page.mouse.move(vr.x + vr.w / 2, vr.y + vr.h / 2, { steps: 10 });
          await page.waitForTimeout(2000);
          report.loop = await sc.finish({ crop: cropOf(vr), vp, extra: { description: '4s untouched, then the pointer rests on the component for 2s (does the loop pause or slow on hover?)', hoverStartMs: hoverAt, infiniteAnimations: infinite.length } });
          report.loop.hover = hoverVerdict(path.join(FR, 'loop'), hoverAt);
        }
      }
    } catch (e: any) { errors.push(`[frames loop] ${e.message}`); } finally { await closeCtx(ctx); }
  }
  for (const [k, v] of Object.entries(report)) log(`  [${k}] ${v.frameCount} frames, motion ${v.firstMotionMs ?? '-'}->${v.lastMotionMs ?? '-'}ms`);
  fs.writeFileSync(path.join(FR, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}

function hoverVerdict(dir: string, hoverAt: number) {
  const mt = JSON.parse(fs.readFileSync(path.join(dir, 'motion-timeline.json'), 'utf8'));
  const pre = mt.frames.filter((f: any) => f.i > 0 && f.t < hoverAt), post = mt.frames.filter((f: any) => f.t > hoverAt + 300);
  const mean = (xs: any[]) => (xs.length ? xs.reduce((s, f) => s + f.changed, 0) / xs.length : 0);
  const a = mean(pre), b = mean(post);
  return { preMeanChange: +a.toFixed(5), postMeanChange: +b.toFixed(5), verdict: !post.length || b < a * 0.15 ? 'PAUSES on hover' : b < a * 0.7 ? 'SLOWS on hover' : 'no change on hover' };
}

// ---------------------------------------------------------------- page-level helpers
async function collectSheets(page: Page): Promise<Sheet[]> {
  return page.evaluate(() => {
    const list = [...Array.from(document.styleSheets), ...((document as any).adoptedStyleSheets ?? [])] as CSSStyleSheet[];
    return list.filter((s) => !s.disabled).map((s, index) => {
      const media = s.media?.mediaText || '';
      try { return { href: s.href, base: s.href || location.href, text: Array.from(s.cssRules).map((r) => r.cssText).join('\n'), media, index }; }
      catch { return { href: s.href, base: s.href || location.href, text: null, media, index }; }
    });
  });
}

async function downloadAssets(urls: string[], REF: string, req: import('playwright').APIRequestContext, errors: string[]) {
  const map = new Map<string, string>();
  const manifest: { file: string; bytes: number; type: string }[] = [];
  const seenHash = new Map<string, string>();
  const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'video/mp4': '.mp4', 'video/webm': '.webm', 'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf', 'application/font-woff2': '.woff2', 'application/font-woff': '.woff' };
  const q = [...new Set(urls)];
  let i = 0;
  const worker = async () => {
    while (i < q.length) {
      const u = q[i++];
      try {
        const r = await req.get(u, { timeout: 30_000 });
        if (!r.ok()) { errors.push(`asset ${r.status()} ${u.slice(0, 60)}...`); continue; }
        const body = await r.body();
        const ct = (r.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
        let ext = path.extname(new URL(u).pathname).toLowerCase();
        if (!/^\.[a-z0-9]{2,5}$/.test(ext)) ext = EXT[ct] ?? '';
        const bucket = ct.startsWith('video/') || /\.(mp4|webm|mov)$/.test(ext) ? 'videos' : ct.startsWith('font/') || /font/.test(ct) || /\.(woff2?|ttf|otf|eot)$/.test(ext) ? 'fonts' : ct.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|svg)$/.test(ext) ? 'images' : 'data';
        const hash = createHash('sha1').update(body).digest('hex').slice(0, 10);
        const existing = seenHash.get(hash);
        if (existing) { map.set(u, existing); continue; }
        const file = path.join('assets', bucket, neutralAssetName(hash, ext, bucket));
        fs.mkdirSync(path.join(REF, 'assets', bucket), { recursive: true });
        fs.writeFileSync(path.join(REF, file), body);
        seenHash.set(hash, file);
        map.set(u, file);
        manifest.push({ file, bytes: body.length, type: ct });
      } catch (e: any) { errors.push(`asset ${u.slice(0, 60)}...: ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  fs.mkdirSync(path.join(REF, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(REF, 'assets', 'manifest.json'), JSON.stringify(manifest, null, 1));
  log(`assets: ${manifest.length} file(s) (${(manifest.reduce((s, m) => s + m.bytes, 0) / 1024).toFixed(0)} KB)`);
  return map;
}

export type Stack = { framework: string; framer: boolean; tailwind: boolean; lenis: boolean; gsap: boolean; motion: boolean; notes: string[] };
async function detectStack(page: Page): Promise<Stack> {
  return page.evaluate(() => {
    const html = document.documentElement.outerHTML.slice(0, 400000);
    const scripts = Array.from(document.scripts).map((s) => s.src + ' ' + (s.textContent || '').slice(0, 3000)).join('\n');
    const has = (re: RegExp) => re.test(html) || re.test(scripts);
    const s: any = { framework: 'unknown', framer: has(/framerusercontent\.com|data-framer-name/i), tailwind: /\b(flex|grid) [\w:-]*(px|py|gap|text|bg)-/.test(html) || has(/--tw-/), lenis: has(/lenis/i), gsap: has(/gsap|ScrollTrigger/i), motion: has(/framer-motion|motion\/react|data-projection-id/i), notes: [] };
    if (has(/__NEXT_DATA__|_next\/static/i)) s.framework = 'next';
    else if (has(/__SVELTEKIT_|sveltekit/i)) s.framework = 'svelte';
    else if (has(/__nuxt|_nuxt\//i)) s.framework = 'vue';
    else if (has(/astro-island|_astro\//i)) s.framework = 'astro';
    else if (s.framer) s.framework = 'framer';
    else if (has(/webflow/i)) s.framework = 'webflow';
    else if (has(/react-dom|_reactRoot|data-reactroot/i)) s.framework = 'react';
    if (s.framer) s.notes.push('Framer: appear ids, data-framer-name layer names, per-breakpoint class rules. The module rip applies.');
    if (s.tailwind) s.notes.push('Utility classes: css/used.css already holds exactly the utilities the component uses.');
    return s as Stack;
  });
}
