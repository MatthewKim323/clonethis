/**
 * End to end on the local fixture: grab the featured pricing card, then check that
 *   - the snapshot passes its own gate at every width (the extraction is complete)
 *   - nothing written under the reference (except .origin.json) names the origin
 *   - the used css kept what the card needs and dropped what it does not
 *   - states found the button hover and the disclosure toggle
 * usage: bun test/e2e.ts            (Georgia from macOS is copied in as the fixture font when present)
 */
import fs from 'node:fs';
import path from 'node:path';
import { serveDir } from '../src/lib/serve.ts';

const ROOT = path.join(import.meta.dirname, 'fixtures', 'site');
const OUT = path.join(import.meta.dirname, 'out', 'e2e');
const fonts = path.join(ROOT, 'fonts');
fs.mkdirSync(fonts, { recursive: true });
for (const [src, dst] of [['Georgia.ttf', 'serif-regular.ttf'], ['Georgia Bold.ttf', 'serif-bold.ttf']]) {
  const from = path.join('/System/Library/Fonts/Supplemental', src);
  if (!fs.existsSync(path.join(fonts, dst)) && fs.existsSync(from)) fs.copyFileSync(from, path.join(fonts, dst));
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const site = await serveDir(ROOT);
process.chdir(OUT);
const fails: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
try {
  const { runGrab } = await import('../src/grab.ts');
  const { REF } = await runGrab([`${site.url}/`, '--select', 'article.plan-card.featured', '--as', 'pricing-card', '--brand', 'Acme', '--tokens', 'northwind', '--headless']);
  const j = (rel: string) => JSON.parse(fs.readFileSync(path.join(REF, rel), 'utf8'));
  console.log('\n== checks');
  const checkRes = j('snapshot/check.json');
  for (const [vp, v] of Object.entries<any>(checkRes.viewports)) check(v.pass, `snapshot passes the gate at ${vp} (h ${v.root?.build?.h}/${v.root?.ref?.h}, text ${v.texts.ok}/${v.texts.total}, px ${v.pixels?.differPct}%)`);
  const leaks: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name !== '.origin.json' && /\.(json|html|css|txt|md|svg)$/.test(e.name) && /northwind/i.test(fs.readFileSync(p, 'utf8'))) leaks.push(path.relative(REF, p)); } };
  walk(REF);
  check(leaks.length === 0, `no origin word outside .origin.json${leaks.length ? `: ${leaks.join(', ')}` : ''}`);
  const css = fs.readFileSync(path.join(REF, 'css', 'used.css'), 'utf8');
  check(/\.cta:hover/.test(css) && /\.cta:focus-visible/.test(css), 'used.css keeps the state rules');
  check(/@keyframes pulse/.test(css) && !/neverUsed/.test(css), 'used.css keeps used keyframes only');
  check(/max-width: 809px/.test(css), 'used.css keeps the phone breakpoint');
  check(!/\.topbar|\.hero\b|Unused Face|--unused/.test(css), 'used.css drops what the card does not use');
  check(/\.pricing \.plan-card h3/.test(css) && /\.theme-light \.plan-card \.note em/.test(css), 'used.css keeps ancestor-qualified rules');
  check(/md\\:inline-flex/.test(css), 'used.css keeps escaped utility classes');
  const states = j('capture/states/states.json');
  const btn = states.targets.find((t: any) => t.kind === 'button');
  check(!!btn && btn.hover.changes.some((c: any) => c.prop === 'backgroundColor'), 'states: button hover changes background');
  check(!!btn && btn.restored, 'states: button returns to rest');
  const tog = states.targets.find((t: any) => t.kind === 'toggle');
  check(!!tog && tog.open && tog.open.root.h > 0, 'states: disclosure opens');
  check(fs.readdirSync(path.join(REF, 'assets', 'fonts')).length === 2, 'two font files harvested');
  check(fs.existsSync(path.join(REF, 'capture', 'frames', 'enter', 'frames.json')), 'entrance frames recorded');
} finally { site.stop(); }
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
