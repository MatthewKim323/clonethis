/**
 * rip: pull the motion truth for one component out of Framer's page modules (one giant minified line each).
 * Focused: only windows that sit near the component's own layer names or scope classes are printed, so the
 * spec is written from the component's source, not the whole page's.
 *   motion/modules.md     per module: size, scope classes, display names, which focus terms it contains
 *   motion/constants.json every `X={...type:"spring"|"tween"...}` transition constant, per module
 *   motion/rip.md         windows around the focus terms, then the known motion patterns near them
 * usage: clonethis rip <reference/name> [--window 700] [--focus a,b] [--all]
 */
import fs from 'node:fs';
import path from 'node:path';
import { Args, usage } from './lib/args.ts';
import { log } from './lib/browser.ts';

const PATTERNS: { key: string; re: RegExp; why: string }[] = [
  { key: 'scroll-transform', re: /__framer__transformTargets/g, why: 'Framer "Enter" effect: scroll-progress-linked (offset start end / end end), first target = from state, __framer__spring = chase spring. NOT whileInView.' },
  { key: 'scroll-target', re: /__framer__transformTrigger:[`"']onScrollTarget[`"']/g, why: 'transform driven by a scroll marker element.' },
  { key: 'variant-on-scroll', re: /__framer__threshold/g, why: 'variant switch by scroll ranges; animateOnce:false flips back.' },
  { key: 'text-effect', re: /tokenization:[`"'](character|word|line)[`"']/g, why: 'per token appear: spring + stagger, onMount or onInView.' },
  { key: 'ticker', re: /tickerEffect/g, why: 'Ticker props: speed, direction, gap, hover factor, fade edges, draggable.' },
  { key: 'drag', re: /dragTransition|dragSnapToOrigin|drag:!0|drag:[`"'][xy][`"']/g, why: 'draggable with inertia snap-back.' },
  { key: 'loop', re: /repeat:1\/0|repeat:Infinity|repeatType/g, why: 'infinite loops.' },
  { key: 'scroll-hook', re: /useScroll\(|useTransform\(/g, why: 'custom scroll-linked code.' },
  { key: 'hover-variant', re: /-hover[`"']|onHoverStart|whileHover|useActiveVariantCallback|onTap|whileTap/g, why: 'gesture variants; the component `transition` constant applies.' },
  { key: 'appear-runtime', re: /startOptimizedAppearAnimation|animateAppearEffect/g, why: 'SSR appear runtime hooks.' },
  { key: 'canvas', re: /getContext\([`"'](2d|webgl2?)[`"']\)|gl_FragColor|fragmentShader/g, why: 'canvas / WebGL to port verbatim.' },
  { key: 'layout', re: /layoutId|layoutDependency|AnimatePresence/g, why: 'shared layout / presence animations.' },
];

export function rip(root: string, opts: { focus?: string[]; window?: number; all?: boolean } = {}) {
  const WIN = opts.window ?? 700;
  const focus = [...new Set((opts.focus ?? []).filter((f) => f && f.length >= 3))];
  const mdir = path.join(root, 'modules');
  const files = fs.readdirSync(mdir).filter((f) => f.endsWith('.mjs')).map((f) => ({ f, size: fs.statSync(path.join(mdir, f)).size })).sort((x, y) => y.size - x.size);
  fs.mkdirSync(path.join(root, 'motion'), { recursive: true });
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const focusRe = focus.length ? new RegExp(focus.map((f) => `[\`"']${esc(f)}[\`"']|${esc(f)}(?![A-Za-z0-9])`).join('|'), 'g') : null;
  const modLines = ['# Modules', '', '| module | KB | scope classes | display names | focus hits | patterns |', '|---|---|---|---|---|---|'];
  const constants: Record<string, Record<string, string>> = {};
  const L: string[] = ['# Ripped motion (focused on this component)', '', `> Focus terms: ${focus.length ? focus.map((f) => '`' + f + '`').join(', ') : '(none: every window printed)'}. ${WIN} chars of context. Modules are minified single lines; read the object literals, they are the exact values shipped. Never round.`, ''];
  for (const { f, size } of files) {
    const src = fs.readFileSync(path.join(mdir, f), 'utf8');
    if (/rolldown-runtime|^react\.|^framer\.|^motion\./.test(f)) { modLines.push(`| ${f} | ${(size / 1024).toFixed(0)} | runtime / vendor | | | |`); continue; }
    const scopes = [...new Set([...src.matchAll(/[`"'](framer-[A-Za-z0-9]{5})[`"']/g)].map((m) => m[1]))];
    const names = [...new Set([...src.matchAll(/displayName\s*[=:]\s*[`"']([^`"']{1,60})[`"']/g)].map((m) => m[1]))];
    const fhits: number[] = focusRe ? [...src.matchAll(focusRe)].map((m) => m.index!) : [];
    const pats: string[] = [];
    for (const p of PATTERNS) { const n = (src.match(p.re) || []).length; if (n) pats.push(`${p.key}:${n}`); }
    modLines.push(`| ${f} | ${(size / 1024).toFixed(0)} | ${scopes.slice(0, 10).join(' ')}${scopes.length > 10 ? ` +${scopes.length - 10}` : ''} | ${names.slice(0, 8).join(', ')} | ${fhits.length} | ${pats.join(' ')} |`);
    const consts: Record<string, string> = {};
    for (const m of src.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)=(\{[^{}]*type:[`"'](?:spring|tween|inertia|keyframes)[`"'][^{}]*\})/g)) consts[m[1]] = m[2];
    if (Object.keys(consts).length) constants[f] = consts;
    if (!opts.all && focusRe && !fhits.length) continue;
    const near = (i: number) => opts.all || !focusRe || fhits.some((h) => Math.abs(h - i) < 3000);
    const merge = (idxs: number[]) => {
      const out: [number, number][] = [];
      for (const i of idxs.sort((a, b) => a - b)) {
        const s = Math.max(0, i - WIN), e = Math.min(src.length, i + WIN);
        const last = out.at(-1);
        if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
      }
      return out;
    };
    const sections: string[] = [];
    if (fhits.length) {
      const w = merge(fhits);
      sections.push(`### focus windows (${fhits.length} hits, ${w.length} windows)`, '');
      for (const [s, e] of w.slice(0, 30)) {
        const chunk = src.slice(s, e);
        const tags = PATTERNS.filter((p) => new RegExp(p.re.source).test(chunk)).map((p) => p.key);
        sections.push('```js', `// @${s}${tags.length ? '  contains: ' + tags.join(', ') : ''}`, chunk, '```', '');
      }
      if (w.length > 30) sections.push(`_... ${w.length - 30} more windows; grep the module._`, '');
    }
    for (const p of PATTERNS) {
      const idxs = [...src.matchAll(p.re)].map((m) => m.index!).filter(near);
      if (!idxs.length) continue;
      const w = merge(idxs);
      sections.push(`### ${p.key} near the component (${idxs.length} matches, ${w.length} windows)`, '', `_${p.why}_`, '');
      for (const [s, e] of w.slice(0, 12)) sections.push('```js', `// @${s}`, src.slice(s, e), '```', '');
    }
    if (!sections.length) continue;
    L.push(`## ${f} (${(size / 1024).toFixed(0)} KB)`, '');
    if (Object.keys(consts).length) { L.push('### transition constants', '', '```js', ...Object.entries(consts).map(([k, v]) => `const ${k}=${v}`), '```', ''); }
    L.push(...sections);
  }
  fs.writeFileSync(path.join(root, 'motion', 'modules.md'), modLines.join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'motion', 'constants.json'), JSON.stringify(constants, null, 1));
  fs.writeFileSync(path.join(root, 'motion', 'rip.md'), L.join('\n'));
  log(`rip -> motion/{modules.md,constants.json,rip.md}: ${files.length} modules, ${Object.values(constants).reduce((n, c) => n + Object.keys(c).length, 0)} transition constants`);
}

export function runRip(argv: string[]) {
  const a = new Args(argv);
  const root = a.positional[0];
  if (!root || !fs.existsSync(path.join(root, 'modules'))) usage('usage: clonethis rip <reference/name> [--window 700] [--focus a,b] [--all]   (needs modules/: Framer pages only)');
  let focus = a.list('focus');
  if (!focus.length) {
    const L = JSON.parse(fs.readFileSync(path.join(root, 'capture', 'desktop', 'layout.json'), 'utf8')) as any[];
    focus = [...new Set(L.flatMap((e) => [e.name, ...(e.classes ?? '').split(/\s+/).filter((c: string) => /^framer-[A-Za-z0-9]{5}$/.test(c))]).filter(Boolean))];
  }
  rip(root, { focus, window: a.num('window', 700), all: a.flag('all') });
}
