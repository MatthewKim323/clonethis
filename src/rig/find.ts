/**
 * find: which element is "the component"? Search a page by selector, visible text, aria-label / alt, or Framer
 * layer name; print each hit with its ancestor chain (size, children, a selector that survives a reload) and
 * shoot the chain outlined so the right level can be picked by eye.
 *   clonethis find <url> "<query>" [--w 1440] [--max 4] [--out find/]
 *   then: clonethis grab <url> --select "<selector>" [--nth N]   (or --text "<query>" --up <level>)
 *
 * pick: open the page in a real window and point at it. Hover highlights, [ / ArrowUp climbs to the parent,
 * ] / ArrowDown goes back down, click confirms, Esc cancels. Prints the grab command.
 *   clonethis pick <url> [--w 1440] [--timeout 300]
 */
import fs from 'node:fs';
import path from 'node:path';
import { Args, usage } from '../lib/args.ts';
import { launch, newCtx, load, reveal, viewportByWidth, log } from '../lib/browser.ts';
import { ct, ensureLib } from '../lib/page.ts';

const COLORS = ['#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de'];

export async function runFind(argv: string[]) {
  const a = new Args(argv);
  const [url, query] = a.positional;
  if (!url || !query) usage('usage: clonethis find <url> "<query: css selector | visible text | layer name>" [--w 1440] [--max 4] [--out find]');
  const vp = viewportByWidth(a.num('w', 1440));
  const out = a.str('out', 'find');
  fs.mkdirSync(out, { recursive: true });
  const browser = await launch(true);
  try {
    const ctx = await newCtx(browser, vp, 1);
    const page = await ctx.newPage();
    await load(page, url);
    await reveal(page);
    const hits = await ct<any[]>(page, 'candidates', query, a.num('max', 4));
    if (!hits.length) { console.log(`no visible element matches "${query}"`); return; }
    for (let k = 0; k < hits.length; k++) {
      const h = hits[k];
      console.log(`\n#${k}  hit: ${h.hit.tag}${h.hit.name ? ` [${h.hit.name}]` : ''} "${(h.hit.text ?? '').slice(0, 50)}"`);
      console.log('  up  size          desc  tag / name / classes                         selector');
      for (const c of h.chain) {
        const label = `${c.tag}${c.name ? ` [${c.name}]` : ''}${c.id ? ` #${c.id}` : ''}${c.classes ? ` .${c.classes.split(' ').slice(0, 2).join('.')}` : ''}`;
        console.log(`  ${String(c.up).padStart(2)}  ${`${Math.round(c.rect.w)}x${Math.round(c.rect.h)}`.padEnd(12)}  ${String(c.descendants).padStart(4)}  ${label.slice(0, 44).padEnd(44)}  ${c.selector}${c.count > 1 ? `  --nth ${c.nth} (of ${c.count})` : ''}`);
      }
      // outline the chain, biggest first, and shoot the viewport around the hit
      // frame the biggest level that still fits on screen, so the outlines around it are readable
      const fits = h.chain.filter((c: any) => c.rect.h <= vp.height - 60);
      const top = fits.at(-1) ?? h.chain[0];
      await page.evaluate(({ chain, colors }) => {
        document.querySelectorAll('.__ct-find').forEach((e) => e.remove());
        chain.slice(0, 7).forEach((c: any, i: number) => {
          const d = document.createElement('div');
          d.className = '__ct-find';
          const col = colors[i % colors.length];
          Object.assign(d.style, { position: 'absolute', left: c.rect.x + 'px', top: c.rect.y + 'px', width: c.rect.w + 'px', height: c.rect.h + 'px', outline: `2px solid ${col}`, outlineOffset: `${-1 - i}px`, zIndex: '2147483647', pointerEvents: 'none' });
          const t = document.createElement('div');
          t.textContent = `up ${c.up}`;
          Object.assign(t.style, { position: 'absolute', left: '0', top: `${i * 16}px`, background: col, color: '#000', font: '11px/16px monospace', padding: '0 4px' });
          d.appendChild(t);
          document.body.appendChild(d);
        });
      }, { chain: h.chain, colors: COLORS });
      await page.evaluate(({ y, h, vh }) => window.scrollTo(0, Math.max(0, y + h / 2 - vh / 2)), { y: top.rect.y, h: top.rect.h, vh: vp.height });
      await page.waitForTimeout(400);
      const file = path.join(out, `${k}.png`);
      await page.screenshot({ path: file });
      console.log(`  shot: ${file} (colored outlines, labels "up N")`);
    }
    console.log(`\nthen: clonethis grab <url> --select "<selector>" [--nth N] --as <name>`);
  } finally { await browser.close(); }
}

export async function runPick(argv: string[]) {
  const a = new Args(argv);
  const url = a.positional[0];
  if (!url) usage('usage: clonethis pick <url> [--w 1440] [--timeout 300]');
  const vp = viewportByWidth(a.num('w', 1440));
  const browser = await launch(false);
  try {
    const ctx = await newCtx(browser, vp, 1);
    const page = await ctx.newPage();
    let done: (v: any) => void = () => {};
    const picked = new Promise<any>((r) => (done = r));
    await page.exposeBinding('__ctPicked', (_src, payload) => done(payload));
    await load(page, url);
    await ensureLib(page);
    await page.evaluate(() => {
      const box = document.createElement('div');
      const tip = document.createElement('div');
      Object.assign(box.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', outline: '2px solid #ff2d55', background: 'rgba(255,45,85,.08)', transition: 'all 60ms linear' });
      Object.assign(tip.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', background: '#111', color: '#fff', font: '12px/1.4 ui-monospace, monospace', padding: '4px 8px', borderRadius: '4px', maxWidth: '560px' });
      const help = document.createElement('div');
      help.textContent = 'clonethis pick: hover to highlight, [ or ArrowUp = parent, ] or ArrowDown = back down, click = take it, Esc = cancel';
      Object.assign(help.style, { position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483647', background: '#ff2d55', color: '#fff', font: '12px/1.4 ui-monospace, monospace', padding: '6px 10px', borderRadius: '6px', pointerEvents: 'none' });
      document.documentElement.append(box, tip, help);
      let base: Element | null = null, level = 0;
      const target = () => { let e = base; for (let i = 0; i < level && e && e.parentElement && e.parentElement !== document.documentElement; i++) e = e.parentElement; return e; };
      const draw = () => {
        const t = target();
        if (!t) return;
        const r = t.getBoundingClientRect();
        Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        const name = t.getAttribute('data-framer-name');
        tip.textContent = `${t.tagName.toLowerCase()}${name ? ` [${name}]` : ''}${t.id ? '#' + t.id : ''}  ${Math.round(r.width)}x${Math.round(r.height)}  ${t.querySelectorAll('*').length} els  (up ${level})`;
        Object.assign(tip.style, { left: Math.max(4, r.left) + 'px', top: Math.max(4, r.top - 28) + 'px' });
      };
      addEventListener('mousemove', (e: any) => { const el = document.elementFromPoint(e.clientX, e.clientY); if (el && el !== base && el !== box && el !== tip) { base = el; level = 0; } draw(); }, true);
      addEventListener('scroll', draw, true);
      addEventListener('keydown', (e: any) => {
        if (e.key === '[' || e.key === 'ArrowUp') { level++; e.preventDefault(); draw(); }
        if (e.key === ']' || e.key === 'ArrowDown') { level = Math.max(0, level - 1); e.preventDefault(); draw(); }
        if (e.key === 'Escape') (window as any).__ctPicked(null);
      }, true);
      const swallow = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
      for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) addEventListener(ev, swallow, true);
      addEventListener('click', (e) => {
        swallow(e);
        const t = target();
        if (!t) return;
        const c = (window as any).__ct;
        (window as any).__ctPicked({ ...c.selectorFor(t), ...c.describe(t) });
      }, true);
    });
    log('pick: point at the component in the browser window, [ / ] to change level, click to take it');
    const res = await Promise.race([picked, new Promise((r) => setTimeout(() => r('timeout'), a.num('timeout', 300) * 1000))]);
    if (!res || res === 'timeout') { console.log(res === 'timeout' ? 'timed out' : 'cancelled'); return; }
    console.log(`\npicked: ${res.tag}${res.name ? ` [${res.name}]` : ''} ${Math.round(res.rect.w)}x${Math.round(res.rect.h)}, ${res.descendants} elements`);
    console.log(`selector: ${res.selector}${res.count > 1 ? `  (nth ${res.nth} of ${res.count} visible matches)` : ''}`);
    console.log(`\nclonethis grab <url> --select ${JSON.stringify(res.selector)}${res.nth ? ` --nth ${res.nth}` : ''} --as <name>`);
  } finally { await browser.close(); }
}
