/**
 * The states pass: with the component tagged and centered, move onto each interactive element (hover), press
 * it (released off the element so nothing fires), focus it from the keyboard, click toggles open and shut.
 * Each state records every computed property that changed in the subtree (from -> to), the transitions in
 * effect, and a shot of the component. Shared by `grab` (reference) and `states` (build).
 */
import path from 'node:path';
import type { Page } from 'playwright';
import { ct } from './page.ts';
import { shootRoot } from './shoot.ts';
import { log } from './browser.ts';

export async function statesPass(page: Page, vp: { width: number; height: number }, dir: string, out: { targets: any[] }, opts: { max?: number; targets?: any[]; shotPrefix?: string; dsf?: number; quiet?: boolean }) {
  const dsf = opts.dsf ?? 2;
  const targets = opts.targets ?? (await ct<any[]>(page, 'interactive', '$root', opts.max ?? 8));
  const idle = async () => { await page.mouse.move(2, 2); await page.waitForTimeout(900); };
  await idle();
  const base = await ct<any>(page, 'snap', '$root');
  await shootRoot(page, path.join(dir, 'base.png'), { vp, dsf, hide: false, settleMs: 200, noScroll: true });
  const centerOf = async (cid: string) => page.evaluate((cid) => { const e = document.querySelector(`[data-ct-id="${cid}"]`); if (!e) return null; let r = e.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) { e.scrollIntoView({ block: 'center' }); r = e.getBoundingClientRect(); } return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, cid);
  const record = async (label: string, cid: string) => {
    const after = await ct<any>(page, 'snap', '$root');
    const changes = await page.evaluate(({ a, b }) => (window as any).__ct.diffSnap(a, b), { a: base, b: after });
    const trans = await ct<any>(page, 'transitionsOf', '$root', [...new Set(changes.map((c: any) => c.cid))]);
    const file = `${label}.png`;
    await shootRoot(page, path.join(dir, file), { vp, dsf, hide: false, settleMs: 100, noScroll: true });
    const rr = await page.evaluate(() => { const r = document.querySelector('[data-ct-root]')!.getBoundingClientRect(); return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 }; });
    return { changes, transitions: trans, shot: `${opts.shotPrefix ?? ''}${file}`, root: rr, target: cid };
  };
  const settleAnims = async (cap = 2500) => {
    await page.waitForTimeout(150);
    await page.evaluate(async (cap) => {
      const root = document.querySelector('[data-ct-root]')!;
      const t0 = performance.now();
      while (performance.now() - t0 < cap) {
        const running = root.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity);
        if (!running.length) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    }, cap);
    await page.waitForTimeout(350);
  };
  let n = 0;
  for (const t of targets) {
    const tag = `${String(n).padStart(2, '0')}-${t.kind}`;
    const rec: any = { index: n, ...t };
    try {
      const c = await centerOf(t.cid);
      if (!c) continue;
      await page.mouse.move(c.x, c.y, { steps: 8 });
      await settleAnims();
      rec.hover = await record(`${tag}-hover`, t.cid);
      if (t.kind !== 'field') {
        await page.mouse.down();
        await page.waitForTimeout(250);
        rec.press = await record(`${tag}-press`, t.cid);
        // leave before releasing so no click fires
        await page.mouse.move(2, 2, { steps: 4 });
        await page.mouse.up();
      }
      await idle();
      await settleAnims();
      if (t.focusable) {
        await page.keyboard.press('Shift');
        await page.evaluate((cid) => (document.querySelector(`[data-ct-id="${cid}"]`) as HTMLElement)?.focus(), t.cid);
        await settleAnims(1200);
        rec.focus = await record(`${tag}-focus`, t.cid);
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await settleAnims(1200);
      }
      if (t.click) {
        const c2 = await centerOf(t.cid);
        if (c2) {
          await page.mouse.click(c2.x, c2.y);
          await settleAnims(3000);
          rec.open = await record(`${tag}-open`, t.cid);
          await page.mouse.click(c2.x, c2.y);
          await idle();
          await settleAnims(3000);
        }
      }
      const back = await ct<any>(page, 'snap', '$root');
      const left = await page.evaluate(({ a, b }) => (window as any).__ct.diffSnap(a, b), { a: base, b: back });
      rec.restored = left.length === 0;
      if (!rec.restored) rec.residue = left.slice(0, 20);
      out.targets.push(rec);
      const count = (s: any) => (s ? s.changes.length : '-');
      if (!opts.quiet) log(`  ${tag} ${t.text ? `"${t.text.slice(0, 24)}"` : t.tag}: hover ${count(rec.hover)} press ${count(rec.press)} focus ${count(rec.focus)} open ${count(rec.open)}${rec.restored ? '' : ' (did not return to rest)'}`);
    } catch (e: any) { rec.error = e.message; out.targets.push(rec); }
    n++;
  }
  return out;
}
