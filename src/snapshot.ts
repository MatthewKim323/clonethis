/**
 * snapshot/index.html: the component standing on its own. The captured html (per width when the page swaps
 * subtrees per breakpoint), the css it uses, its fonts and assets from the reference folder, the type and
 * variables it inherits, and its root pinned to the width its context gave it at each captured width.
 *
 * Two jobs: `clonethis verify <snapshot> <ref>` passing proves the extraction is complete (the self-check
 * `grab` runs), and it is a static, working starting point to port from. It is not the deliverable: no JS
 * runs in it, so anything the page drove from script (springs, scroll links, tickers) is frozen at rest.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Grabbed } from './assemble.ts';
import { localizeHtml, stripIds } from './assemble.ts';
import type { VpData } from './grab.ts';

type Range = { min: number | null; max: number | null };

/** Width ranges around the captured widths, split halfway between neighbours. */
export function ranges(widths: number[]): Map<number, Range> {
  const ws = [...new Set(widths)].sort((a, b) => b - a);
  const out = new Map<number, Range>();
  ws.forEach((w, i) => {
    const upper = i === 0 ? null : Math.floor((ws[i - 1] + w) / 2);
    const lower = i === ws.length - 1 ? null : Math.floor((w + ws[i + 1]) / 2) + 1;
    out.set(w, { min: lower, max: upper });
  });
  return out;
}
export function mq(r: Range) {
  const p = [r.min !== null ? `(min-width: ${r.min}px)` : '', r.max !== null ? `(max-width: ${r.max}px)` : ''].filter(Boolean);
  return p.length ? `@media ${p.join(' and ')}` : '';
}

const INHERITED_CSS: Record<string, string> = { fontFamily: 'font-family', fontSize: 'font-size', fontWeight: 'font-weight', fontStyle: 'font-style', lineHeight: 'line-height', letterSpacing: 'letter-spacing', wordSpacing: 'word-spacing', color: 'color', textAlign: 'text-align', textTransform: 'text-transform', whiteSpace: 'white-space', fontFeatureSettings: 'font-feature-settings', fontVariationSettings: 'font-variation-settings', WebkitFontSmoothing: '-webkit-font-smoothing', textRendering: 'text-rendering', direction: 'direction', listStyleType: 'list-style-type' };

export function writeSnapshot(g: Grabbed, css: string) {
  const dir = path.join(g.REF, 'snapshot');
  fs.mkdirSync(dir, { recursive: true });
  const found = g.found;
  const R = ranges(found.map((d) => d.vp.width));
  const map = g.local(dir);
  // distinct subtree html -> which widths render it
  const variants: { html: string; widths: number[] }[] = [];
  for (const d of found) {
    const key = stripIds(d.html!);
    const v = variants.find((x) => stripIds(x.html) === key);
    if (v) v.widths.push(d.vp.width); else variants.push({ html: d.html!, widths: [d.vp.width] });
  }
  const body: string[] = [];
  const pins: string[] = [];
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const attrs = (o: Record<string, string>, extraClass = '') => {
    const a = { ...o };
    if (extraClass) a.class = [a.class, extraClass].filter(Boolean).join(' ');
    return Object.entries(a).map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
  };
  // html / body carry their attributes (a theme class on <html> is common); the rest of the ancestor chain is
  // rebuilt around each variant so descendant selectors (`.page .card`) still match, with its boxes neutralized
  const firstChain = (found.find((d) => d.context?.chain)?.context?.chain ?? []) as { tag: string; attrs: Record<string, string> }[];
  const htmlAttrs = firstChain[0]?.tag === 'html' ? firstChain[0].attrs : {};
  const bodyAttrs = firstChain[1]?.tag === 'body' ? firstChain[1].attrs : {};
  variants.forEach((v, i) => {
    const d = found.find((x) => x.vp.width === v.widths[0])!;
    const chain = ((d.context?.chain ?? []) as { tag: string; attrs: Record<string, string> }[]).filter((c) => c.tag !== 'html' && c.tag !== 'body');
    const html = localizeHtml(v.html, map, g.url).replace(/\sdata-ct-root(="")?/, ' data-clone-root');
    if (!chain.length) { body.push(`<div class="ct-anc ct-v${i}">${html}</div>`); return; }
    let open = '', close = '';
    chain.forEach((c, k) => { open += `<${c.tag}${attrs(c.attrs, k === 0 ? `ct-anc ct-v${i}` : 'ct-anc')}>`; close = `</${c.tag}>` + close; });
    body.push(open + html + close);
  });
  for (const d of found) {
    const r = R.get(d.vp.width)!;
    const vi = variants.findIndex((v) => v.widths.includes(d.vp.width));
    const inh = d.context?.inherited ?? {};
    const decl = Object.entries(INHERITED_CSS).map(([k, prop]) => (inh[k] ? `${prop}: ${inh[k]};` : '')).filter(Boolean).join(' ');
    const vars = Object.entries(d.context?.vars ?? {}).map(([k, v]) => `${k}: ${v};`).join(' ');
    const bd = d.context?.backdrop ?? {};
    const bg = bd.from === 'ancestor' && bd.backgroundColor && bd.backgroundColor !== 'rgba(0, 0, 0, 0)' ? bd.backgroundColor : bd.page ?? 'rgb(255, 255, 255)';
    const pos = d.context?.root?.position;
    const moved = pos === 'fixed' || pos === 'absolute' || pos === 'sticky';
    const W = d.rect!.w, H = d.hfc?.fromContext ? d.hfc.actual : null;
    const rules = [
      `body { background: ${bg}; }`,
      `body { ${decl} ${vars} }`,
      ...variants.map((_v, j) => (j === vi ? '' : `.ct-anc.ct-v${j} { display: none !important; }`)).filter(Boolean),
      `.ct-v${vi} [data-clone-root], [data-clone-root].ct-v${vi} { width: ${W}px !important; min-width: ${W}px !important; max-width: ${W}px !important; box-sizing: border-box !important; flex: 0 0 auto !important;${H ? ` height: ${H}px !important; min-height: ${H}px !important; max-height: ${H}px !important;` : ''}${moved ? ' position: relative !important; inset: auto !important; top: auto !important; left: auto !important; right: auto !important; bottom: auto !important;' : ''} }`,
    ];
    const m = mq(r);
    pins.push(m ? `${m} {\n  ${rules.join('\n  ')}\n}` : rules.join('\n'));
  }
  const symbols = found.flatMap((d) => d.symbols ?? []);
  const seen = new Set<string>();
  const defs = symbols.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).map((s) => s.html).join('\n');
  const doc = `<!doctype html>
<html${attrs(htmlAttrs)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>snapshot</title>
<style>
html, body { margin: 0; padding: 0; }
/* the ancestors the component sat in: same tags, classes and attributes so its selectors match, boxes neutralized */
.ct-anc { margin: 0 !important; padding: 0 !important; border: 0 !important; width: auto !important; height: auto !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; position: static !important; transform: none !important; overflow: visible !important; background: none !important; box-shadow: none !important; opacity: 1 !important; filter: none !important; gap: 0 !important; clip-path: none !important; mask: none !important; }
.ct-anc:not(table, thead, tbody, tfoot, tr, ul, ol, dl, svg) { display: block !important; }
${pins.join('\n')}
</style>
<style>
${css}
</style>
</head>
<body${attrs(bodyAttrs)}>
${defs ? `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${defs}</defs></svg>\n` : ''}${body.join('\n')}
</body>
</html>
`;
  fs.writeFileSync(path.join(dir, 'index.html'), g.clean(doc));
}

export function snapshotSummary(d: VpData) {
  return { width: d.vp.width, root: d.rect, pinnedHeight: !!d.hfc?.fromContext };
}
