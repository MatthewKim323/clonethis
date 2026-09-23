/**
 * Find a component on a live page from a screenshot of it. At each width: revealed full page (1x), every
 * visible element as a candidate, scored by how much its pixels look like the screenshot (24x24 thumbnails,
 * margins trimmed off the screenshot first), how many of the screenshot's OCR'd words it contains, and how
 * close its aspect ratio is. Nested elements with the same box collapse to the outermost one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { Browser } from 'playwright';
import { newCtx, load, reveal, stitchFullPage, closeCtx, log, type Viewport } from './browser.ts';
import { ensureLib } from './page.ts';
import { ocr, words } from './ocr.ts';

const N = 24;
export type Likeness = { vp: Viewport; rect: { x: number; y: number; w: number; h: number }; score: number; visual: number; text: number | null; aspect: number; selector: string; nth: number; count: number; tag: string; label: string; crop?: string };

async function targetThumb(image: string) {
  let img = sharp(image).flatten({ background: '#ffffff' });
  try {
    const trimmed = await img.clone().trim({ threshold: 14 }).toBuffer({ resolveWithObject: true });
    if (trimmed.info.width > 16 && trimmed.info.height > 16) img = sharp(trimmed.data);
  } catch {}
  const meta = await img.clone().png().toBuffer({ resolveWithObject: true });
  const thumb = await sharp(meta.data).resize(N, N, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  return { thumb, w: meta.info.width, h: meta.info.height, png: meta.data };
}

/** 24x24 average-sampled thumbnail of a rect out of a raw RGB full-page buffer. */
function poolRect(raw: Buffer, W: number, H: number, r: { x: number; y: number; w: number; h: number }) {
  const out = Buffer.alloc(N * N * 3);
  const S = 3;
  for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
    let R = 0, G = 0, B = 0, n = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const x = Math.min(W - 1, Math.max(0, Math.floor(r.x + ((gx + (sx + 0.5) / S) / N) * r.w)));
      const y = Math.min(H - 1, Math.max(0, Math.floor(r.y + ((gy + (sy + 0.5) / S) / N) * r.h)));
      const i = (y * W + x) * 3;
      R += raw[i]; G += raw[i + 1]; B += raw[i + 2]; n++;
    }
    const o = (gy * N + gx) * 3;
    out[o] = R / n; out[o + 1] = G / n; out[o + 2] = B / n;
  }
  return out;
}

const mad = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length / 255; };

export async function locateByImage(browser: Browser, url: string, image: string, vps: Viewport[], opts: { top?: number; outDir?: string } = {}): Promise<Likeness[]> {
  const t = await targetThumb(image);
  const ar = t.w / t.h;
  const lines = ocr(image);
  const T = new Set(words(lines.map((l) => l.text).join(' ')));
  log(`like: screenshot ${t.w}x${t.h} (trimmed), ${T.size} word(s) read from it`);
  const all: Likeness[] = [];
  for (const vp of vps) {
    const ctx = await newCtx(browser, vp, 1);
    try {
      const page = await ctx.newPage();
      await load(page, url);
      await reveal(page);
      await ensureLib(page);
      const file = path.join(os.tmpdir(), `ct-like-${process.pid}-${vp.width}.png`);
      await stitchFullPage(page, vp.width, vp.height, file, 1);
      const { data: raw, info } = await sharp(file).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const cands = await page.evaluate(() => {
        const c = (window as any).__ct;
        const out: any[] = [];
        let i = 0;
        for (const el of Array.from(document.body.querySelectorAll('*')) as HTMLElement[]) {
          if (i > 6000) break;
          if (!c.visible(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 24 || r.height < 16) continue;
          let depth = 0;
          for (let p = el.parentElement; p; p = p.parentElement) depth++;
          el.setAttribute('data-ct-cand', String(i));
          out.push({ i: i++, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, depth, tag: el.tagName.toLowerCase(), text: (el.innerText || '').slice(0, 2000), label: el.getAttribute('data-framer-name') || (typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 2).join('.') : '') });
        }
        return out;
      });
      const byBox = new Map<string, any>();
      for (const c of cands) {
        const key = `${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.w)},${Math.round(c.h)}`;
        const prev = byBox.get(key);
        if (!prev || c.depth < prev.depth) byBox.set(key, c);
      }
      const scored: (Likeness & { i: number })[] = [];
      for (const c of byBox.values()) {
        const aspect = Math.exp(-Math.abs(Math.log(c.w / c.h / ar)) * 3);
        if (aspect < 0.25) continue;
        const visual = 1 - mad(poolRect(raw, info.width, info.height, c), t.thumb);
        let text: number | null = null;
        if (T.size) {
          const C = new Set(words(c.text));
          const hit = [...T].filter((w) => C.has(w)).length;
          const recall = hit / T.size, precision = C.size ? hit / C.size : 0;
          text = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
        }
        const score = text === null ? 0.85 * visual + 0.15 * aspect : 0.5 * visual + 0.45 * text + 0.05 * aspect;
        scored.push({ i: c.i, vp, rect: { x: +c.x.toFixed(1), y: +c.y.toFixed(1), w: +c.w.toFixed(1), h: +c.h.toFixed(1) }, score: +score.toFixed(4), visual: +visual.toFixed(4), text: text === null ? null : +text.toFixed(3), aspect: +aspect.toFixed(3), selector: '', nth: 0, count: 0, tag: c.tag, label: c.label });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, opts.top ?? 5);
      for (const s of top) {
        const sel = await page.evaluate((i) => { const c = (window as any).__ct; const el = document.querySelector(`[data-ct-cand="${i}"]`); return el ? c.selectorFor(el) : null; }, s.i);
        if (sel) { s.selector = sel.selector; s.nth = sel.nth; s.count = sel.count; }
        if (opts.outDir) {
          fs.mkdirSync(opts.outDir, { recursive: true });
          s.crop = path.join(opts.outDir, `${vp.name}-${top.indexOf(s)}.png`);
          const left = Math.max(0, Math.floor(s.rect.x)), topPx = Math.max(0, Math.floor(s.rect.y));
          await sharp(file).extract({ left, top: topPx, width: Math.max(1, Math.min(info.width - left, Math.ceil(s.rect.w))), height: Math.max(1, Math.min(info.height - topPx, Math.ceil(s.rect.h))) }).png().toFile(s.crop);
        }
        all.push(s);
      }
      fs.rmSync(file, { force: true });
      log(`  ${vp.name}: ${byBox.size} boxes, best ${top[0] ? `${top[0].score} (${top[0].tag} ${Math.round(top[0].rect.w)}x${Math.round(top[0].rect.h)})` : 'none'}`);
    } finally { await closeCtx(ctx); }
  }
  all.sort((a, b) => b.score - a.score);
  if (opts.outDir && all.length) {
    // the screenshot next to the best matches, for a quick look
    const H = 220;
    const tiles = [{ input: await sharp(t.png).resize({ height: H }).png().toBuffer() }, ...(await Promise.all(all.slice(0, 5).filter((s) => s.crop).map(async (s) => ({ input: await sharp(s.crop!).resize({ height: H }).png().toBuffer() }))))];
    const widths = await Promise.all(tiles.map(async (x) => (await sharp(x.input).metadata()).width!));
    let left = 0;
    const comps = tiles.map((x, k) => { const c = { input: x.input, left, top: 0 }; left += widths[k] + 12; return c; });
    await sharp({ create: { width: left, height: H, channels: 3, background: '#ff00ff' } }).composite(comps).png().toFile(path.join(opts.outDir, 'like.png'));
  }
  return all;
}
