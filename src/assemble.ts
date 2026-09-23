/**
 * Write a grabbed component down as a reference folder. Everything that leaves this file is origin-blind:
 * asset urls become content addressed local paths, links back to the origin become route-relative, the
 * origin's words read as the brand. Only `.origin.json` names the source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse, HTMLElement } from 'node-html-parser';
import { log } from './lib/browser.ts';
import { writeCss, rewriteUrls, type Rule, type StyleRule } from './lib/css.ts';
import type { Origin } from './lib/anon.ts';
import type { VpData, Stack } from './grab.ts';
import type { Viewport } from './lib/browser.ts';

type Kept = StyleRule & { sheet: number; base: string; states: string[]; matches: Record<string, string[]> };
type Atom = Rule & { sheet: number; base: string };

export type Grabbed = {
  REF: string; name: string; url: string; origin: Origin; stack: Stack; data: Record<string, VpData>; vps: Viewport[]; found: VpData[];
  kept: Kept[]; keyframes: Atom[]; fontFaces: Atom[]; properties: Atom[]; varNames: string[]; states: any; frames: Record<string, any>;
  assets: Map<string, string>; local: (from: string) => (abs: string) => string | null; clean: (t: string) => string; fullHtml: string; errors: string[];
};

export async function writeReference(g: Grabbed) {
  const { REF, clean, assets, found } = g;
  const w = (rel: string, body: string) => { const f = path.join(REF, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  // json that may carry urls: asset urls -> local paths (relative to the reference root), then scrub
  const urlsLongestFirst = [...assets.keys()].sort((a, b) => b.length - a.length);
  const localize = (s: string) => { let out = s; for (const u of urlsLongestFirst) out = out.split(u).join(assets.get(u)!); return out; };
  const neutral = (v: unknown) => clean(localize(JSON.stringify(v, null, 1)));

  // ---------------------------------------------------------------- per width
  for (const d of Object.values(g.data)) {
    const dir = `capture/${d.vp.name}`;
    if (!d.found) { w(`${dir}/missing.json`, JSON.stringify({ found: false, error: d.error ?? 'not visible at this width' }, null, 1)); continue; }
    w(`${dir}/layout.json`, neutral(d.layout));
    // a run whose words the blackout rewrote cannot keep the original glyph widths: flag it so verify checks position, not width
    w(`${dir}/texts.json`, neutral((d.texts ?? []).map((t: any) => (clean(t.text) !== t.text ? { ...t, scrubbed: true } : t))));
    w(`${dir}/media.json`, neutral(d.media));
    w(`${dir}/context.json`, neutral({ ...d.context, heightFromContext: d.hfc, rootRect: d.rect }));
    w(`${dir}/interactive.json`, neutral(d.interactive));
    w(`${dir}/animations.json`, neutral(d.animations));
    w(`dom/${d.vp.name}.html`, clean(localizeHtml(d.html!, g.local(REF), g.url)));
  }
  const desk = found[0];
  const domHtml = clean(localizeHtml(desk.html!, g.local(REF), g.url));
  w('dom/component.html', domHtml);
  const symbols = dedupe(found.flatMap((d) => d.symbols ?? []), (s) => s.id);
  if (symbols.length) w('dom/symbols.svg', clean(`<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>\n${symbols.map((s) => s.html).join('\n')}\n</defs></svg>\n`));

  // ---------------------------------------------------------------- css
  const cssFor = (fromDir: string, opts: { comments: boolean }) => {
    const map = g.local(fromDir);
    const re = <T extends Rule & { base: string }>(r: T): T => ({ ...r, body: rewriteUrls(r.body, r.base, map) });
    const parts: string[] = [];
    if (g.fontFaces.length) parts.push(opts.comments ? '/* fonts the component renders with */' : '', writeCss(g.fontFaces.map(re)));
    if (g.properties.length) parts.push(opts.comments ? '/* registered custom properties it reads */' : '', writeCss(g.properties.map(re)));
    parts.push(opts.comments ? '/* every rule whose selector matches an element of the component, all breakpoints and states, in cascade order */' : '', writeCss(g.kept.map(re)));
    if (g.keyframes.length) parts.push(opts.comments ? '/* keyframes it animates with */' : '', writeCss(g.keyframes.map(re)));
    return clean(parts.filter((p) => p !== '').join('\n'));
  };
  const cssDir = path.join(REF, 'css');
  w('css/used.css', cssFor(cssDir, { comments: true }));
  w('css/rules.json', neutral(g.kept.map((r, i) => ({ i, conds: r.conds, selector: r.selector, states: r.states, body: r.body, matches: r.matches }))));
  w('css/vars.json', neutral(Object.fromEntries(found.map((d) => [d.vp.name, d.context?.vars ?? {}]))));

  // ---------------------------------------------------------------- spec: tree + css by kind
  const { treeLines } = await import('./prep.ts');
  const tree = treeLines(domHtml);
  const rest = g.kept.filter((r) => !r.conds.length && !r.states.some((s) => !s.startsWith('::')));
  const stateful = g.kept.filter((r) => r.states.some((s) => !s.startsWith('::')));
  const conditional = g.kept.filter((r) => r.conds.length && !r.states.some((s) => !s.startsWith('::')));
  const fmt = (r: Kept) => `${r.conds.length ? r.conds.join(' ') + ' | ' : ''}${r.selector}   -> ${Object.entries(r.matches).map(([vp, c]) => `${vp}:${c.slice(0, 6).join(',')}${c.length > 6 ? `+${c.length - 6}` : ''}`).join(' ')}\n    ${r.body}`;
  const spec = [
    '##### TREE #####',
    '(@cN = data-ct-id of the element; css below lists which ids each rule matched, per width)',
    ...tree,
    '',
    `##### CSS AT REST (${rest.length}) #####`, ...rest.map(fmt),
    '',
    `##### CSS BY BREAKPOINT / CONDITION (${conditional.length}) #####`, ...conditional.map(fmt),
    '',
    `##### CSS FOR STATES: hover / focus / active / open (${stateful.length}) #####`, ...stateful.map(fmt),
    '',
  ].join('\n');
  w('spec/component.txt', clean(localize(spec)));

  // ---------------------------------------------------------------- motion
  const transitions: Record<string, string> = {};
  for (const e of desk.layout ?? []) { const t = e.style?.transition; if (t && !/^all 0s ease 0s$/.test(t) && !/^\S+ 0s /.test(t)) transitions[e.cid] = t; }
  const cssAnims: Record<string, string> = {};
  for (const e of desk.layout ?? []) { const t = e.style?.animation; if (t && !/^none /.test(t)) cssAnims[e.cid] = t; }
  w('motion/transitions.json', neutral({ note: 'computed `transition` per element at rest (desktop); hover / focus diffs in capture/states/states.json name the transition that ran', transitions, animations: cssAnims }));
  w('motion/animations.json', neutral(Object.fromEntries(found.map((d) => [d.vp.name, d.animations ?? []]))));
  if (g.keyframes.length) w('motion/keyframes.css', clean(writeCss(g.keyframes)));
  w('motion/states.md', statesMd(g.states, clean));
  if (Object.keys(g.frames).length) w('motion/frames.md', framesMd(g.frames));
  if (g.stack.framer) await framerMotion(g, w, neutral);

  // ---------------------------------------------------------------- snapshot: the component standing on its own
  const { writeSnapshot } = await import('./snapshot.ts');
  writeSnapshot(g, cssFor(path.join(REF, 'snapshot'), { comments: false }));

  // ---------------------------------------------------------------- meta + brief
  const meta = {
    name: g.name, capturedAt: g.origin.capturedAt, brand: g.origin.brand, stack: g.stack,
    viewports: Object.fromEntries(Object.values(g.data).map((d) => [d.vp.name, d.found ? { width: d.vp.width, root: { w: d.rect!.w, h: d.rect!.h }, elements: d.count, textRuns: d.texts?.length, media: d.media?.length, heightFromContext: d.hfc?.fromContext, htmlVariant: variantOf(g, d) } : { width: d.vp.width, found: false }])),
    css: { rules: g.kept.length, stateful: stateful.length, conditional: conditional.length, keyframes: g.keyframes.length, fontFaces: g.fontFaces.length, vars: g.varNames.length },
    states: (g.states?.targets ?? []).length,
    frames: Object.keys(g.frames),
    assets: assets.size,
    errors: g.errors.map((e) => clean(e)),
  };
  w('component.json', neutral(meta));
  const { selfCheck } = await import('./rig/verify.ts');
  try { await selfCheck(REF); } catch (e: any) { g.errors.push(`snapshot self-check: ${e.message}`); log(`  snapshot self-check failed to run: ${e.message}`); }
  const { writeBrief } = await import('./brief.ts');
  writeBrief(REF);
}

/** Which distinct subtree html a width renders (Framer swaps whole subtrees per breakpoint). */
export function variantOf(g: Pick<Grabbed, 'found'>, d: VpData) {
  const htmls = [...new Set(g.found.map((x) => stripIds(x.html!)))];
  return htmls.indexOf(stripIds(d.html!));
}
export const stripIds = (h: string) => h.replace(/\sdata-ct-(id|root|prepin)(="[^"]*")?/g, '').replace(/\sdata-ct-current="[^"]*"/g, '');

/** Point every url in a chunk of html at the local, content addressed copy. */
export function localizeHtml(html: string, map: (abs: string) => string | null, base: string): string {
  const root = parse(html, { comment: false });
  const loc = (u: string | undefined | null) => { if (!u) return null; if (u.startsWith('data:') || u.startsWith('#')) return u; try { return map(new URL(u, base).href); } catch { return null; } };
  for (const el of root.querySelectorAll('*') as HTMLElement[]) {
    const tag = el.rawTagName?.toLowerCase();
    const cur = el.getAttribute('data-ct-current');
    if (tag === 'img') {
      const src = cur ? loc(cur) : null;
      const s0 = loc(el.getAttribute('src'));
      if (src) el.setAttribute('src', src); else if (s0) el.setAttribute('src', s0);
      const ss = el.getAttribute('srcset');
      if (ss) {
        const kept = ss.split(/,\s+(?=\S)/).map((p) => { const [u, ...d] = p.trim().split(/\s+/); const l = loc(u); return l ? [l, ...d].join(' ') : null; }).filter(Boolean);
        if (kept.length) el.setAttribute('srcset', kept.join(', ')); else el.removeAttribute('srcset');
      }
      el.removeAttribute('data-ct-current');
    }
    if (tag === 'source') {
      const s = loc(el.getAttribute('src')); if (s) el.setAttribute('src', s);
      const ss = el.getAttribute('srcset');
      if (ss) { const kept = ss.split(/,\s+(?=\S)/).map((p) => { const [u, ...d] = p.trim().split(/\s+/); const l = loc(u); return l ? [l, ...d].join(' ') : null; }).filter(Boolean); if (kept.length) el.setAttribute('srcset', kept.join(', ')); else el.removeAttribute('srcset'); }
    }
    if (tag === 'video') { const s = loc(el.getAttribute('src')); if (s) el.setAttribute('src', s); const p = loc(el.getAttribute('poster')); if (p) el.setAttribute('poster', p); }
    if (tag === 'image' || tag === 'use') for (const k of ['href', 'xlink:href']) { const v = el.getAttribute(k); if (v && !v.startsWith('#')) { const [u, frag] = v.split('#'); const l = loc(u); if (l) el.setAttribute(k, l + (frag ? '#' + frag : '')); } }
    const st = el.getAttribute('style');
    if (st && st.includes('url(')) el.setAttribute('style', rewriteUrls(st, base, (abs) => map(abs)));
  }
  return root.toString();
}

function dedupe<T>(xs: T[], key: (x: T) => string) { const m = new Map<string, T>(); for (const x of xs) if (!m.has(key(x))) m.set(key(x), x); return [...m.values()]; }

function statesMd(states: any, clean: (t: string) => string) {
  const L = ['# States', '', '> Measured on the live component at desktop: the pointer moved onto each interactive element, pressed (released off the element so nothing fired), keyboard focus, and click-to-open for toggles. Every computed property that changed, on which element (`cN` = data-ct-id), from what to what, and the transition that was in effect. Shots in `capture/states/`.', ''];
  if (!states?.targets?.length) { L.push('No interactive elements found (or states were skipped).'); return L.join('\n') + '\n'; }
  for (const t of states.targets) {
    L.push(`## ${t.index}. ${t.kind} ${t.text ? `"${t.text}"` : `<${t.tag}>`} (${t.cid}, ${t.rect.w}x${t.rect.h} at ${t.rect.x},${t.rect.y})`, '');
    for (const k of ['hover', 'press', 'focus', 'open']) {
      const s = t[k];
      if (!s) continue;
      const ch = s.changes.filter((c: any) => c.prop !== '__rect');
      L.push(`### ${k}: ${ch.length} change(s)${s.root ? `, root ${s.root.w}x${s.root.h}` : ''} -> \`${s.shot}\``);
      for (const c of ch.slice(0, 40)) L.push(`- ${c.cid} \`${c.prop}\`: \`${String(c.from).slice(0, 120)}\` -> \`${String(c.to).slice(0, 120)}\``);
      if (ch.length > 40) L.push(`- ... ${ch.length - 40} more in states.json`);
      const tr = Object.entries(s.transitions ?? {});
      if (tr.length) { L.push('', 'transitions in effect:'); for (const [cid, v] of tr) L.push(`- ${cid}: \`${v}\``); }
      L.push('');
    }
    if (t.restored === false) L.push(`did not return to rest after leaving (${(t.residue ?? []).length} residue): a sticky state, or a transition longer than the wait`, '');
  }
  return clean(L.join('\n') + '\n');
}

function framesMd(frames: Record<string, any>) {
  const L = ['# Frames', '', '> CDP screencast, every compositor frame, desktop, 1x, cropped to the component (+24px). `t` = ms since recording began. A gap between frames means nothing repainted.', '', '| scenario | frames | motion first -> last ms | ranges | notes |', '|---|---|---|---|---|'];
  for (const [k, v] of Object.entries(frames)) L.push(`| ${k} | ${v.frameCount} | ${v.firstMotionMs ?? '-'} -> ${v.lastMotionMs ?? '-'} | ${(v.ranges ?? []).map((r: any) => `${r.startMs}-${r.endMs}`).join(', ')} | ${v.hover ? v.hover.verdict : ''} |`);
  L.push('', 'Compare your build with `clonethis frames <build url> <out> --select "[data-clone-root]" --scenario <name>` and `clonethis sheet` on both folders at the same step.');
  return L.join('\n') + '\n';
}

/** Framer: the appear animations of the component's elements, the page modules, and a rip focused on this component. */
async function framerMotion(g: Grabbed, w: (rel: string, body: string) => void, neutral: (v: unknown) => string) {
  const ids = new Set(g.found.flatMap((d) => (d.layout ?? []).map((e: any) => e.appearId).filter(Boolean)));
  const m = g.fullHtml.match(/<script type="framer\/appear" id="__framer__appearAnimationsContent">([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const all = JSON.parse(m[1]);
      const sub = Object.fromEntries(Object.entries(all).filter(([k]) => ids.has(k)));
      w('motion/framer-appear.json', neutral(sub));
    } catch {}
  }
  const modUrls = [...new Set([...g.fullHtml.matchAll(/https:\/\/framerusercontent\.com\/sites\/[^"' ]+\.mjs/g)].map((x) => x[0]))].sort();
  let n = 0;
  for (const u of modUrls) {
    const file = path.join(g.REF, 'modules', g.clean(u.split('/').pop()!));
    if (fs.existsSync(file)) continue;
    try {
      const r = await fetch(u);
      if (r.ok) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, g.clean(await r.text())); n++; }
    } catch {}
  }
  const names = new Set<string>();
  const scopes = new Set<string>();
  for (const d of g.found) for (const e of d.layout ?? []) {
    if (e.name) names.add(g.clean(e.name));
    for (const c of (e.classes ?? '').split(/\s+/)) if (/^framer-[A-Za-z0-9]{5}$/.test(c)) scopes.add(c);
  }
  const { rip } = await import('./rip.ts');
  if (fs.existsSync(path.join(g.REF, 'modules'))) rip(g.REF, { focus: [...names, ...scopes] });
  log(`framer: ${ids.size} appear id(s), ${modUrls.length} module(s) (${n} fetched), focus ${names.size} names / ${scopes.size} scope classes`);
}
