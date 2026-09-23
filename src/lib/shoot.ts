/**
 * Screenshot exactly the component: the `[data-ct-root]` element's border box, at the page's DSF, taken from
 * real viewport screenshots (never captureBeyondViewport, which re-lays-out vh units). Taller than the viewport
 * means scroll-and-stitch. Fixed / sticky things outside the component are hidden while shooting.
 */
import sharp from 'sharp';
import type { Page } from 'playwright';
import { ct, viewportRect, rootRect, type Rect } from './page.ts';

export async function settleMedia(page: Page, ms = 6000) {
  await page.evaluate(async (ms) => {
    const root = document.querySelector('[data-ct-root]') || document.body;
    const imgs = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
    const all = Promise.all([
      (document as any).fonts?.ready,
      ...imgs.map((i) => (i.complete ? null : i.decode().catch(() => null))),
    ]);
    await Promise.race([all, new Promise((r) => setTimeout(r, ms))]);
  }, ms).catch(() => {});
}

/**
 * `noScroll` shoots what is on screen right now (no scrolling), for states where moving the page would move
 * the element out from under the pointer. Parts of a tall component outside the viewport stay transparent.
 */
export async function shootRoot(page: Page, file: string, opts: { vp: { width: number; height: number }; dsf: number; margin?: number; settleMs?: number; hide?: boolean; noScroll?: boolean }) {
  const { vp, dsf } = opts;
  const margin = opts.margin ?? 0;
  const settle = opts.settleMs ?? 350;
  const abs = await rootRect(page);
  if (!abs) throw new Error('component root not found on the page');
  if (opts.hide !== false) await ct(page, 'hideOverlays', '$root');
  await settleMedia(page);
  const want: Rect = { x: abs.x - margin, y: abs.y - margin, w: abs.w + 2 * margin, h: abs.h + 2 * margin };
  const W = Math.max(1, Math.round(want.w * dsf)), H = Math.max(1, Math.round(want.h * dsf));
  const comps: sharp.OverlayOptions[] = [];
  const shootAt = async (scrollTo: number) => {
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), scrollTo);
    await page.waitForTimeout(settle);
    const vr = await viewportRect(page);
    const sy = await page.evaluate(() => scrollY);
    const sx = await page.evaluate(() => scrollX);
    const buf = await page.screenshot({ type: 'png', animations: 'allow', caret: 'hide' });
    return { buf, vr: vr!, sy, sx };
  };
  if (opts.noScroll) {
    await page.waitForTimeout(settle);
    const vr = (await viewportRect(page))!;
    const buf = await page.screenshot({ type: 'png', animations: 'allow', caret: 'hide' });
    comps.push(...(await piece(buf, vr.x - margin, vr.y - margin, want.w, want.h, vp, dsf, 0, 0)));
  } else if (want.h <= vp.height) {
    const { buf, vr } = await shootAt(abs.y - margin - Math.max(0, (vp.height - want.h) / 2));
    // viewport coords of the wanted box
    const vx = vr.x - margin, vy = vr.y - margin;
    comps.push(...(await piece(buf, vx, vy, want.w, want.h, vp, dsf, 0, 0)));
  } else {
    for (let off = 0; off < want.h; off += vp.height) {
      const { buf, vr } = await shootAt(abs.y - margin + off);
      const vx = vr.x - margin, vy = vr.y - margin + off;
      const rows = Math.min(vp.height, want.h - off);
      comps.push(...(await piece(buf, vx, vy, want.w, rows, vp, dsf, 0, off)));
    }
  }
  if (opts.hide !== false) await ct(page, 'restoreOverlays');
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png().toFile(file);
  return { w: want.w, h: want.h, file };
}

/**
 * Cut the part of a viewport screenshot that shows the box (vx, vy, w, h in viewport css px) and place it at
 * (dx, dy) of the output. Parts of the box outside the viewport stay transparent.
 */
async function piece(buf: Buffer, vx: number, vy: number, w: number, h: number, vp: { width: number; height: number }, dsf: number, dx: number, dy: number): Promise<sharp.OverlayOptions[]> {
  const meta = await sharp(buf).metadata();
  const x0 = Math.max(0, vx), y0 = Math.max(0, vy);
  const x1 = Math.min(vp.width, vx + w), y1 = Math.min(vp.height, vy + h);
  if (x1 <= x0 || y1 <= y0) return [];
  const left = Math.round(x0 * dsf), top = Math.round(y0 * dsf);
  const width = Math.min(meta.width! - left, Math.round((x1 - x0) * dsf));
  const height = Math.min(meta.height! - top, Math.round((y1 - y0) * dsf));
  if (width <= 0 || height <= 0) return [];
  const input = await sharp(buf).extract({ left, top, width, height }).png().toBuffer();
  return [{ input, left: Math.round((dx + (x0 - vx)) * dsf), top: Math.round((dy + (y0 - vy)) * dsf) }];
}
