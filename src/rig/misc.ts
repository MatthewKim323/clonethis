/**
 * diff: pixel diff of two component shots (2x), with a build | reference | mask sheet.
 *   clonethis diff <build.png> <ref.png> [out.png] [--threshold 32]
 *
 * serve: serve a reference folder over http (the snapshot needs it for fonts): <url>/snapshot/index.html
 *   clonethis serve <reference/name> [--port 4777]
 *
 * cssq: the rules that style an element or mention a fragment, per breakpoint and state.
 *   clonethis cssq <reference/name> <@cN | class | selector fragment | property>
 */
import fs from 'node:fs';
import path from 'node:path';
import { Args, usage } from '../lib/args.ts';
import { pixelDiff } from './verify.ts';
import { serveDir } from '../lib/serve.ts';

export async function runDiff(argv: string[]) {
  const a = new Args(argv);
  const [b, r, out] = a.positional;
  if (!b || !r) usage('usage: clonethis diff <build.png> <ref.png> [out.png] [--threshold 32]');
  const d = await pixelDiff(b, r, out ?? null, [], 2, a.num('threshold', 32));
  console.log(`${(d.differ * 100).toFixed(2)}% of pixels differ (compared ${d.w}x${d.h} px${d.sizeDelta ? `, sizes differ by ${d.sizeDelta}px` : ''})${out ? ` -> ${out}` : ''}`);
}

export async function runServe(argv: string[]) {
  const a = new Args(argv);
  const ref = a.positional[0];
  if (!ref || !fs.existsSync(path.join(ref, 'snapshot', 'index.html'))) usage('usage: clonethis serve <reference/name> [--port 4777]');
  const s = serveDir(ref, a.num('port', 4777));
  console.log(`serving ${ref} at ${s.url}\n  snapshot: ${s.url}/snapshot/index.html\nctrl-c to stop`);
  await new Promise(() => {});
}

export function runCssq(argv: string[]) {
  const a = new Args(argv);
  const [ref, q] = a.positional;
  if (!ref || !q) usage('usage: clonethis cssq <reference/name> <@cN | class | selector fragment | property>');
  const rules = JSON.parse(fs.readFileSync(path.join(ref, 'css', 'rules.json'), 'utf8')) as any[];
  const id = q.startsWith('@') ? q.slice(1) : null;
  const hits = rules.filter((r) => (id ? Object.values<string[]>(r.matches).some((c) => c.includes(id)) : r.selector.includes(q) || r.body.includes(q)));
  for (const r of hits) console.log(`${(r.conds.join(' ') || '@base').padEnd(48)} ${r.selector}${r.states.length ? `   [${r.states.join(' ')}]` : ''}\n    ${r.body}`);
  console.log(`\n${hits.length} rule(s)`);
}
