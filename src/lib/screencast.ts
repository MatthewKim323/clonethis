/**
 * CDP Page.startScreencast: every compositor frame with its swap timestamp. Frames can be cropped to the
 * component (plus a margin) on finish, so a scenario folder holds the component and nothing else.
 * Shared by `grab` (reference) and `frames` (build) so both timelines are recorded the same way.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { CDPSession, Page } from 'playwright';
import type { Rect } from './page.ts';

export const MAX_FRAMES = 420;
export type Frame = { i: number; t: number; file: string; ts: number };

export class Screencast {
  frames: Frame[] = [];
  private cdp!: CDPSession;
  private t0 = 0;
  private stopped = false;
  private writes: Promise<unknown>[] = [];
  constructor(public dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/\.(png|json)$/.test(f)) fs.unlinkSync(path.join(dir, f));
  }
  /** ms since start of the latest frame, a cheap "now" on the frame clock */
  now() { return this.frames.at(-1)?.t ?? 0; }
  async start(page: Page, vp: { width: number; height: number }, dsf = 1) {
    this.cdp = await page.context().newCDPSession(page);
    this.cdp.on('Page.screencastFrame', (ev: any) => {
      if (!this.stopped) {
        const i = this.frames.length;
        const file = `${String(i).padStart(5, '0')}.png`;
        this.frames.push({ i, t: Math.round((ev.metadata.timestamp - this.t0) * 1000), file, ts: ev.metadata.timestamp });
        this.writes.push(fs.promises.writeFile(path.join(this.dir, file), Buffer.from(ev.data, 'base64')));
        if (this.frames.length >= MAX_FRAMES) this.stop().catch(() => {});
      }
      this.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    });
    this.t0 = Date.now() / 1000;
    await this.cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: Math.round(vp.width * dsf), maxHeight: Math.round(vp.height * dsf) });
  }
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    try { await this.cdp.send('Page.stopScreencast'); } catch {}
  }
  /**
   * Stop, order frames by swap time, crop to `crop` (viewport css px, scaled to the frame size) and write
   * frames.json + motion-timeline.json. Returns the timeline summary.
   */
  async finish(opts: { crop?: Rect | null; vp: { width: number; height: number }; extra?: Record<string, unknown> }) {
    await this.stop();
    await Promise.all(this.writes);
    try { await this.cdp.detach(); } catch {}
    const sorted = [...this.frames].sort((a, b) => a.ts - b.ts);
    for (const f of sorted) fs.renameSync(path.join(this.dir, f.file), path.join(this.dir, 'tmp-' + f.file));
    sorted.forEach((f, i) => { const nf = `${String(i).padStart(5, '0')}.png`; fs.renameSync(path.join(this.dir, 'tmp-' + f.file), path.join(this.dir, nf)); f.file = nf; f.i = i; });
    this.frames = sorted;
    let cropPx: { left: number; top: number; width: number; height: number } | null = null;
    if (opts.crop && sorted.length) {
      const meta = await sharp(path.join(this.dir, sorted[0].file)).metadata();
      const sx = meta.width! / opts.vp.width, sy = meta.height! / opts.vp.height;
      const left = Math.max(0, Math.floor(opts.crop.x * sx)), top = Math.max(0, Math.floor(opts.crop.y * sy));
      const width = Math.max(1, Math.min(meta.width! - left, Math.ceil(opts.crop.w * sx)));
      const height = Math.max(1, Math.min(meta.height! - top, Math.ceil(opts.crop.h * sy)));
      cropPx = { left, top, width, height };
      for (const f of sorted) {
        const p = path.join(this.dir, f.file);
        try {
          const m = await sharp(p).metadata();
          if (m.width! < left + width || m.height! < top + height) continue;
          const buf = await sharp(p).extract(cropPx).png().toBuffer();
          fs.writeFileSync(p, buf);
        } catch {}
      }
    }
    const motion = await motionTimeline(this.dir, sorted);
    const out = { frameCount: sorted.length, capped: sorted.length >= MAX_FRAMES, crop: opts.crop ?? null, tZero: 't = ms since Page.startScreencast (frame swap time); a gap means nothing repainted', ...(opts.extra ?? {}), frames: sorted.map(({ i, t, file }) => ({ i, t, file })) };
    fs.writeFileSync(path.join(this.dir, 'frames.json'), JSON.stringify(out, null, 1));
    fs.writeFileSync(path.join(this.dir, 'motion-timeline.json'), JSON.stringify(motion, null, 1));
    return { ...motion.summary, frameCount: sorted.length };
  }
}

/** Per-frame changed-pixel fraction vs the previous frame; merged motion ranges in ms. */
export async function motionTimeline(dir: string, frames: { i: number; t: number; file: string }[]) {
  const PIX = 12, THRESH = 0.0005, W = 360;
  let prev: Buffer | null = null;
  const rows: { i: number; t: number; changed: number; motion: boolean }[] = [];
  for (const f of frames) {
    let changed = 0;
    try {
      const raw = await sharp(path.join(dir, f.file)).resize({ width: W, height: W, fit: 'fill' }).removeAlpha().raw().toBuffer();
      if (prev && prev.length === raw.length) {
        let n = 0;
        for (let k = 0; k < raw.length; k += 3) if (Math.abs(raw[k] - prev[k]) > PIX || Math.abs(raw[k + 1] - prev[k + 1]) > PIX || Math.abs(raw[k + 2] - prev[k + 2]) > PIX) n++;
        changed = n / (raw.length / 3);
      } else if (prev) changed = 1;
      prev = raw;
    } catch {}
    rows.push({ i: f.i, t: f.t, changed: +changed.toFixed(5), motion: f.i > 0 && changed > THRESH });
  }
  const moving = rows.filter((r) => r.motion);
  const ranges: { startMs: number; endMs: number; frames: number }[] = [];
  for (const r of moving) {
    const last = ranges.at(-1);
    if (last && r.t - last.endMs <= 120) { last.endMs = r.t; last.frames++; } else ranges.push({ startMs: r.t, endMs: r.t, frames: 1 });
  }
  return {
    method: `frames resized to ${W}x${W}, a pixel changed if any channel moved > ${PIX}; a frame is motion if > ${THRESH * 100}% of pixels changed`,
    summary: { firstMotionMs: moving[0]?.t ?? null, lastMotionMs: moving.at(-1)?.t ?? null, motionFrames: moving.length, totalFrames: rows.length, ranges },
    frames: rows,
  };
}

/** Contact sheet of a frames dir at fixed time steps, so two recordings can be compared side by side. */
export async function contactSheet(dir: string, out: string, opts: { step?: number; count?: number; width?: number; from?: number } = {}) {
  const fj = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
  const frames: { t: number; file: string }[] = fj.frames;
  if (!frames.length) throw new Error(`no frames in ${dir}`);
  const step = opts.step ?? 200, count = opts.count ?? 12, width = opts.width ?? 220, from = opts.from ?? 0;
  const picks: { t: number; file: string; want: number }[] = [];
  for (let k = 0; k < count; k++) {
    const want = from + k * step;
    const f = [...frames].reverse().find((x) => x.t <= want) ?? frames[0];
    picks.push({ ...f, want });
  }
  const first = await sharp(path.join(dir, picks[0].file)).metadata();
  const h = Math.max(1, Math.round((first.height! / first.width!) * width));
  const label = 18;
  const comps: sharp.OverlayOptions[] = [];
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    comps.push({ input: await sharp(path.join(dir, p.file)).resize({ width, height: h, fit: 'fill' }).png().toBuffer(), left: i * (width + 4), top: label });
    const svg = `<svg width="${width}" height="${label}"><text x="2" y="13" font-family="monospace" font-size="11" fill="#000">${p.want}ms (f${p.file.replace('.png', '')} @${p.t})</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: i * (width + 4), top: 0 });
  }
  await sharp({ create: { width: picks.length * (width + 4), height: h + label, channels: 3, background: '#ffffff' } }).composite(comps).png().toFile(out);
  return picks.length;
}
